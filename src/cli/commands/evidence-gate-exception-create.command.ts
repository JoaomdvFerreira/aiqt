import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildExceptionCreatedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { nextId } from "../../state/ids.js";
import { getRequiredModeActivations, getEnforcementProfiles, findEnforcementProfile, getRequiredEvidenceExceptions } from "../../services/evidence-enforcement-service.js";
import { RequiredGateSchema, type RequiredGate } from "../../schema/required-rule-recovery-proof.schema.js";
import { MAX_EXCEPTIONS, MAX_EXCEPTION_EXPIRY_SECONDS, type RequiredEvidenceException } from "../../schema/required-evidence-exception.schema.js";
import type { CheckpointGateProfile, ReviewGateProfile } from "../../schema/evidence-enforcement-profile.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGateExceptionCreateOptions {
  activationId?: string;
  gate?: string;
  workUnitId?: string;
  rules?: string;
  authorizedBy?: string;
  reason?: string;
  expiresAt?: string;
  confirmException?: string;
  preview?: boolean;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function gateProfileFor(profile: { gates: { checkpoint?: CheckpointGateProfile; developmentReview?: ReviewGateProfile; releaseReview?: ReviewGateProfile } }, gate: RequiredGate): CheckpointGateProfile | ReviewGateProfile | undefined {
  if (gate === "checkpoint") return profile.gates.checkpoint;
  if (gate === "development_review") return profile.gates.developmentReview;
  return profile.gates.releaseReview;
}

/**
 * aiqt evidence gate exception create --activation --gate [--work-unit]
 * --rules --authorized-by --reason --expires-at --confirm-exception
 * <project-id> [--preview] [--json] (M30 §5.4/§4.8): exact, governed,
 * expiring scoped exceptions -- never a generic force/skip/ignore-evidence
 * bypass. A profile must explicitly mark every waived rule as exception-
 * eligible; malformed references are never exception-eligible.
 */
