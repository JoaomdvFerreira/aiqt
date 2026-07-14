import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { buildSkillsPlan } from "../../services/skills-detection-service.js";

/**
 * aiqt skills plan (M10 §11): a read-only integration skills bootstrap plan.
 * Never mutates state, writes files, installs anything, appends a runlog
 * event, or makes network calls.
 */
export function runSkillsPlan(ctx: CommandContext): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "skills",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "SKILLS-PLAN-NO-PROJECT",
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
    const plan = buildSkillsPlan(paths.root, project);

    const summary =
      plan.detectedIntegrations.length > 0
        ? `Detected ${plan.detectedIntegrations.length} integration(s): ${plan.detectedIntegrations.map((i) => i.displayName).join(", ")}.`
        : "No supported integrations detected.";

    return makeResult({
      status: "passed",
      action: "skills",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary,
      completedActions: ["Read project.json", "Read state.json", "Scanned repository for integration evidence"],
      changedFiles: [],
      affectedItems: [project.project.id],
      nextRecommendedCommand: null,
      exitCode: ExitCode.Success,
      data: plan,
    });
  } catch (err) {
    return errorToResult("skills", err);
  }
}
