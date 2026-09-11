import { join } from "node:path";
import type { CommandContext } from "../cli/command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
  type CommandStatus,
  type WorkflowAction,
} from "../core/output/result.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import { isFile } from "../core/filesystem/file-exists.js";
import { aiqtDirExists, loadProject } from "../cli/commands/load-project.js";
import { computeGuidance } from "../workflow/guidance-rules.js";
import type { GuidanceResultData } from "../schema/guidance-result.schema.js";
import { assessWorkflow } from "../workflow/workflow-assessment.js";
import { readAgentPacketIds } from "../state/runlog-store.js";
import { runReview } from "./review-service.js";
import { classifyFindings } from "./manage-service.js";
import { deriveCanonicalHandoff, resolveHandoffRevisionFacts } from "../workflow/canonical-handoff.js";
import { resolveRoots } from "../workflow/root-resolution.js";

function notInitializedGuidanceData(): GuidanceResultData {
  return {
    stage: "not_initialized",
    guidance: "No AIQT project found in this folder. Run aiqt init first.",
    recommendedCommand: "aiqt init",
    alternativeCommands: [],
    promptCommand: null,
    expectedInputPath: null,
    followUpCommand: null,
    canProceedWithoutAgent: true,
  };
}

function invalidStateGuidanceData(): GuidanceResultData {
  return {
    stage: "invalid_state",
    guidance:
      "Canonical AIQT files are invalid or use an unsupported schema version. Run aiqt status, then repair or upgrade AIQT.",
    recommendedCommand: "aiqt status",
    alternativeCommands: [],
    promptCommand: null,
    expectedInputPath: null,
    followUpCommand: null,
    canProceedWithoutAgent: true,
  };
}

/**
 * Shared read-only navigation engine for aiqt start and aiqt continue. The
 * two commands are intentionally equivalent in M7; only the `action` label
 * (and therefore the reported CommandResult.action) differs.
 */
export function runGuidanceCommand(
  ctx: CommandContext,
  action: Extract<WorkflowAction, "start" | "continue">,
): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action,
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: `${action.toUpperCase()}-NO-PROJECT`,
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
        data: notInitializedGuidanceData(),
      });
    }

    let loaded;
    try {
      loaded = loadProject(ctx);
    } catch (err) {
      if (err instanceof AiqtError) {
        return makeResult({
          status: "failed",
          action,
          summary: err.message,
          nextRecommendedCommand: "aiqt status",
          exitCode: err.exitCode,
          blockingIssues: err.issue ? [err.issue] : [],
          data: invalidStateGuidanceData(),
        });
      }
      throw err;
    }

    const { paths, project, state, warnings } = loaded;
    const checkpointInputExists = isFile(join(paths.inputsDir, "checkpoint.json"));
    const review = runReview(project, state, readAgentPacketIds(paths.runlogFile, state.lastAgentPacket));
    const classification = classifyFindings(project, state, review);
    const allWorkUnitStatusesDone =
      state.workGraph.workUnits.length > 0 &&
      state.workGraph.workUnits.every((wu) => wu.status === "done");
    const productionReady = allWorkUnitStatusesDone ? classification.productionReady : null;
    const assessment = assessWorkflow(project, state, { productionReady });
    const guidance = computeGuidance({ project, state, checkpointInputExists, productionReady });
    const activeHandoff = state.currentWorkUnitId === null ? null : (() => {
      const roots = resolveRoots({ controlRoot: paths.root, existingRepositoryPath: project.project.existingRepositoryPath });
      return deriveCanonicalHandoff({ project, state, workUnitId: state.currentWorkUnitId!, roots, revision: resolveHandoffRevisionFacts(roots), reviewFindings: review.findings });
    })();

    const status: CommandStatus = guidance.stage === "needs_review" ? "warning" : "passed";

    return makeResult({
      status,
      action,
      projectStatus: assessment.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: guidance.guidance,
      completedActions: ["Read project.json", "Read state.json", "Evaluated guided workflow rules"],
      changedFiles: [],
      affectedItems: [project.project.id],
      warnings,
      nextRecommendedCommand: guidance.recommendedCommand,
      exitCode: ExitCode.Success,
      data: { ...guidance, canonicalHandoff: activeHandoff },
    });
  } catch (err) {
    return errorToResult(action, err);
  }
}
