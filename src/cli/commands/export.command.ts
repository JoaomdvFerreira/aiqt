import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
  type CommandStatus,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { Issue } from "../../core/output/issue.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeTextFile } from "../../core/filesystem/safe-writer.js";
import {
  appendRunlogEvent,
  buildExportGeneratedEvent,
  readRunlogEventIds,
  readAgentPacketIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { runReview } from "../../services/review-service.js";
import { computeReviewNextCommand } from "../../workflow/review-next-command.js";
import {
  isValidExportTarget,
  resolveTargets,
  planExportDocuments,
  buildExportResultData,
  type ExportTarget,
  type ExportDocumentPlan,
} from "../../services/export-service.js";

export interface RunExportOptions {
  target?: string;
  format?: string;
  dryRun?: boolean;
}

function skipWarning(plan: ExportDocumentPlan): Issue {
  return {
    id: `EXPORT-SKIPPED-${plan.target.toUpperCase()}`,
    severity: "medium",
    area: "export",
    message: plan.skipReason ?? `Export target "${plan.target}" was skipped.`,
    affectedItems: [plan.target],
    agentCanFix: false,
  };
}

export function runExport(
  ctx: CommandContext,
  options: RunExportOptions,
): CommandResult {
  try {
    // .aiqt/ missing has a specific next-command hint ("aiqt init") per the
    // M6 error table; the generic AiqtError -> errorToResult path used for
    // other pre-state failures below always leaves nextRecommendedCommand
    // null.
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "export",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "EXPORT-NO-PROJECT",
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

    // Gate 5: missing target -> exit 10; unsupported target -> exit 3.
    if (!options.target) {
      return makeResult({
        status: "needs_input",
        action: "export",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: "No export target supplied.",
        requiresHumanInput: true,
        nextRecommendedCommand: "aiqt export status-report",
        exitCode: ExitCode.HumanInputRequired,
      });
    }
    if (!isValidExportTarget(options.target)) {
      const message = `Unsupported export target "${options.target}".`;
      return makeResult({
        status: "failed",
        action: "export",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "EXPORT-UNSUPPORTED-TARGET",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }
    const target: ExportTarget = options.target;

    // Gate 6: unsupported format -> exit 3. markdown is the only supported
    // value and is also the default when omitted.
    const format = options.format ?? "markdown";
    if (format !== "markdown") {
      const message = `Unsupported export format "${format}". Only markdown is supported.`;
      return makeResult({
        status: "failed",
        action: "export",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand: null,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "EXPORT-UNSUPPORTED-FORMAT",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    // Gate 7: target-specific availability. status-report needs review
    // counts for its Findings Summary section, and export's own
    // nextRecommendedCommand reuses review's precedence exactly (§17.2).
    const knownPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const review = runReview(project, state, knownPacketIds);
    const targets = resolveTargets(target);
    const plans = planExportDocuments({
      targets,
      project,
      state,
      review,
      exportsDir: paths.exportsDir,
    });
    const availablePlans = plans.filter((p) => p.available);
    const unavailablePlans = plans.filter((p) => !p.available);
    const nextRecommendedCommand = computeReviewNextCommand(project, state, review.findings);

    if (availablePlans.length === 0) {
      const message =
        unavailablePlans[0]?.skipReason ?? "Requested export target is unavailable.";
      return makeResult({
        status: "blocked",
        action: "export",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        nextRecommendedCommand,
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "EXPORT-TARGET-UNAVAILABLE",
            severity: "high",
            area: "export",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const skipWarnings = unavailablePlans.map(skipWarning);
    const status: CommandStatus = skipWarnings.length > 0 ? "warning" : "passed";

    // Gate 8: --dry-run returns planned metadata without writing or logging.
    if (options.dryRun) {
      return makeResult({
        status,
        action: "export",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Dry run: ${availablePlans.length} export document(s) would be written.`,
        completedActions: ["Read project.json", "Read state.json", "Planned export documents"],
        changedFiles: [],
        affectedItems: [project.project.id],
        warnings: skipWarnings,
        nextRecommendedCommand,
        exitCode: ExitCode.Success,
        data: buildExportResultData({ target, dryRun: true, plans }),
      });
    }

    // Gates 9-11: render, write only under .aiqt/exports/, then log.
    for (const plan of availablePlans) {
      writeTextFile(plan.path, plan.content!);
    }
    const writtenFiles = availablePlans.map((p) => p.relativePath);

    const timestamp = new Date().toISOString();
    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    const relatedIds = [project.project.id];
    if (state.lastAgentPacket && availablePlans.some((p) => p.target === "agent-packet")) {
      relatedIds.push(state.lastAgentPacket.id);
    }
    const skippedTargets = unavailablePlans.map((p) => p.target);

    appendRunlogEvent(
      paths.runlogFile,
      buildExportGeneratedEvent({
        id: eventId,
        timestamp,
        relatedIds,
        data: {
          target,
          format: "markdown",
          files: writtenFiles,
          ...(skippedTargets.length > 0 ? { skippedTargets } : {}),
          dryRun: false,
        },
      }),
    );

    return makeResult({
      status,
      action: "export",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary:
        writtenFiles.length === 1
          ? "Generated AIQT export documents."
          : `Generated ${writtenFiles.length} export documents.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Rendered export documents",
        "Wrote export files",
        "Appended runlog event",
      ],
      changedFiles: writtenFiles,
      affectedItems: [project.project.id],
      warnings: skipWarnings,
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: buildExportResultData({ target, dryRun: false, plans }),
    });
  } catch (err) {
    return errorToResult("export", err);
  }
}
