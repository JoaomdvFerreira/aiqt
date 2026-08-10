import type { GithubApiOutcome } from "./github-release-client.js";
import type { BaseProtectionEvidence } from "../schema/pull-request-integration.schema.js";

/**
 * M47-WU02: the read-only half of the GitHub Pull Request provider.
 *
 * Same discipline as M40's github-release-client.ts, which this file
 * deliberately mirrors rather than replacing: a fixed set of operations
 * against literal, encoded-parameter path templates, no generic
 * "call any URL"/"call any method" escape hatch, one HTTP request per
 * operation with no retry loop, and token redaction on every returned
 * message. The `GithubApiOutcome` result type is imported from that client
 * rather than redefined, so there is exactly one external-failure shape in
 * this repository.
 *
 * Read operations only. Nothing in this file can create, update, merge, or
 * approve anything -- the write half arrives in WU47-04 as a separate
 * interface that extends this one, so a boundary scan can prove at each
 * Work Unit exactly which write surfaces exist.
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "aiqt-pull-request-integration";
const GITHUB_API_VERSION = "2022-11-28";

export interface GithubRepositoryFactsForPr {
  fullName: string;
  defaultBranch: string;
}

export interface GithubBaseProtectionFacts {
  evidence: BaseProtectionEvidence;
  detail: string;
}

export interface GithubExistingPullRequest {
  number: number;
  htmlUrl: string;
  state: "open" | "closed";
  isDraft: boolean;
  headSha: string | null;
  headRef: string;
  baseRef: string;
  /** True when GitHub reports the PR as merged. M47 never produces this -- it only ever observes it. */
  merged: boolean;
}

export interface PullRequestProviderReadClient {
  getRepository(owner: string, repo: string, token: string): Promise<GithubApiOutcome<GithubRepositoryFactsForPr>>;
  /**
   * Base-branch protection evidence. A permission, plan, or API failure
   * maps to `unverifiable` and NEVER to `unprotected` (build spec Sec 11):
   * "we could not check" and "we checked and it is not protected" are
   * different facts with different safety consequences.
   */
  getBaseProtection(owner: string, repo: string, branch: string, token: string): Promise<GithubApiOutcome<GithubBaseProtectionFacts>>;
  /** Open PRs for exactly one head branch and one base branch. Used for duplicate detection and for reconciling an ambiguous create. */
  findOpenPullRequests(owner: string, repo: string, headBranch: string, baseBranch: string, token: string): Promise<GithubApiOutcome<GithubExistingPullRequest[]>>;
}

/** Never let a raw token substring reach a returned/thrown message (build spec Sec 9: "no credential output"). */
export function redactToken(message: string, token: string): string {
  return token.length > 0 ? message.split(token).join("[REDACTED]") : message;
}

interface RawResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

async function githubFetch(path: string, token: string, init: { method?: string; body?: string } = {}): Promise<RawResponse> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, ok: response.ok, body };
}

/** Shared by the read client here and the write client added in WU47-04, so both use one request path and one redaction rule. */
export const githubPullRequestFetch = githubFetch;

function normalizePullRequest(raw: unknown): GithubExistingPullRequest | null {
  const body = raw as {
    number?: unknown;
    html_url?: unknown;
    state?: unknown;
    draft?: unknown;
    merged?: unknown;
    merged_at?: unknown;
    head?: { sha?: unknown; ref?: unknown };
    base?: { ref?: unknown };
  };
  if (typeof body?.number !== "number" || typeof body?.html_url !== "string") return null;
  if (typeof body?.head?.ref !== "string" || typeof body?.base?.ref !== "string") return null;
  return {
    number: body.number,
    htmlUrl: body.html_url,
    state: body.state === "closed" ? "closed" : "open",
    isDraft: Boolean(body.draft),
    headSha: typeof body.head.sha === "string" ? body.head.sha : null,
    headRef: body.head.ref,
    baseRef: body.base.ref,
    merged: Boolean(body.merged) || typeof body.merged_at === "string",
  };
}

/** Exported for the WU47-04 write client, which parses the same PR payload shape from its create response. */
export const parseGithubPullRequest = normalizePullRequest;

export interface CreatePullRequestParams {
  title: string;
  body: string;
  /** Source branch name only -- never an "owner:branch" cross-fork head. One plan is always one repository. */
  headBranch: string;
  baseBranch: string;
  draft: boolean;
}

/**
 * M47-WU04: the write half. Deliberately a SEPARATE interface that extends
 * the read half, so a boundary scan can state, per Work Unit, exactly which
 * write surfaces exist. There are exactly three operations here, and none
 * of them can approve, merge, label, close, or publish anything: GitHub's
 * merge (`PUT /pulls/{n}/merge`) and review (`POST /pulls/{n}/reviews`)
 * endpoints appear nowhere in this repository.
 */
export interface PullRequestProviderClient extends PullRequestProviderReadClient {
  createPullRequest(owner: string, repo: string, params: CreatePullRequestParams, token: string): Promise<GithubApiOutcome<GithubExistingPullRequest>>;
  /** Explicit reviewers only -- the caller supplies the exact logins; there is no discovery, suggestion, or team-expansion path. */
  requestReviewers(owner: string, repo: string, pullNumber: number, reviewers: readonly string[], token: string): Promise<GithubApiOutcome<string[]>>;
  getPullRequest(owner: string, repo: string, pullNumber: number, token: string): Promise<GithubApiOutcome<GithubExistingPullRequest | null>>;
}

