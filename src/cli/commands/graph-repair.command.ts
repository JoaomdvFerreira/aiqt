import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { readAgentPacketIds } from "../../state/runlog-store.js";
import { validateGraph } from "../../services/graph-validation-service.js";
import { buildGraphRepairPlan } from "../../services/graph-repair-service.js";

export interface RunGraphRepairOptions {
  dryRun?: boolean;
}

/**
 * aiqt graph repair --dry-run (M12 §8.4): read-only candidate repair
 * planning built from aiqt graph validate findings. No apply mode exists in
 * M12; --dry-run is required. Never mutates state, files, or runlog.
 */
export function runGraphRepair(
  ctx: CommandContext,
  options: RunGraphRepairOptions,
): CommandResult {
  try {
    if (!options.dryRun) {
      const message = "aiqt graph repair requires --dry-run. No apply mode exists in this version.";
      return makeResult({
        status: "failed",
        action: "graph",
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-MISSING-DRY-RUN",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "graph",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-NO-PROJECT",
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
    const plan = buildGraphRepairPlan(validation);

    if (plan.suggestions.length === 0) {
      const message = "Graph is readable, but no deterministic repair suggestions are available.";
      return makeResult({
        status: "blocked",
        action: "graph",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: "aiqt graph validate",
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "GRAPH-REPAIR-NO-DETERMINISTIC-SUGGESTIONS",
            severity: "medium",
            area: "graph",
            message,
            agentCanFix: false,
          },
        ],
        data: plan,
      });
    }

    return makeResult({
      status: "warning",
      action: "graph",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Graph repair dry-run generated ${plan.suggestions.length} candidate repair(s).`,
      nextRecommendedCommand: "aiqt graph validate",
      exitCode: ExitCode.Success,
      data: plan,
    });
  } catch (err) {
    return errorToResult("graph", err);
  }
}
