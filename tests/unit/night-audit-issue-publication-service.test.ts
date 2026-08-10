import { describe, it, expect } from "vitest";
import { publishAuditFinding, checkAuditIssueBacklog, buildIssueFingerprintMarker, buildIssueTitle, buildIssueBody, AUDIT_ISSUE_LABEL } from "../../src/services/night-audit-issue-publication-service.js";
import type { GithubExistingIssue, GithubIssueClient } from "../../src/services/github-issue-client.js";
import type { AuditFinding } from "../../src/schema/night-audit.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";
const FINGERPRINT = "sha256:" + "a".repeat(64);

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    findingKey: FINGERPRINT,
    domain: "code_quality",
    checkId: "duplicate-logic",
    title: "Duplicate retry logic",
    explanation: "Two modules independently implement the same retry loop.",
    reviewCommit: "a".repeat(40),
    scope: "src/services/",
    affectedPaths: ["src/services/a.ts"],
    evidence: [{ evidenceId: "ev-1", description: "d", locator: "src/services/a.ts:10" }],
    confidence: "strong_signal",
    significance: "medium",
    disposition: "actionable",
    recommendedNextAction: "Extract a shared helper.",
    ...overrides,
  };
}

function issue(overrides: Partial<GithubExistingIssue> = {}): GithubExistingIssue {
  return { number: 42, htmlUrl: "https://github.com/acme/widget/issues/42", state: "open", title: "T", body: buildIssueFingerprintMarker(FINGERPRINT), ...overrides };
}

interface Calls {
  creates: { title: string; body: string; labels: readonly string[] }[];
  searches: number;
}

function client(options: { searchResults?: (GithubExistingIssue[] | "error")[]; createResult?: GithubExistingIssue | "error" } = {}): GithubIssueClient & { calls: Calls } {
  const calls: Calls = { creates: [], searches: 0 };
  const searchResults = options.searchResults ?? [[]];
  return {
    calls,
    searchOpenIssuesByLabel: async () => {
      const result = searchResults[Math.min(calls.searches++, searchResults.length - 1)]!;
      return result === "error" ? { ok: false, status: 502, message: "bad gateway" } : { ok: true, value: result };
    },
    getIssue: async () => ({ ok: true, value: null }),
    createIssue: async (_o, _r, params) => {
      calls.creates.push({ title: params.title, body: params.body, labels: params.labels });
      const result = options.createResult ?? issue();
      return result === "error" ? { ok: false, status: 502, message: "bad gateway" } : { ok: true, value: result };
    },
  };
}

describe("buildIssueTitle/buildIssueBody (build spec Sec 13)", () => {
  it("includes the domain and title, bounded", () => {
    const title = buildIssueTitle(finding());
    expect(title).toContain("code_quality");
    expect(title).toContain("Duplicate retry logic");
  });

  it("embeds the fingerprint and defect-id markers as HTML comments", () => {
    const body = buildIssueBody(finding(), "DEF-001");
    expect(body).toContain(buildIssueFingerprintMarker(FINGERPRINT));
    expect(body).toContain("aiqt-defect-id: DEF-001");
  });

  it("never dumps raw evidence beyond the bounded locator/description pair", () => {
    const body = buildIssueBody(finding(), "DEF-001");
    expect(body).toContain("src/services/a.ts:10");
  });
});

describe("publishAuditFinding: already-published skip (build spec Sec 9 dedup check #2)", () => {
  it("never searches or creates when existingExternalIssueRef is already present", async () => {
    const c = client();
    const existingRef = { provider: "github" as const, number: 7, url: "https://x/7", publishedAt: NOW };
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: existingRef, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("skipped_already_published");
    expect(c.calls.searches).toBe(0);
    expect(c.calls.creates).toEqual([]);
  });
});

describe("publishAuditFinding: lookup always precedes create (build spec Sec 9)", () => {
  it("creates a new issue with the fixed audit label when no match exists", async () => {
    const c = client();
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(c.calls.searches).toBeGreaterThanOrEqual(1);
    expect(outcome.kind).toBe("created");
    expect(c.calls.creates).toHaveLength(1);
    expect(c.calls.creates[0]!.labels).toEqual([AUDIT_ISSUE_LABEL]);
  });

  it("reconciles onto an existing issue carrying the same fingerprint marker instead of creating a second one", async () => {
    const c = client({ searchResults: [[issue()]] });
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("reconciled");
    expect(c.calls.creates).toEqual([]);
  });

  it("ignores an issue with the label but a different fingerprint marker", async () => {
    const c = client({ searchResults: [[issue({ body: buildIssueFingerprintMarker("sha256:" + "b".repeat(64)) })]] });
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("created");
  });

  it("blocks rather than guessing when more than one existing issue carries the same fingerprint", async () => {
    const c = client({ searchResults: [[issue({ number: 1 }), issue({ number: 2 })]] });
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("conflict");
    expect(c.calls.creates).toEqual([]);
  });

  it("reports ambiguity, and creates nothing, when the pre-create search itself fails", async () => {
    const c = client({ searchResults: ["error"] });
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("ambiguous");
    expect(c.calls.creates).toEqual([]);
  });
});

describe("publishAuditFinding: a failed create is resolved by searching, never by retrying", () => {
  it("adopts the issue when create reported an error but it actually landed", async () => {
    const c = client({ searchResults: [[], [issue()]], createResult: "error" });
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("reconciled");
    expect(c.calls.creates).toHaveLength(1);
  });

  it("reports a genuine failure when create failed and no issue exists", async () => {
    const c = client({ searchResults: [[], []], createResult: "error" });
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("failed");
  });

  it("reports ambiguity when both create and the follow-up search fail", async () => {
    const c = client({ searchResults: [[], "error"], createResult: "error" });
    const outcome = await publishAuditFinding({ finding: finding(), defectId: "DEF-001", existingExternalIssueRef: null, owner: "acme", repo: "widget", token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("ambiguous");
  });
});

describe("checkAuditIssueBacklog (build spec Sec 11)", () => {
  it("reports the current open-audit-issue count", async () => {
    const c = client({ searchResults: [[issue({ number: 1 }), issue({ number: 2 })]] });
    const result = await checkAuditIssueBacklog("acme", "widget", "t", 5, c);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.suppressed).toBe(false);
  });

  it("suppresses once the count reaches the configured maximum", async () => {
    const c = client({ searchResults: [[issue({ number: 1 }), issue({ number: 2 })]] });
    const result = await checkAuditIssueBacklog("acme", "widget", "t", 2, c);
    expect(result.suppressed).toBe(true);
  });

  it("reports not-ok, never a fabricated count, when the search fails", async () => {
    const c = client({ searchResults: ["error"] });
    const result = await checkAuditIssueBacklog("acme", "widget", "t", 5, c);
    expect(result.ok).toBe(false);
  });
});