export async function runEvidenceGateExceptionCreate(
  ctx: CommandContext,
  options: RunEvidenceGateExceptionCreateOptions,
): Promise<CommandResult> {
  try {
    if (!options.activationId) {
      return failure("aiqt evidence gate exception create requires --activation <activation-id>.", ExitCode.HumanInputRequired, "EXCEPTION-CREATE-NO-ACTIVATION");
    }
    const gateParse = RequiredGateSchema.safeParse((options.gate ?? "").replace(/-/g, "_"));
    if (!options.gate || !gateParse.success) {
      return failure("aiqt evidence gate exception create requires --gate <checkpoint|development-review|release-review>.", ExitCode.HumanInputRequired, "EXCEPTION-CREATE-NO-GATE");
    }
    if (!options.rules || options.rules.trim() === "") {
      return failure("aiqt evidence gate exception create requires --rules <comma-separated-rule-ids>.", ExitCode.HumanInputRequired, "EXCEPTION-CREATE-NO-RULES");
    }
    if (!options.authorizedBy || !options.reason || !options.expiresAt || !options.confirmException) {
      return failure("aiqt evidence gate exception create requires --authorized-by, --reason, --expires-at, and --confirm-exception <project-id>.", ExitCode.HumanInputRequired, "EXCEPTION-CREATE-MISSING-HUMAN-INPUT");
    }
    if (!isValidIsoTimestamp(options.expiresAt)) {
      return failure(`Invalid --expires-at timestamp: ${options.expiresAt}`, ExitCode.InvalidInput, "EXCEPTION-CREATE-INVALID-EXPIRY");
    }

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EXCEPTION-CREATE-NO-PROJECT");
    }
    const { paths, project, state } = loadProject(ctx);

    if (options.confirmException !== project.project.id) {
      return failure(`--confirm-exception must exactly match the current project id ("${project.project.id}").`, ExitCode.InvalidInput, "EXCEPTION-CREATE-CONFIRMATION-MISMATCH");
    }

    const now = new Date().toISOString();
    if (new Date(options.expiresAt).getTime() - new Date(now).getTime() > MAX_EXCEPTION_EXPIRY_SECONDS * 1000) {
      return failure(`--expires-at must be within ${MAX_EXCEPTION_EXPIRY_SECONDS / 86400} days.`, ExitCode.InvalidInput, "EXCEPTION-CREATE-EXPIRY-TOO-FAR");
    }
    if (new Date(options.expiresAt).getTime() <= new Date(now).getTime()) {
      return failure("--expires-at must be in the future.", ExitCode.InvalidInput, "EXCEPTION-CREATE-EXPIRY-IN-PAST");
    }

    const activation = getRequiredModeActivations(state).find((a) => a.activationId === options.activationId);
    if (!activation || activation.status !== "active") {
      return failure(`No active activation "${options.activationId}" exists.`, ExitCode.WorkflowBlocked, "EXCEPTION-CREATE-UNKNOWN-ACTIVATION");
    }

    const profile = findEnforcementProfile(activation.profileRef.profileId, activation.profileRef.version, getEnforcementProfiles(state));
    const gate = gateParse.data;
    const gateProfile = profile ? gateProfileFor(profile, gate) : undefined;
    if (!profile || !gateProfile) {
      return failure(`The active profile has no "${options.gate}" gate configured.`, ExitCode.InvalidInput, "EXCEPTION-CREATE-NO-GATE-PROFILE");
    }

    const ruleIds = options.rules.split(",").map((r) => r.trim()).filter((r) => r.length > 0);
    if (ruleIds.length === 0) {
      return failure("--rules must contain at least one rule id.", ExitCode.InvalidInput, "EXCEPTION-CREATE-EMPTY-RULES");
    }
    const ineligible = ruleIds.filter((r) => !gateProfile.exceptionEligibleRuleIds.includes(r));
    if (ineligible.length > 0) {
      return failure(`The following rules are not exception-eligible in this profile: ${ineligible.join(", ")}.`, ExitCode.InvalidInput, "EXCEPTION-CREATE-RULE-NOT-ELIGIBLE");
    }

    if (gate === "checkpoint" && !options.workUnitId) {
      return failure("A checkpoint-gate exception must target exactly one Work Unit via --work-unit.", ExitCode.InvalidInput, "EXCEPTION-CREATE-CHECKPOINT-REQUIRES-WORK-UNIT");
    }
    if (options.workUnitId && !state.workGraph.workUnits.some((wu) => wu.id === options.workUnitId)) {
      return failure(`Work unit "${options.workUnitId}" does not exist.`, ExitCode.InvalidInput, "EXCEPTION-CREATE-UNKNOWN-WORK-UNIT");
    }

    const existingExceptions = getRequiredEvidenceExceptions(state);
    if (existingExceptions.length >= MAX_EXCEPTIONS) {
      return failure(`State/exception cap reached (max_exceptions=${MAX_EXCEPTIONS}).`, ExitCode.WorkflowBlocked, "EXCEPTION-CREATE-CAP-REACHED");
    }

    const exceptionId = nextId("REX", existingExceptions.map((e) => e.exceptionId));
    const newException: RequiredEvidenceException = {
      protocolVersion: "aiqt-required-evidence-exception@1",
      exceptionId,
      activationId: activation.activationId,
      gate,
      scope: { projectId: project.project.id, ...(options.workUnitId ? { workUnitId: options.workUnitId } : {}) },
      policyDigest: gateProfile.policyRef.digest,
      ruleIds,
      authorizedBy: options.authorizedBy,
      reason: options.reason,
      createdAt: now,
      expiresAt: options.expiresAt,
      usage: { mode: gate === "checkpoint" ? "single_use" : "until_expiry" },
      status: "active",
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would create scoped exception for gate ${gate}, rule(s) ${ruleIds.join(", ")}; no state written.`,
        exitCode: ExitCode.Success,
        data: { exception: newException, outcome: "preview" },
      });
    }

    const finalState: StateModel = { ...state, requiredEvidenceExceptions: [...existingExceptions, newException] };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildExceptionCreatedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [exceptionId, activation.activationId],
          data: { exceptionId, activationId: activation.activationId, gate, ruleIds, authorizedBy: options.authorizedBy, expiresAt: options.expiresAt },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this creation is idempotent.`,
        ExitCode.InvalidInput,
        "EXCEPTION-CREATE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Created scoped exception ${exceptionId} for gate ${gate} (rule(s): ${ruleIds.join(", ")}).`,
      completedActions: ["Validated exception eligibility", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [exceptionId],
      exitCode: ExitCode.Success,
      data: { exception: newException, outcome: "created" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EXCEPTION-CREATE-UNEXPECTED-ERROR");
  }
}