export const realGithubPullRequestReadClient: PullRequestProviderReadClient = {
  async getRepository(owner, repo, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} looking up the repository.`, token) };
      }
      const body = res.body as { full_name?: unknown; default_branch?: unknown };
      if (typeof body?.full_name !== "string") {
        return { ok: false, status: res.status, message: "GitHub API repository response was missing full_name." };
      }
      return {
        ok: true,
        value: { fullName: body.full_name, defaultBranch: typeof body.default_branch === "string" ? body.default_branch : "" },
      };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },

  async getBaseProtection(owner, repo, branch, token) {
    try {
      // `GET /repos/{owner}/{repo}/branches/{branch}` carries a plain
      // `protected` boolean for any caller with read access. The dedicated
      // `/protection` endpoint is deliberately NOT used: it requires admin
      // rights, so a non-admin token would get a 403 that is indistinguishable
      // from "no protection configured" -- precisely the confusion Sec 11
      // forbids.
      const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
        token,
      );
      if (res.status === 404) {
        return { ok: true, value: { evidence: "unverifiable", detail: `GitHub reported no branch "${branch}" in ${owner}/${repo}, so its protection state could not be established.` } };
      }
      if (res.status === 403 || res.status === 401) {
        return { ok: true, value: { evidence: "unverifiable", detail: `GitHub returned ${res.status} reading branch metadata; protection state could not be established with these credentials.` } };
      }
      if (!res.ok) {
        return { ok: true, value: { evidence: "unverifiable", detail: `GitHub returned ${res.status} reading branch metadata; protection state could not be established.` } };
      }
      const body = res.body as { protected?: unknown };
      if (typeof body?.protected !== "boolean") {
        return { ok: true, value: { evidence: "unsupported", detail: "GitHub's branch response did not report a protection state for this repository." } };
      }
      return {
        ok: true,
        value: body.protected
          ? { evidence: "protected", detail: `GitHub reports branch "${branch}" as protected.` }
          : { evidence: "unprotected", detail: `GitHub reports branch "${branch}" as not protected.` },
      };
    } catch (err) {
      // A network failure is ignorance, not evidence of absence.
      return { ok: true, value: { evidence: "unverifiable", detail: redactToken(`Network error reading branch metadata: ${(err as Error).message}`, token) } };
    }
  },

  async findOpenPullRequests(owner, repo, headBranch, baseBranch, token) {
    try {
      const head = `${owner}:${headBranch}`;
      const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(baseBranch)}&per_page=100`,
        token,
      );
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} listing open Pull Requests.`, token) };
      }
      if (!Array.isArray(res.body)) {
        return { ok: false, status: res.status, message: "GitHub API open-Pull-Request response was not a list." };
      }
      const parsed: GithubExistingPullRequest[] = [];
      for (const entry of res.body) {
        const pr = normalizePullRequest(entry);
        if (pr !== null) parsed.push(pr);
      }
      return { ok: true, value: parsed };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },
};

/**
 * M47-WU04: the real client, read operations reused verbatim from the
 * read client above plus exactly three write/lookup operations.
 *
 * `draft` is passed through from the caller rather than hardcoded, because
 * M47's contract is "draft by default, ready only on explicit operator
 * intent" -- the default lives in the schema and the CLI, and the plan's
 * createMode is a write-relevant fact that staleness protects. (This
 * differs from M40's release client, where `draft: true` is hardcoded
 * because there is no legitimate "publish" intent at all.)
 */
export const realGithubPullRequestClient: PullRequestProviderClient = {
  ...realGithubPullRequestReadClient,

  async createPullRequest(owner, repo, params, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, token, {
        method: "POST",
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          head: params.headBranch,
          base: params.baseBranch,
          draft: params.draft,
        }),
      });
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} creating the Pull Request.`, token) };
      }
      const pr = normalizePullRequest(res.body);
      if (pr === null) {
        // The PR may well have been created; the caller must look it up
        // rather than retry blindly, so this is reported as a failure with a
        // status, never as "nothing happened".
        return { ok: false, status: res.status, message: "GitHub API create-Pull-Request response could not be parsed." };
      }
      return { ok: true, value: pr };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },

  async requestReviewers(owner, repo, pullNumber, reviewers, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/requested_reviewers`, token, {
        method: "POST",
        // `reviewers` only -- never `team_reviewers`, which would expand an
        // explicit request into an organization-scoped one.
        body: JSON.stringify({ reviewers: [...reviewers] }),
      });
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} requesting reviewers.`, token) };
      }
      const body = res.body as { requested_reviewers?: unknown };
      const confirmed = Array.isArray(body?.requested_reviewers)
        ? body.requested_reviewers.map((r) => (r as { login?: unknown })?.login).filter((l): l is string => typeof l === "string")
        : [];
      return { ok: true, value: confirmed };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },

  async getPullRequest(owner, repo, pullNumber, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`, token);
      if (res.status === 404) return { ok: true, value: null };
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} reading the Pull Request.`, token) };
      }
      const pr = normalizePullRequest(res.body);
      if (pr === null) {
        return { ok: false, status: res.status, message: "GitHub API Pull-Request response could not be parsed." };
      }
      return { ok: true, value: pr };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },
};
