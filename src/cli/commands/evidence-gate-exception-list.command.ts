import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getRequiredEvidenceExceptions } from "../../services/evidence-enforcement-service.js";

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

/** aiqt evidence gate exception list [--json] (M30 §5.4): read-only. */
export function runEvidenceGateExceptionList(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXCEPTION-LIST-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const exceptions = getRequiredEvidenceExceptions(state);

  return makeResult({
    status: "passed",
    action: "evidence",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${exceptions.length} scoped exception(s) (${exceptions.filter((e) => e.status === "active").length} active).`,
    exitCode: ExitCode.Success,
    data: { exceptions },
  });
}
