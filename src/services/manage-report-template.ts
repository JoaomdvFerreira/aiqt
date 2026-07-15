import type { ManageReport } from "./manage-service.js";
import { WORK_UNIT_STATUSES } from "../workflow/statuses.js";
import type { WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { RootResolution } from "../workflow/root-resolution.js";

function bulletList(items: readonly string[]): string {
  if (items.length === 0) return "- None.";
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Deterministic, human-readable aiqt manage report (§8.1). Printed directly
 * in human mode (bypassing the generic CommandResult renderer), mirroring
 * aiqt next/aiqt prompt's raw-text bypass pattern.
 */
export function renderManageReportText(params: {
  projectName: string;
  report: ManageReport;
  roots: RootResolution;
  currentMilestoneId: string | null;
  currentWorkUnitId: string | null;
}): string {
  const { projectName, report, roots, currentMilestoneId, currentWorkUnitId } = params;
  const lines: string[] = [];

  lines.push(`# AIQT Manager Report: ${projectName}`, "");

  // M16 §10: root summary. AIQT does not verify Git state here or anywhere
  // else in aiqt manage -- these are the runtime-resolved control/
  // implementation roots only.
  lines.push("## Root Configuration", "");
  lines.push(`- AIQT control root: ${roots.controlRoot}`);
  lines.push(`- Implementation root: ${roots.implementationRoot}`);
  lines.push(`- Same root: ${roots.sameRoot ? "yes" : "no"}`, "");

  lines.push("## Project Status", "");
  lines.push(`- Status: ${report.projectStatus}`, "");

  lines.push("## Current Workflow Position", "");
  lines.push(`- Current milestone: ${currentMilestoneId ?? "None"}`);
  lines.push(`- Current work unit: ${currentWorkUnitId ?? "None"}`, "");

  lines.push("## Work Unit Counts", "");
  lines.push(
    WORK_UNIT_STATUSES.map((s: WorkUnitStatus) => `- ${s}: ${report.counts[s] ?? 0}`).join("\n"),
    "",
  );

  lines.push("## Ready, Blocked, and Needs-Review Work", "");
  lines.push(`- Ready: ${report.counts["ready"] ?? 0}`);
  lines.push(`- Planned (blocked): ${report.counts["planned"] ?? 0}`);
  lines.push(`- Needs review: ${report.counts["needs_review"] ?? 0}`, "");

  lines.push("## Active Review Findings", "");
  lines.push(
    report.activeFindings.length > 0
      ? bulletList(
          report.activeFindings.map(
            (f) =>
              `[${f.findingKey}] (${f.severity}${f.blocking ? ", blocking" : ""}${f.acknowledged ? ", acknowledged" : ""}) ${f.message}`,
          ),
        )
      : "- None.",
    "",
  );

  lines.push("## Acknowledged Findings", "");
  lines.push(
    report.acknowledgedFindings.length > 0
      ? bulletList(
          report.acknowledgedFindings.map(
            (a) =>
              `[${a.findingKey}] ${a.reason} (acknowledged ${a.acknowledgedAt}${a.stillActive ? "" : ", no longer active"})`,
          ),
        )
      : "- None.",
    "",
  );

  lines.push("## Open Checkpoint Issues", "");
  lines.push(bulletList([...report.userActionRequired, ...report.agentFixableIssues]), "");

  lines.push("## User-Action-Required Items", "");
  lines.push(bulletList(report.userActionRequired), "");

  lines.push("## External Verification Gaps", "");
  lines.push(bulletList(report.externalVerificationGaps), "");

  lines.push("## Agent-Fixable Unresolved Issues", "");
  lines.push(bulletList(report.agentFixableIssues), "");

  lines.push("## Release Blockers", "");
  lines.push(bulletList(report.releaseBlockers), "");

  lines.push("## Post-MVP Backlog Candidates", "");
  lines.push(bulletList(report.postMvpBacklogCandidates), "");

  lines.push("## Development-Complete Classification", "");
  lines.push(`- Development complete: ${report.developmentComplete ? "yes" : "no"}`, "");

  lines.push("## Production-Ready Classification", "");
  lines.push(`- Production ready: ${report.productionReady ? "yes" : "no"}`, "");

  lines.push("## Recommended Next Command", "");
  lines.push(report.recommendedCommand, "");

  lines.push("## Reason", "");
  lines.push(report.reason);

  return lines.join("\n");
}
