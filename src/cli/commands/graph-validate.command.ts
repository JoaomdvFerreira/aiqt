import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";
import { validateGraph } from "../../services/graph-validation-service.js";

/**
 * aiqt graph validate (M12 §8.3): read-only structural and semantic graph
 * validation. Reuses the shared review/warning collectors; never mutates
 * state or appends a runlog event.
 */
export function runGraphValidate(ctx: CommandContext): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "graph",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-VALIDATE-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const { paths, project, state } = loadProject(ctx);
    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const validation = validateGraph(project, state, knownPacketIds);

    if (validation.blockingErrors.length > 0) {
      return makeResult({
        status: "failed",
        action: "graph",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Graph validation found ${validation.blockingErrors.length} blocking error(s).`,
        nextRecommendedCommand: "aiqt graph repair --dry-run",
        exitCode: ExitCode.ValidationFailed,
        blockingIssues: validation.blockingErrors.map((e) => ({
          id: `GRAPH-VALIDATE-${e.rule.toUpperCase()}`,
          severity: "critical",
          area: "graph",
          message: e.message,
          agentCanFix: false,
        })),
        data: { blockingErrors: validation.blockingErrors, warnings: validation.warnings },
      });
    }

    const status = validation.warnings.length > 0 ? "warning" : "passed";
    const summary =
      validation.warnings.length > 0
        ? `Graph validation completed with ${validation.warnings.length} warning(s).`
        : "Graph validation completed with no findings.";

    return makeResult({
      status,
      action: "graph",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary,
      exitCode: ExitCode.Success,
      warnings: validation.warnings.map((w) => ({
        id: `GRAPH-VALIDATE-${w.rule.toUpperCase()}`,
        severity: "medium",
        area: "graph",
        message: w.message,
        agentCanFix: false,
      })),
      data: { blockingErrors: validation.blockingErrors, warnings: validation.warnings },
    });
  } catch (err) {
    return errorToResult("graph", err);
  }
}
