import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildEvidenceGatePolicyActivatedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { getEvidenceGatePolicies, getActivePolicyRef, findPolicy } from "../../services/evidence-gate-policy-service.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGatePolicyActivateOptions {
  policyId?: string;
  version?: number;
  preview?: boolean;
  asOf?: string;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * aiqt evidence gate policy activate <policy-id> --version <n> [--preview]
 * [--json] (M28 §4.3): changes only the active-policy pointer. Never
 * evaluates evidence, never creates findings, never alters workflow
 * state.
 */
export async function runEvidenceGatePolicyActivate(ctx: CommandContext, options: RunEvidenceGatePolicyActivateOptions): Promise<CommandResult> {
  try {
    if (!options.policyId) {
      return failure("aiqt evidence gate policy activate requires <policy-id>.", ExitCode.HumanInputRequired, "EVIDENCE-GATE-POLICY-ACTIVATE-NO-POLICY-ID");
    }
    if (options.version === undefined) {
      return failure("aiqt evidence gate policy activate requires --version <n>.", ExitCode.HumanInputRequired, "EVIDENCE-GATE-POLICY-ACTIVATE-NO-VERSION");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-ACTIVATE-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-ACTIVATE-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);
    const policies = getEvidenceGatePolicies(state);

    const target = findPolicy(options.policyId, options.version, policies);
    if (!target) {
      return failure(`No policy "${options.policyId}" v${options.version} exists.`, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-ACTIVATE-NOT-FOUND");
    }

    const currentRef = getActivePolicyRef(state);
    if (currentRef && currentRef.policyId === target.policyId && currentRef.version === target.version) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Policy ${target.policyId} v${target.version} is already active (no-op).`,
        exitCode: ExitCode.Success,
        data: { activePolicyRef: currentRef, outcome: "no_op" },
      });
    }

    const newRef = { policyId: target.policyId, version: target.version };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would activate policy ${target.policyId} v${target.version}; no state written.`,
        exitCode: ExitCode.Success,
        data: { activePolicyRef: newRef, outcome: "activate" },
      });
    }

    const finalState: StateModel = { ...state, evidenceGate: { policies, activePolicyRef: newRef } };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildEvidenceGatePolicyActivatedEvent({
          id: nextEventId(),
          timestamp: effectiveNow,
          relatedIds: [target.policyId],
          data: { policyId: target.policyId, version: target.version, previousPolicyId: currentRef?.policyId ?? null, previousVersion: currentRef?.version ?? null },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-POLICY-ACTIVATE-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Activated evidence gate policy ${target.policyId} v${target.version}.`,
      completedActions: ["Validated policy version exists", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [target.policyId],
      exitCode: ExitCode.Success,
      data: { activePolicyRef: newRef, outcome: "activate" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-ACTIVATE-UNEXPECTED-ERROR");
  }
}
