import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { QUEUE_ELIGIBLE_STATUSES } from "../../workflow/defect-transitions.js";
import { sortByQueuePriority } from "../../workflow/defect-triage.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

/**
 * aiqt defects queue [--json] (M42 §6.2/§9 WU42-03): read-only,
 * deterministically ordered view of the queue-eligible subset of
 * `state.defects` (queued/in_progress/needs_human) -- the queue IS this
 * filtered view, never a second stored list (Section 3.1).
 */
export function runDefectsQueue(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-QUEUE-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const eligible = (state.defects ?? []).filter((d) => QUEUE_ELIGIBLE_STATUSES.includes(d.status));
  const ordered = sortByQueuePriority(eligible);
  const humanGated = ordered.filter((d) => d.status === "needs_human").length;

  return makeResult({
    status: "passed",
    action: "defects",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${ordered.length} defect(s) in the remediation queue (${humanGated} awaiting human intervention).`,
    exitCode: ExitCode.Success,
    data: { queue: ordered, queueSize: ordered.length, needsHumanCount: humanGated },
  });
}
