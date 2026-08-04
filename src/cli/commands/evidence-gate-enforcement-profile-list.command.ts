import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getEnforcementProfiles } from "../../services/evidence-enforcement-service.js";

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

/** aiqt evidence gate enforcement profile list [--json] (M30 §5.1): read-only. Never materializes state on a project that lacks it. */
export function runEvidenceGateEnforcementProfileList(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-LIST-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const profiles = getEnforcementProfiles(state);

  const byProfileId = new Map<string, { profileId: string; versions: number[]; latestVersion: number }>();
  for (const p of profiles) {
    const entry = byProfileId.get(p.profileId) ?? { profileId: p.profileId, versions: [], latestVersion: 0 };
    entry.versions.push(p.version);
    entry.latestVersion = Math.max(entry.latestVersion, p.version);
    byProfileId.set(p.profileId, entry);
  }
  const summaries = [...byProfileId.values()]
    .map((e) => ({ ...e, versions: e.versions.sort((a, b) => a - b) }))
    .sort((a, b) => a.profileId.localeCompare(b.profileId));

  return makeResult({
    status: "passed",
    action: "evidence",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${summaries.length} enforcement profile(s) (${profiles.length} version(s) total). Import never activates enforcement.`,
    exitCode: ExitCode.Success,
    data: { profiles: summaries },
  });
}
