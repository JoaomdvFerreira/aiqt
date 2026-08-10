import type { GithubApiOutcome } from "./github-release-client.js";
import { redactToken } from "./github-pull-request-client.js";

/**
 * M48-WU05 (build spec Sec 12): the sole GitHub Issues network surface in
 * this repository, mirroring github-release-client.ts/
 * github-pull-request-client.ts's discipline exactly: fixed operations
 * against literal, encoded-parameter path templates, no generic
 * "call any URL"/"call any method" escape hatch, one HTTP request per
 * operation with no retry loop, `redactToken` reused verbatim (never a
 * third redefinition) so a raw token substring can never reach a
 * returned/thrown message.
 *
 * Exactly three operations: search open issues by label (idempotency/
 * backlog-count read), read one issue (verification read), create one
 * issue with exactly the fixed audit label. Nothing in this file -- or
 * anywhere else in the repository -- can edit, close, reopen, delete,
 * assign, comment on, or add an arbitrary label to an issue. GitHub's
 * issue-comment and issue-edit endpoints appear nowhere here.
 */

const GITHUB_API_BASE = "https://api.github.com";
const USER_AGENT = "aiqt-night-audit";
const GITHUB_API_VERSION = "2022-11-28";

export interface GithubExistingIssue {
  number: number;
  htmlUrl: string;
  state: "open" | "closed";
  title: string;
  /** null when GitHub reports no body (never fabricated as empty-string equivalence with "has no fingerprint marker"). */
  body: string | null;
}

export interface CreateIssueParams {
  title: string;
  body: string;
  /** Always exactly the fixed audit label in practice -- the client itself does not enforce a single-element array, the caller (night-audit-issue-publication-service.ts) does. */
  labels: readonly string[];
}

export interface GithubIssueClient {
  /** Open issues carrying `label`, most-recent first (GitHub's default). Bounded to one page (100) -- sufficient given the backlog itself is capped far below that. */
  searchOpenIssuesByLabel(owner: string, repo: string, label: string, token: string): Promise<GithubApiOutcome<GithubExistingIssue[]>>;
  getIssue(owner: string, repo: string, issueNumber: number, token: string): Promise<GithubApiOutcome<GithubExistingIssue | null>>;
  createIssue(owner: string, repo: string, params: CreateIssueParams, token: string): Promise<GithubApiOutcome<GithubExistingIssue>>;
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

/**
 * GitHub's issues list/get endpoints report a Pull Request as an issue
 * with an extra `pull_request` key -- explicitly excluded so a PR can
 * never be misread as an existing audit issue.
 */
function normalizeIssue(raw: unknown): GithubExistingIssue | null {
  const body = raw as { number?: unknown; html_url?: unknown; state?: unknown; title?: unknown; body?: unknown; pull_request?: unknown };
  if (body?.pull_request !== undefined) return null;
  if (typeof body?.number !== "number" || typeof body?.html_url !== "string" || typeof body?.title !== "string") return null;
  const state = body.state === "closed" ? "closed" : "open";
  return { number: body.number, htmlUrl: body.html_url, state, title: body.title, body: typeof body.body === "string" ? body.body : null };
}

export const realGithubIssueClient: GithubIssueClient = {
  async searchOpenIssuesByLabel(owner, repo, label, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=100`, token);
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} listing audit issues.`, token) };
      }
      if (!Array.isArray(res.body)) {
        return { ok: false, status: res.status, message: "GitHub API issues-list response was not an array." };
      }
      const issues = res.body.map(normalizeIssue).filter((i): i is GithubExistingIssue => i !== null);
      return { ok: true, value: issues };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },

  async getIssue(owner, repo, issueNumber, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`, token);
      if (res.status === 404) return { ok: true, value: null };
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} reading issue #${issueNumber}.`, token) };
      }
      const issue = normalizeIssue(res.body);
      if (issue === null) {
        return { ok: false, status: res.status, message: `GitHub API get-issue response for #${issueNumber} could not be parsed (or is a Pull Request).` };
      }
      return { ok: true, value: issue };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },

  async createIssue(owner, repo, params, token) {
    try {
      const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, token, {
        method: "POST",
        body: JSON.stringify({ title: params.title, body: params.body, labels: [...params.labels] }),
      });
      if (!res.ok) {
        return { ok: false, status: res.status, message: redactToken(`GitHub API returned ${res.status} creating the issue.`, token) };
      }
      const issue = normalizeIssue(res.body);
      if (issue === null) {
        // The issue may well have been created; the caller must look it up
        // rather than retry blindly (build spec Sec 9), so this is reported
        // as a failure with a status, never as "nothing happened".
        return { ok: false, status: res.status, message: "GitHub API create-issue response could not be parsed." };
      }
      return { ok: true, value: issue };
    } catch (err) {
      return { ok: false, status: null, message: redactToken(`Network error contacting GitHub: ${(err as Error).message}`, token) };
    }
  },
};
