import type { IssueListData } from "../cli/commands/issue-list.command.js";
import type { RepairPlanData } from "../cli/commands/repair-plan.command.js";

function bulletList(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

/** Deterministic, human-readable aiqt issue list report, printed in human mode. */
export function renderIssueListText(data: IssueListData): string {
  const lines: string[] = [];
  lines.push("# AIQT Issue List", "");

  lines.push("## Counts", "");
  lines.push(
    bulletList([
      `active: ${data.counts.active}`,
      `accepted: ${data.counts.accepted}`,
      `deferred: ${data.counts.deferred}`,
      `resolved: ${data.counts.resolved}`,
      `post_mvp: ${data.counts.post_mvp}`,
      `promoted: ${data.counts.promoted}`,
    ]),
    "",
  );

  lines.push("## Issues", "");
  if (data.issues.length === 0) {
    lines.push("- None.");
  } else {
    for (const issue of data.issues) {
      lines.push(`### ${issue.issueKey}`);
      lines.push(`- Source: ${issue.source}`);
      lines.push(`- Work unit: ${issue.workUnitId ?? "(none)"}`);
      lines.push(`- Status: ${issue.status}`);
      lines.push(`- Classification: ${issue.classification.length > 0 ? issue.classification.join(", ") : "(none)"}`);
      lines.push(`- Message: ${issue.message}`);
      lines.push(`- Promoted work unit: ${issue.promotedWorkUnitId ?? "(none)"}`, "");
    }
  }

  return lines.join("\n").trimEnd();
}

/** Deterministic, human-readable aiqt repair plan report, printed in human mode. */
export function renderRepairPlanText(data: RepairPlanData): string {
  const lines: string[] = [];
  lines.push("# AIQT Repair Plan", "");

  lines.push("## Recommended Repairs", "");
  if (data.recommendedRepairs.length === 0) {
    lines.push("- None.");
  } else {
    for (const repair of data.recommendedRepairs) {
      lines.push(`### ${repair.issueKey}`);
      lines.push(`- Title: ${repair.title}`);
      lines.push(`- Promotable: ${repair.promotable}`);
      lines.push(`- Recommended command: ${repair.recommendedCommand}`, "");
    }
  }

  return lines.join("\n").trimEnd();
}
