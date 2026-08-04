import type { AutonomousCandidate, AutonomousEvidencePacket } from "../schema/autonomous-run.schema.js";

/**
 * M37-WU04 (build spec Sec 7 WU37-04 Scope: "PR draft text"). Pure text
 * generation -- no network call, no real PR is ever created, opened, or
 * approved by this function or anything it calls (build spec Sec 5 Out
 * of Scope: "automatic PR approval"). The operator pastes this text
 * into their own PR themselves, using whatever hosting/tooling they
 * already use; AIQT has no opinion on and no integration with any
 * specific Git host.
 */
export interface AutonomousPrDraft {
  title: string;
  body: string;
}

const MAX_TITLE_CHARS = 100;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildAutonomousPrDraft(candidate: AutonomousCandidate, packet: AutonomousEvidencePacket): AutonomousPrDraft {
  const title = truncate(`AIQT autonomous repair: ${candidate.objective}`, MAX_TITLE_CHARS);

  const lines: string[] = [];
  lines.push(`**Issue:** ${candidate.issueId}`);
  lines.push("");
  lines.push("**Objective**");
  lines.push(candidate.objective);
  lines.push("");
  if (candidate.acceptanceCriteria.length > 0) {
    lines.push("**Acceptance criteria**");
    for (const criterion of candidate.acceptanceCriteria) lines.push(`- ${criterion}`);
    lines.push("");
  }
  if (packet.diffSummary) {
    lines.push("**Changes**");
    lines.push(`${packet.diffSummary.changedFiles} file(s) changed, +${packet.diffSummary.insertedLines}/-${packet.diffSummary.deletedLines} lines.`);
    lines.push("");
  }
  if (packet.validation) {
    lines.push("**Validation**");
    lines.push(`Targeted validation: ${packet.validation.targetedTestsPassed ? "passed" : "did not pass"}.`);
    if (packet.validation.authoritativeValidationPassed !== null) {
      lines.push(`Authoritative validation: ${packet.validation.authoritativeValidationPassed ? "passed" : "failed"}.`);
    }
    lines.push("");
  }
  if (packet.findings.length > 0) {
    lines.push("**Self-review findings**");
    for (const finding of packet.findings) lines.push(`- ${finding}`);
    lines.push("");
  }
  lines.push("**Residual risk**");
  lines.push(packet.residualRisk);
  lines.push("");
  lines.push("---");
  lines.push("_This branch and diff were prepared autonomously by AIQT. Nothing has been merged, pushed, or deployed -- a human must review and merge this manually._");

  return { title, body: lines.join("\n") };
}
