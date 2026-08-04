import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getEnforcementProfiles, findEnforcementProfile, findLatestEnforcementProfileVersion } from "../../services/evidence-enforcement-service.js";

export interface RunEvidenceGateEnforcementProfileShowOptions {
  profileId?: string;
  version?: number;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

/** aiqt evidence gate enforcement profile show <profile-id> [--version <n>] [--json] (M30 §5.1): read-only. */
export function runEvidenceGateEnforcementProfileShow(ctx: CommandContext, options: RunEvidenceGateEnforcementProfileShowOptions): CommandResult {
  if (!options.profileId) {
    return failure("aiqt evidence gate enforcement profile show requires <profile-id>.", ExitCode.HumanInputRequired, "ENFORCEMENT-PROFILE-SHOW-NO-PROFILE-ID");
  }
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-SHOW-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const profiles = getEnforcementProfiles(state);

  const profile = options.version !== undefined ? findEnforcementProfile(options.profileId, options.version, profiles) : findLatestEnforcementProfileVersion(options.profileId, profiles);
  if (!profile) {
    return failure(
      `No enforcement profile "${options.profileId}"${options.version !== undefined ? ` v${options.version}` : ""} exists.`,
      ExitCode.InvalidInput,
      "ENFORCEMENT-PROFILE-SHOW-NOT-FOUND",
    );
  }

  return makeResult({
    status: "passed",
    action: "evidence",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `Enforcement profile ${profile.profileId} v${profile.version}.`,
    exitCode: ExitCode.Success,
    data: { profile },
  });
}
