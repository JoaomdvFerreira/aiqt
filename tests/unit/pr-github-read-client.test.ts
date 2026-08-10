import { describe, it, expect, afterEach, vi } from "vitest";
import { realGithubPullRequestReadClient, realGithubPullRequestClient, redactToken } from "../../src/services/github-pull-request-client.js";

const TOKEN = "ghp_SECRETVALUE";

interface StubResponse {
  status: number;
  ok?: boolean;
  body?: unknown;
  throws?: Error;
}

function stubFetch(responses: StubResponse[]): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const response = responses[Math.min(index++, responses.length - 1)]!;
    if (response.throws) throw response.throws;
    return {
      status: response.status,
      ok: response.ok ?? (response.status >= 200 && response.status < 300),
      json: async () => response.body ?? null,
    } as unknown as Response;
  });
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M47-WU02 GitHub read client: repository lookup", () => {
  it("returns the full name and default branch", async () => {
    stubFetch([{ status: 200, body: { full_name: "acme/widget", default_branch: "main" } }]);
    const result = await realGithubPullRequestReadClient.getRepository("acme", "widget", TOKEN);
    expect(result).toEqual({ ok: true, value: { fullName: "acme/widget", defaultBranch: "main" } });
  });

  it("maps a non-OK response to a typed external failure carrying the status", async () => {
    stubFetch([{ status: 404, body: {} }]);
    const result = await realGithubPullRequestReadClient.getRepository("acme", "widget", TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });

  it("never leaks the token into a failure message", async () => {
    stubFetch([{ status: 500, throws: new Error(`boom while using ${TOKEN}`) }]);
    const result = await realGithubPullRequestReadClient.getRepository("acme", "widget", TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain(TOKEN);
    expect(result.message).toContain("[REDACTED]");
  });

  it("sends the token only as an Authorization header, never in the URL", async () => {
    const { calls } = stubFetch([{ status: 200, body: { full_name: "acme/widget", default_branch: "main" } }]);
    await realGithubPullRequestReadClient.getRepository("acme", "widget", TOKEN);
    expect(calls[0]!.url).not.toContain(TOKEN);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("M47-WU02 GitHub read client: base protection evidence is honest (build spec Sec 11)", () => {
  it("reports protected when GitHub says the branch is protected", async () => {
    stubFetch([{ status: 200, body: { protected: true } }]);
    const result = await realGithubPullRequestReadClient.getBaseProtection("acme", "widget", "main", TOKEN);
    expect(result.ok && result.value.evidence).toBe("protected");
  });

  it("reports unprotected when GitHub says the branch is not protected", async () => {
    stubFetch([{ status: 200, body: { protected: false } }]);
    const result = await realGithubPullRequestReadClient.getBaseProtection("acme", "widget", "main", TOKEN);
    expect(result.ok && result.value.evidence).toBe("unprotected");
  });

  for (const status of [401, 403]) {
    it(`maps ${status} to unverifiable, never to unprotected`, async () => {
      stubFetch([{ status, body: {} }]);
      const result = await realGithubPullRequestReadClient.getBaseProtection("acme", "widget", "main", TOKEN);
      expect(result.ok && result.value.evidence).toBe("unverifiable");
    });
  }

  it("maps a 404 to unverifiable, never to unprotected", async () => {
    stubFetch([{ status: 404, body: {} }]);
    const result = await realGithubPullRequestReadClient.getBaseProtection("acme", "widget", "main", TOKEN);
    expect(result.ok && result.value.evidence).toBe("unverifiable");
  });

  it("maps a network failure to unverifiable, never to unprotected, and never leaks the token", async () => {
    stubFetch([{ status: 0, throws: new Error(`socket hang up (${TOKEN})`) }]);
    const result = await realGithubPullRequestReadClient.getBaseProtection("acme", "widget", "main", TOKEN);
    expect(result.ok && result.value.evidence).toBe("unverifiable");
    expect(result.ok && result.value.detail).not.toContain(TOKEN);
  });

  it("maps a response with no protection field to unsupported", async () => {
    stubFetch([{ status: 200, body: { name: "main" } }]);
    const result = await realGithubPullRequestReadClient.getBaseProtection("acme", "widget", "main", TOKEN);
    expect(result.ok && result.value.evidence).toBe("unsupported");
  });

  it("uses the branch endpoint, not the admin-only protection endpoint (a non-admin 403 would be indistinguishable from 'no protection')", async () => {
    const { calls } = stubFetch([{ status: 200, body: { protected: true } }]);
    await realGithubPullRequestReadClient.getBaseProtection("acme", "widget", "main", TOKEN);
    expect(calls[0]!.url).toContain("/repos/acme/widget/branches/main");
    expect(calls[0]!.url).not.toContain("/protection");
  });
});

describe("M47-WU02 GitHub read client: open Pull Request lookup", () => {
  it("scopes the query to exactly one head and one base branch", async () => {
    const { calls } = stubFetch([{ status: 200, body: [] }]);
    await realGithubPullRequestReadClient.findOpenPullRequests("acme", "widget", "feature/x", "main", TOKEN);
    expect(calls[0]!.url).toContain("state=open");
    expect(calls[0]!.url).toContain(encodeURIComponent("acme:feature/x"));
    expect(calls[0]!.url).toContain(`base=${encodeURIComponent("main")}`);
  });

  it("normalizes PR payloads, including an observed merged state it can never produce itself", async () => {
    stubFetch([
      {
        status: 200,
        body: [
          { number: 7, html_url: "https://github.com/acme/widget/pull/7", state: "open", draft: true, head: { sha: "a".repeat(40), ref: "feature/x" }, base: { ref: "main" } },
          { number: 8, html_url: "https://github.com/acme/widget/pull/8", state: "closed", merged_at: "2026-08-10T00:00:00Z", head: { sha: null, ref: "feature/x" }, base: { ref: "main" } },
        ],
      },
    ]);
    const result = await realGithubPullRequestReadClient.findOpenPullRequests("acme", "widget", "feature/x", "main", TOKEN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toMatchObject({ number: 7, isDraft: true, state: "open", merged: false });
    expect(result.value[1]).toMatchObject({ number: 8, state: "closed", merged: true, headSha: null });
  });

  it("drops unparseable entries rather than fabricating a Pull Request", async () => {
    stubFetch([{ status: 200, body: [{ number: "not-a-number" }, { html_url: "x" }] }]);
    const result = await realGithubPullRequestReadClient.findOpenPullRequests("acme", "widget", "feature/x", "main", TOKEN);
    expect(result.ok && result.value).toEqual([]);
  });

  it("reports a non-list response as an external failure instead of guessing", async () => {
    stubFetch([{ status: 200, body: { message: "unexpected" } }]);
    const result = await realGithubPullRequestReadClient.findOpenPullRequests("acme", "widget", "feature/x", "main", TOKEN);
    expect(result.ok).toBe(false);
  });
});

describe("M47-WU02 redaction helper", () => {
  it("replaces every occurrence and is a no-op for an empty token", () => {
    expect(redactToken(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe("a [REDACTED] b [REDACTED]");
    expect(redactToken("unchanged", "")).toBe("unchanged");
  });
});

/**
 * M47-WU04: the write half of the provider. Same stubbed-fetch discipline
 * as the read half above -- these assert the exact requests the client is
 * allowed to make, and that a token never reaches a URL or a message.
 */
describe("M47-WU04 GitHub write client: Pull Request creation", () => {
  it("POSTs to /pulls with the plan's title, body, head, base, and draft flag", async () => {
    const { calls } = stubFetch([
      { status: 201, body: { number: 7, html_url: "https://github.com/acme/widget/pull/7", state: "open", draft: true, head: { sha: "a".repeat(40), ref: "feature/x" }, base: { ref: "main" } } },
    ]);
    const result = await realGithubPullRequestClient.createPullRequest(
      "acme",
      "widget",
      { title: "T", body: "B", headBranch: "feature/x", baseBranch: "main", draft: true },
      TOKEN,
    );
    expect(result.ok).toBe(true);
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/widget/pulls");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ title: "T", body: "B", head: "feature/x", base: "main", draft: true });
  });

  it("passes draft: false only when the caller explicitly asks for a ready Pull Request", async () => {
    const { calls } = stubFetch([
      { status: 201, body: { number: 7, html_url: "u", state: "open", draft: false, head: { sha: "a".repeat(40), ref: "feature/x" }, base: { ref: "main" } } },
    ]);
    await realGithubPullRequestClient.createPullRequest("acme", "widget", { title: "T", body: "B", headBranch: "feature/x", baseBranch: "main", draft: false }, TOKEN);
    expect(JSON.parse(calls[0]!.init.body as string).draft).toBe(false);
  });

  it("never sends a cross-fork owner:branch head -- one plan is always one repository", async () => {
    const { calls } = stubFetch([
      { status: 201, body: { number: 7, html_url: "u", state: "open", draft: true, head: { sha: "a".repeat(40), ref: "feature/x" }, base: { ref: "main" } } },
    ]);
    await realGithubPullRequestClient.createPullRequest("acme", "widget", { title: "T", body: "B", headBranch: "feature/x", baseBranch: "main", draft: true }, TOKEN);
    expect(JSON.parse(calls[0]!.init.body as string).head).toBe("feature/x");
  });

  it("reports an unparseable create response as a failure, so the caller looks up rather than assuming nothing happened", async () => {
    stubFetch([{ status: 201, body: { unexpected: true } }]);
    const result = await realGithubPullRequestClient.createPullRequest("acme", "widget", { title: "T", body: "B", headBranch: "f", baseBranch: "main", draft: true }, TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/could not be parsed/);
  });

  it("never leaks the token on a create failure", async () => {
    stubFetch([{ status: 0, throws: new Error(`boom ${TOKEN}`) }]);
    const result = await realGithubPullRequestClient.createPullRequest("acme", "widget", { title: "T", body: "B", headBranch: "f", baseBranch: "main", draft: true }, TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain(TOKEN);
  });
});

describe("M47-WU04 GitHub write client: reviewer requests are explicit only", () => {
  it("POSTs exactly the requested logins to requested_reviewers, and never team_reviewers", async () => {
    const { calls } = stubFetch([{ status: 201, body: { requested_reviewers: [{ login: "alice" }, { login: "bob" }] } }]);
    const result = await realGithubPullRequestClient.requestReviewers("acme", "widget", 7, ["alice", "bob"], TOKEN);
    expect(result).toEqual({ ok: true, value: ["alice", "bob"] });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/acme/widget/pulls/7/requested_reviewers");
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["reviewers"]);
    expect(body.team_reviewers).toBeUndefined();
  });

  it("returns an empty confirmation list rather than inventing one when the response has no reviewers", async () => {
    stubFetch([{ status: 201, body: {} }]);
    const result = await realGithubPullRequestClient.requestReviewers("acme", "widget", 7, ["alice"], TOKEN);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("maps a rejection to a typed failure", async () => {
    stubFetch([{ status: 403, body: {} }]);
    const result = await realGithubPullRequestClient.requestReviewers("acme", "widget", 7, ["alice"], TOKEN);
    expect(result.ok).toBe(false);
  });
});

describe("M47-WU04 GitHub write client: single Pull Request lookup", () => {
  it("distinguishes a genuine 404 from a failure", async () => {
    stubFetch([{ status: 404, body: {} }]);
    expect(await realGithubPullRequestClient.getPullRequest("acme", "widget", 7, TOKEN)).toEqual({ ok: true, value: null });

    stubFetch([{ status: 500, body: {} }]);
    const failure = await realGithubPullRequestClient.getPullRequest("acme", "widget", 7, TOKEN);
    expect(failure.ok).toBe(false);
  });
});
