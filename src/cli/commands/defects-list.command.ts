import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { DefectStatusSchema } from "../../schema/defect.schema.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

export interface RunDefectsListOptions {
  status?: string;
}

/** aiqt defects list [--status <status>] [--json] (M42 §7/§9 WU42-03): read-only, unfiltered order = canonical storage order. */
export function runDefectsList(ctx: CommandContext, options: RunDefectsListOptions): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-LIST-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const all = state.defects ?? [];

  let statusFilter: string | undefined;
  if (options.status) {
    const parsed = DefectStatusSchema.safeParse(options.status);
    if (!parsed.success) {
      return failure(`Invalid --status "${options.status}".`, ExitCode.InvalidInput, "DEFECTS-LIST-INVALID-STATUS");
    }
    statusFilter = parsed.data;
  }

  const defects = statusFilter ? all.filter((d) => d.status === statusFilter) : all;

  return makeResult({
    status: "passed",
    action: "defects",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${defects.length} defect(s)${statusFilter ? ` with status "${statusFilter}"` : ""} (${all.length} total).`,
    exitCode: ExitCode.Success,
    data: { defects, totalCount: all.length },
  });
}
