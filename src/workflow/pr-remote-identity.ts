/**
 * M47-WU02: turns a configured Git remote URL into a GitHub `owner/repo`
 * identity, and nothing else.
 *
 * Why this module exists at all: a remote URL can embed a credential
 * (`https://x-access-token:<token>@github.com/owner/repo.git` is the
 * standard CI form), so the URL itself must never reach a CommandResult,
 * a persisted plan, a runlog entry, or an error message. Every caller
 * parses it here and surfaces only the resulting identity -- the parse
 * result deliberately carries no URL field, so there is nothing to leak.
 *
 * Only github.com is recognised, matching the milestone's single provider.
 * An unrecognised host is `null` ("this is not a GitHub remote"), never a
 * guess -- M47 must not push to a host whose PR semantics it does not
 * implement.
 */

const OWNER_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

export interface GitHubRemoteIdentity {
  owner: string;
  repo: string;
  /** "owner/repo" -- the only form persisted or displayed. */
  identity: string;
}

function buildIdentity(owner: string, repo: string): GitHubRemoteIdentity | null {
  const cleanRepo = repo.endsWith(".git") ? repo.slice(0, -".git".length) : repo;
  if (!OWNER_SEGMENT.test(owner) || !REPO_SEGMENT.test(cleanRepo)) return null;
  // ".." and "." would be valid REPO_SEGMENT characters but are never real
  // repository names, and are exactly the shape a path-traversal attempt
  // would take if this value ever reached a path or URL template.
  if (cleanRepo === "." || cleanRepo === "..") return null;
  return { owner, repo: cleanRepo, identity: `${owner}/${cleanRepo}` };
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/**
 * Accepts the four remote forms Git actually writes for GitHub:
 *   https://github.com/owner/repo(.git)
 *   https://<credential>@github.com/owner/repo(.git)
 *   ssh://git@github.com/owner/repo(.git)
 *   git@github.com:owner/repo(.git)
 * Returns null for anything else, including any non-GitHub host.
 */
export function parseGitHubRemoteUrl(url: string): GitHubRemoteIdentity | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  // scp-like syntax (`git@github.com:owner/repo.git`) is not a URL and
  // cannot be handled by the URL parser.
  const scpMatch = /^(?:[^@/\s]+@)?([^:/\s]+):([^/\s]+)\/([^/\s]+?)$/.exec(trimmed);
  if (scpMatch && !trimmed.includes("://")) {
    const [, host, owner, repo] = scpMatch;
    if (!GITHUB_HOSTS.has(host!.toLowerCase())) return null;
    return buildIdentity(owner!, repo!);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:" && parsed.protocol !== "ssh:" && parsed.protocol !== "git:") return null;
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length !== 2) return null;
  return buildIdentity(segments[0]!, segments[1]!);
}

/** GitHub owner/repo comparison is case-insensitive (matching release-draft.command.ts's existing check). */
export function isSameRepositoryIdentity(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
