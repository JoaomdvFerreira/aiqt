import type { CommandResult } from "./result.js";
import type { Issue } from "./issue.js";

function renderIssue(issue: Issue): string {
  const parts = [`  - [${issue.severity}] (${issue.area}) ${issue.message}`];
  if (issue.suggestedAction) {
    parts.push(`    suggested: ${issue.suggestedAction}`);
  }
  return parts.join("\n");
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
