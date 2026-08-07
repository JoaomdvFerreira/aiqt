/**
 * M40-WU04 (build spec Sec 11.3): the single, narrow GitHub network
 * surface in this repository. Exactly three fixed operations against
 * literal, encoded-parameter path templates -- there is no generic
 * "call any URL"/"call any method" escape hatch, mirroring the
 * git-command-runner.ts/sandbox-docker-command-runner.ts discipline of
 * one reviewed call site per allowlisted operation. `draft: true` is
 * hardcoded in createReleaseDraft's request body -- no code path in this
 * file, or anywhere else in the repository, can ever request a published
 * release. No retry loop: each operation makes exactly one HTTP request.
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "aiqt-release-governance";
const GITHUB_API_VERSION = "2022-11-28";

export type GithubApiOutcome<T> = { ok: true; value: T } | { ok: false; status: number | null; message: string };

export interface GithubRepositoryFacts {
  fullName: string;
}

export interface GithubExistingRelease {
  id: number;
  htmlUrl: string;
  draft: boolean;
}

export interface GithubCreatedRelease {
  id: number;
  htmlUrl: string;
}

export interface CreateReleaseDraftParams {
  tagName: string;
  targetCommitish: string;
  name: string;
  body: string;
}

export interface GithubReleaseClient {
  getRepository(owner: string, repo: string, token: string): Promise<GithubApiOutcome<GithubRepositoryFacts>>;
  getReleaseByTag(owner: string, repo: string, tag: string, token: string): Promise<GithubApiOutcome<GithubExistingRelease | null>>;
  createReleaseDraft(owner: string, repo: string, params: CreateReleaseDraftParams, token: string): Promise<GithubApiOutcome<GithubCreatedRelease>>;
}

/** Never let a raw token substring reach a returned/thrown message (build spec Sec 11.2: "no token logging"). */
function redact(message: string, token: string): string {
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

export const realGithubReleaseClient: GithubReleaseClient = {
  async getRepository(owner, repo, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
      if (!res.ok) {
        return { ok: false, status: res.status, message: redact(`GitHub API returned ${res.status} looking up the repository.`, token) };
      }
      const fullName = (res.body as { full_name?: unknown })?.full_name;
      if (typeof fullName !== "string") {
        return { ok: false, status: res.status, message: "GitHub API repository response was missing full_name." };
      }
      return { ok: true, value: { fullName } };
    } catch (err) {
      return { ok: false, status: null, message: redact(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },

  async getReleaseByTag(owner, repo, tag, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/${encodeURIComponent(tag)}`, token);
      if (res.status === 404) {
        return { ok: true, value: null };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, message: redact(`GitHub API returned ${res.status} checking for an existing release.`, token) };
      }
      const body = res.body as { id?: unknown; html_url?: unknown; draft?: unknown };
      if (typeof body?.id !== "number" || typeof body?.html_url !== "string") {
        return { ok: false, status: res.status, message: "GitHub API existing-release response was missing id/html_url." };
      }
      return { ok: true, value: { id: body.id, htmlUrl: body.html_url, draft: Boolean(body.draft) } };
    } catch (err) {
      return { ok: false, status: null, message: redact(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },

  async createReleaseDraft(owner, repo, params, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`, token, {
        method: "POST",
        // draft: true is never conditional and never caller-overridable.
        body: JSON.stringify({ tag_name: params.tagName, target_commitish: params.targetCommitish, name: params.name, body: params.body, draft: true }),
      });
      if (!res.ok) {
        return { ok: false, status: res.status, message: redact(`GitHub API returned ${res.status} creating the release draft.`, token) };
      }
      const body = res.body as { id?: unknown; html_url?: unknown };
      if (typeof body?.id !== "number" || typeof body?.html_url !== "string") {
        return { ok: false, status: res.status, message: "GitHub API create-release response was missing id/html_url." };
      }
      return { ok: true, value: { id: body.id, htmlUrl: body.html_url } };
    } catch (err) {
      return { ok: false, status: null, message: redact(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },
};
