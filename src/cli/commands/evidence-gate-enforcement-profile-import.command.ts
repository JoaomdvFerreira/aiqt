import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildEnforcementProfileImportedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { readBoundedTextFile } from "../../core/filesystem/bounded-file-input.js";
import { assertSafeParsedJson } from "../../schema/external-evidence/limits.js";
import {
  EvidenceEnforcementProfileInputSchema,
  MAX_ENFORCEMENT_PROFILE_BYTES,
  MAX_ENFORCEMENT_PROFILES,
  MAX_VERSIONS_PER_ENFORCEMENT_PROFILE,
} from "../../schema/evidence-enforcement-profile.schema.js";
import type { EvidenceEnforcementProfile } from "../../schema/evidence-enforcement-profile.schema.js";
import {
  getEnforcementProfiles,
  findEnforcementProfile,
  findEnforcementProfileVersions,
  maxEnforcementProfileVersion,
} from "../../services/evidence-enforcement-service.js";
import { computeEnforcementProfileDigest } from "../../workflow/evidence-enforcement-profile-identity.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateEnforcementProfileImportOptions {
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RunEvidenceGateEnforcementProfileImportDeps {
  stdin?: StdinLike;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return makeResult({
    status: exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed",
    action: "evidence",
    summary,
    exitCode,
    blockingIssues: [{ id: issueId, severity: "high", area: "evidence-gate", message: summary, agentCanFix: false }],
  });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * aiqt evidence gate enforcement profile import --from-file <path> | --stdin
 * [--preview] [--json] (M30 §5.1): the sole boundary for importing an
 * immutable enforcement profile version. Never activates enforcement --
 * import only ever adds a candidate profile version to canonical state.
 */
export async function runEvidenceGateEnforcementProfileImport(
  ctx: CommandContext,
  options: RunEvidenceGateEnforcementProfileImportOptions,
  deps: RunEvidenceGateEnforcementProfileImportDeps = {},
): Promise<CommandResult> {
  try {
    if (options.fromFile && options.stdin) {
      return failure("aiqt evidence gate enforcement profile import accepts exactly one of --from-file or --stdin, not both.", ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-CONFLICTING-INPUT");
    }
    if (!options.fromFile && !options.stdin) {
      return failure("aiqt evidence gate enforcement profile import requires --from-file <path> or --stdin.", ExitCode.HumanInputRequired, "ENFORCEMENT-PROFILE-IMPORT-NO-INPUT");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    let rawText: string;
    if (options.fromFile) {
      const read = readBoundedTextFile(options.fromFile, MAX_ENFORCEMENT_PROFILE_BYTES);
      if (!read.ok) return failure(read.error, ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-FILE-INVALID");
      rawText = read.text;
    } else {
      if (isStdinInteractiveTty(deps.stdin)) {
        return failure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-STDIN-TTY");
      }
      rawText = await readStdinText(deps.stdin);
      if (rawText.trim() === "") {
        return failure("Received empty input on stdin.", ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-STDIN-EMPTY");
      }
      if (Buffer.byteLength(rawText, "utf8") > MAX_ENFORCEMENT_PROFILE_BYTES) {
        return failure(`Input exceeds max_profile_bytes (${MAX_ENFORCEMENT_PROFILE_BYTES}).`, ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-STDIN-TOO-LARGE");
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
      assertSafeParsedJson(parsed);
    } catch (err) {
      return failure(`Malformed or unsafe JSON payload: ${(err as Error).message}`, ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-MALFORMED");
    }

    const inputParse = EvidenceEnforcementProfileInputSchema.safeParse(parsed);
    if (!inputParse.success) {
      const firstIssue = inputParse.error.issues[0];
      return failure(
        `Profile failed schema validation${firstIssue ? ` at ${firstIssue.path.join(".") || "$"}: ${firstIssue.message}` : ""}.`,
        ExitCode.InvalidInput,
        "ENFORCEMENT-PROFILE-IMPORT-SCHEMA-INVALID",
      );
    }
    const input = inputParse.data;

    const profiles = getEnforcementProfiles(state);
    if (findEnforcementProfileVersions(input.profileId, profiles).length === 0 && profiles.length > 0) {
      const distinctProfileIds = new Set(profiles.map((p) => p.profileId));
      if (distinctProfileIds.size >= MAX_ENFORCEMENT_PROFILES) {
        return failure(`State/profile cap reached (max_profiles=${MAX_ENFORCEMENT_PROFILES}).`, ExitCode.WorkflowBlocked, "ENFORCEMENT-PROFILE-IMPORT-CAP-REACHED");
      }
    }
    const existingVersions = findEnforcementProfileVersions(input.profileId, profiles);
    if (existingVersions.length >= MAX_VERSIONS_PER_ENFORCEMENT_PROFILE && !existingVersions.some((p) => p.version === input.version)) {
      return failure(`State/profile cap reached (max_versions_per_profile=${MAX_VERSIONS_PER_ENFORCEMENT_PROFILE}).`, ExitCode.WorkflowBlocked, "ENFORCEMENT-PROFILE-IMPORT-VERSION-CAP-REACHED");
    }

    const digest = computeEnforcementProfileDigest(input);
    const existingSameVersion = findEnforcementProfile(input.profileId, input.version, profiles);

    if (existingSameVersion) {
      if (existingSameVersion.profileDigest === digest) {
        return makeResult({
          status: "passed",
          action: "evidence",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: `Enforcement profile ${input.profileId} v${input.version} was already imported with this exact content (idempotent no-op).`,
          exitCode: ExitCode.Success,
          data: { profileId: input.profileId, version: input.version, outcome: "no_op" },
        });
      }
      return failure(
        `Enforcement profile ${input.profileId} v${input.version} already exists with different content (digest conflict).`,
        ExitCode.InvalidInput,
        "ENFORCEMENT-PROFILE-IMPORT-DIGEST-CONFLICT",
      );
    }

    const currentMax = maxEnforcementProfileVersion(input.profileId, profiles);
    if (input.version <= currentMax) {
      return failure(
        `Enforcement profile ${input.profileId} v${input.version} must exceed all prior versions (current max: v${currentMax}).`,
        ExitCode.InvalidInput,
        "ENFORCEMENT-PROFILE-IMPORT-VERSION-NOT-MONOTONIC",
      );
    }

    const newProfile: EvidenceEnforcementProfile = {
      ...input,
      profileDigest: digest,
      createdAt: effectiveNow,
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would import enforcement profile ${newProfile.profileId} v${newProfile.version}; no state written, no activation implied.`,
        exitCode: ExitCode.Success,
        data: { profile: newProfile, outcome: "import" },
      });
    }

    const finalState: StateModel = {
      ...state,
      enforcementProfiles: [...profiles, newProfile],
    };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildEnforcementProfileImportedEvent({
          id: nextEventId(),
          timestamp: effectiveNow,
          relatedIds: [newProfile.profileId],
          data: { profileId: newProfile.profileId, version: newProfile.version, profileDigest: newProfile.profileDigest },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this import is idempotent.`,
        ExitCode.InvalidInput,
        "ENFORCEMENT-PROFILE-IMPORT-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Imported enforcement profile ${newProfile.profileId} v${newProfile.version}. Import never activates enforcement.`,
      completedActions: ["Validated profile", "Computed canonical digest", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [newProfile.profileId],
      exitCode: ExitCode.Success,
      data: { profile: newProfile, outcome: "import" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "ENFORCEMENT-PROFILE-IMPORT-UNEXPECTED-ERROR");
  }
}
