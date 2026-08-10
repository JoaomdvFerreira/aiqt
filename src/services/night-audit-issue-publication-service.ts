import type { AuditFinding } from "../schema/night-audit.schema.js";
import type { DefectExternalIssueRef } from "../schema/defect.schema.js";
import type { GithubIssueClient } from "./github-issue-client.js";
import { MAX_PR_TITLE_CHARS } from "../schema/pull-request-integration.schema.js";

/**
 * M48-WU05 (build spec Sec 9/11/12/13): GitHub Issue idempotency and
 * publication, mirroring pr-create-service.ts's createOrReconcilePullRequest
 * shape exactly -- a lookup always precedes a create, and a create is
 * never retried blind.
 */

/** The single fixed label every audit issue carries -- both the idempotency-search marker and the backlog-count mechanism (build spec Sec 11/12). No other label is ever applied. */
export const AUDIT_ISSUE_LABEL = "aiqt-night-audit";

export function buildIssueFingerprintMarker(fingerprint: string): string {
  return `<!-- aiqt-fingerprint: ${fingerprint} -->`;
}

export function buildIssueDefectIdMarker(defectId: string): string {
  return `<!-- aiqt-defect-id: ${defectId} -->`;
}

/** Build spec Sec 13: compact, structured, bounded -- never raw agent reasoning or a log dump. */
export function buildIssueTitle(finding: AuditFinding): string {
  const raw = `[${finding.domain}] ${finding.title}`;
  return raw.length > MAX_PR_TITLE_CHARS ? raw.slice(0, MAX_PR_TITLE_CHARS) : raw;
}

export function buildIssueBody(finding: AuditFinding, defectId: string): string {
  const lines: string[] = [
    "## Review domain",
    finding.domain,
    "",
    "## Why it matters",
    finding.explanation,
    "",
    "## Evidence",
    ...finding.evidence.map((e) => `- \`${e.locator}\`: ${e.description}`),
    "",
    "## Impact",
    finding.significance,
    "",
    "## Suggested remediation direction",
    finding.recommendedNextAction,
    "",
    "## Validation idea",
    finding.validationIdea ?? "Not specified.",
    "",
    buildIssueFingerprintMarker(finding.findingKey),
    buildIssueDefectIdMarker(defectId),
  ];
  return lines.join("\n");
}

export type PublishFindingOutcome =
  | { kind: "skipped_already_published"; issueRef: DefectExternalIssueRef }
  | { kind: "reconciled"; issueRef: DefectExternalIssueRef }
  | { kind: "created"; issueRef: DefectExternalIssueRef }
  | { kind: "conflict"; reason: string }
  | { kind: "ambiguous"; reason: string }
  | { kind: "failed"; reason: string };

export interface PublishFindingInput {
  finding: AuditFinding;
  defectId: string;
  /** Present and non-null when the matched/created defect already carries a published Issue reference -- build spec Sec 9 dedup check #2. */
  existingExternalIssueRef: DefectExternalIssueRef | null;
  owner: string;
  repo: string;
  token: string;
  now: string;
}

/**
 * Build spec Sec 9: the three-check dedup/publication sequence. Check #1
 * (M42 fingerprint match) and check #2 (existingExternalIssueRef presence)
 * are already resolved by the caller (night-audit-defect-intake-service.ts)
 * before this function is ever invoked -- `existingExternalIssueRef`
 * non-null short-circuits immediately. Only check #3 (GitHub search by
 * label + fingerprint marker) happens here, exactly once, before any
 * create call.
 */
export async function publishAuditFinding(input: PublishFindingInput, client: GithubIssueClient): Promise<PublishFindingOutcome> {
  if (input.existingExternalIssueRef !== null) {
    return { kind: "skipped_already_published", issueRef: input.existingExternalIssueRef };
  }

  const marker = buildIssueFingerprintMarker(input.finding.findingKey);

  const before = await client.searchOpenIssuesByLabel(input.owner, input.repo, AUDIT_ISSUE_LABEL, input.token);
  if (!before.ok) {
    return { kind: "ambiguous", reason: `Could not search existing audit issues: ${before.message}` };
  }
  const beforeMatches = before.value.filter((i) => i.body?.includes(marker) === true);
  if (beforeMatches.length > 1) {
    return {
      kind: "conflict",
      reason: `${beforeMatches.length} existing audit issues already carry fingerprint ${input.finding.findingKey} (#${beforeMatches.map((i) => i.number).join(", #")}). AIQT will not guess which one this finding owns.`,
    };
  }
  if (beforeMatches.length === 1) {
    const issue = beforeMatches[0]!;
    return { kind: "reconciled", issueRef: { provider: "github", number: issue.number, url: issue.htmlUrl, publishedAt: input.now } };
  }

  // --- Create --------------------------------------------------------------
  const created = await client.createIssue(
    input.owner,
    input.repo,
    { title: buildIssueTitle(input.finding), body: buildIssueBody(input.finding, input.defectId), labels: [AUDIT_ISSUE_LABEL] },
    input.token,
  );
  if (created.ok) {
    return { kind: "created", issueRef: { provider: "github", number: created.value.number, url: created.value.htmlUrl, publishedAt: input.now } };
  }

  // A create that failed never proves nothing happened -- look up, never
  // retry blind (build spec Sec 9, mirroring pr-create-service.ts exactly).
  const after = await client.searchOpenIssuesByLabel(input.owner, input.repo, AUDIT_ISSUE_LABEL, input.token);
  if (!after.ok) {
    return { kind: "ambiguous", reason: `Issue creation failed (${created.message}) and the follow-up search also failed (${after.message}), so whether an issue now exists is unknown.` };
  }
  const afterMatches = after.value.filter((i) => i.body?.includes(marker) === true);
  if (afterMatches.length === 1) {
    const issue = afterMatches[0]!;
    return { kind: "reconciled", issueRef: { provider: "github", number: issue.number, url: issue.htmlUrl, publishedAt: input.now } };
  }
  if (afterMatches.length === 0) {
    return { kind: "failed", reason: `Issue creation failed: ${created.message}` };
  }
  return { kind: "conflict", reason: `Issue creation reported "${created.message}", and ${afterMatches.length} existing audit issues now carry this fingerprint.` };
}

export interface BacklogCheckOutcome {
  ok: boolean;
  /** Open audit-issue count, when ok. */
  count: number;
  /** True once count reaches the session's maxOpenAuditIssueBacklog -- build spec Sec 11: publication is suppressed, review continues. */
  suppressed: boolean;
  reason?: string;
}

/** Build spec Sec 11: one bounded read at session start, reused for the whole session rather than re-queried before every publication. */
export async function checkAuditIssueBacklog(owner: string, repo: string, token: string, maxOpenAuditIssueBacklog: number, client: GithubIssueClient): Promise<BacklogCheckOutcome> {
  const result = await client.searchOpenIssuesByLabel(owner, repo, AUDIT_ISSUE_LABEL, token);
  if (!result.ok) {
    return { ok: false, count: 0, suppressed: false, reason: result.message };
  }
  return { ok: true, count: result.value.length, suppressed: result.value.length >= maxOpenAuditIssueBacklog };
}
