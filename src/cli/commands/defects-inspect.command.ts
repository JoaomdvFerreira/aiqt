import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

/**
 * aiqt defects inspect <defectId> [--json] (M42 §7/§9 WU42-03): read-only,
 * full record including any triage decision -- human and --json output
 * derive from the identical canonical DefectRecord (Section 7's parity
 * requirement).
 */
export function runDefectsInspect(ctx: CommandContext, defectId: string): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-INSPECT-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const defect = (state.defects ?? []).find((d) => d.defectId === defectId);
  if (!defect) {
    return failure(`No defect "${defectId}" exists.`, ExitCode.InvalidInput, "DEFECTS-INSPECT-UNKNOWN-DEFECT");
  }

  return makeResult({
    status: "passed",
    action: "defects",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${defect.defectId}: ${defect.title} [${defect.status}, severity=${defect.severity}, confidence=${defect.confidence}]`,
    exitCode: ExitCode.Success,
    data: { defect },
  });
}
