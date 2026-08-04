import type { CommandResult } from "./result.js";
import type { Issue } from "./issue.js";

/**
 * M33-WU04 Sec "Human review output lists active findings and stable keys
 * where actionable": every rendered issue now shows its stable `id` inline,
 * not only its message -- previously the id (the exact string an operator
 * needs for e.g. `aiqt review acknowledge <findingKey>` or `aiqt issue
 * update <issueKey>`) was visible only in --json output.
 */
function renderIssue(issue: Issue): string {
  const parts = [`  - [${issue.severity}] (${issue.area}) ${issue.id}: ${issue.message}`];
  if (issue.suggestedAction) {
    parts.push(`    suggested: ${issue.suggestedAction}`);
  }
  return parts.join("\n");
}

/**
 * M33-WU04 Sec 5.8 (specialized renderer policy): the shared trailing block
 * every specialized human-mode renderer (packet text, prompt text, manage
 * report, skills plan report, issue list report, repair plan report,
 * parallel-status report) appends after its own bespoke content, so each
 * still exposes status/warnings/blocking issues/human-input requirement/next
 * recommended command even though it preserves a domain-specific body.
 * Mirrors the tail of renderHuman() exactly so a specialized command and the
 * generic renderer never disagree on how these fields are presented.
 */
export function renderResultFooter(result: CommandResult): string {
  const lines: string[] = ["", `Status: ${result.status}`];

  if (result.blockingIssues.length > 0) {
    lines.push("", "Blocking issues:");
    for (const issue of result.blockingIssues) {
      lines.push(renderIssue(issue));
    }
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of result.warnings) {
      lines.push(renderIssue(warning));
    }
  }

  if (result.requiresHumanInput) {
    lines.push("", "Human input required.");
  }
  lines.push(
    "",
    `Next recommended command: ${result.nextRecommendedCommand ?? "(none)"}`,
  );

  return lines.join("\n");
}

/**
 * Render a CommandResult as human-readable text. Deterministic and stable so
 * it is safe to snapshot in tests.
 */
export function renderHuman(result: CommandResult): string {
  const lines: string[] = [];

  lines.push(`AIQT ${result.action}: ${result.status}`);
  lines.push(result.summary);
  lines.push("");

  if (result.projectStatus !== null) {
    lines.push(`Project status: ${result.projectStatus}`);
  }
  if (result.currentMilestoneId !== null) {
    lines.push(`Current milestone: ${result.currentMilestoneId}`);
  }
  if (result.currentWorkUnitId !== null) {
    lines.push(`Current work unit: ${result.currentWorkUnitId}`);
  }

  if (result.completedActions.length > 0) {
    lines.push("");
    lines.push("Completed:");
    for (const action of result.completedActions) {
      lines.push(`  - ${action}`);
    }
  }

  if (result.changedFiles.length > 0) {
    lines.push("");
    lines.push("Changed files:");
    for (const file of result.changedFiles) {
      lines.push(`  - ${file}`);
    }
  }

  if (result.blockingIssues.length > 0) {
    lines.push("");
    lines.push("Blocking issues:");
    for (const issue of result.blockingIssues) {
      lines.push(renderIssue(issue));
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(renderIssue(warning));
    }
  }

  lines.push("");
  if (result.requiresHumanInput) {
    lines.push("Human input required.");
  }
  lines.push(
    `Next recommended command: ${
      result.nextRecommendedCommand ?? "(none)"
    }`,
  );

  return lines.join("\n");
}
