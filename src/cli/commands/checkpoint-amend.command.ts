import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildCheckpointAmendedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { applyWorkflowAssessmentToState } from "../../services/workflow-assessment-persistence.js";
import { selectNextReadyWorkUnit } from "../../workflow/next-work-unit-selector.js";
import { applyCheckpointAmendment, computeEffectiveCheckpointResult, getCheckpointAmendments } from "../../services/checkpoint-amendment-service.js";
import type { ReconciledAcceptanceCriterion } from "../../schema/checkpoint-amendment.schema.js";
import {
  AcceptanceCriteriaResultSchema,
  ValidationResultSchema,
  type AcceptanceCriteriaResult,
  type ValidationResult,
} from "../../schema/checkpoint.schema.js";
import type { StateModel } from "../../schema/state.schema.js";
import { runCheckpointAdvisory } from "../../workflow/checkpoint-advisory-integration.js";
import { persistCheckpointAdvisoryResult } from "../../workflow/checkpoint-advisory-persistence.js";
import { buildEvidenceAdvisorySummary, type EvidenceAdvisorySummary } from "../../workflow/checkpoint-advisory-visibility.js";
import type { ProjectModel } from "../../schema/project.schema.js";
import { evaluateCheckpointRequiredGate, recoveryCommandsFor, type CheckpointRequiredGateDecision } from "../../workflow/checkpoint-required-evidence-integration.js";
import { buildRequiredDecisionRecordedEvent, buildExceptionConsumedEvent, buildProjectIssueCreatedEvent } from "../../state/runlog-store.js";

/**
 * M29 §3.1/§3.2: "The same post-success ordering applies when a checkpoint
 * amendment attaches replacement evidence." Runs only after the amendment's
 * own state/runlog effects are already durable, using the amendment's own
 * `amendedAt` as asOf (the canonical amendment-recorded timestamp) and the
 * effective checkpoint result via the existing M12 owner. Any failure here
 * is folded into "unavailable"; it can never affect the amendment's own
 * exit code or already-persisted state.
 */
function evaluateAndPersistAmendmentAdvisory(params: {
  stateFile: string;
  runlogFile: string;
  postAmendmentState: StateModel;
  project: ProjectModel;
  checkpointId: string;
  workUnitId: string;
  milestoneId: string;
  timestamp: string;
}): EvidenceAdvisorySummary {
  try {
    const result = runCheckpointAdvisory({
      state: params.postAmendmentState,
      project: params.project,
      checkpointId: params.checkpointId,
      workUnitId: params.workUnitId,
      milestoneId: params.milestoneId,
      trigger: "amendment",
      asOf: params.timestamp,
      recordedAt: params.timestamp,
    });

    persistCheckpointAdvisoryResult({
      stateFile: params.stateFile,
      runlogFile: params.runlogFile,
      state: params.postAmendmentState,
      result,
      timestamp: params.timestamp,
      checkpointId: params.checkpointId,
      workUnitId: params.workUnitId,
    });

    return buildEvidenceAdvisorySummary(result.observation, params.checkpointId);
  } catch {
    return {
      status: "unavailable",
      result: null,
      issueCount: 0,
      blocking: false,
      refreshCommand: `aiqt evidence gate advisory refresh --checkpoint ${params.checkpointId}`,
    };
  }
}

export interface RunCheckpointAmendOptions {
  checkpointId?: string;
  acceptance?: string;
  validation?: string;
  reason?: string;
  resolvedNotCompleted?: string;
  resolutionEvidenceReference?: string;
  reconciledAcceptanceCriterion?: string;
  criterionResult?: string;
  criterionEvidenceReference?: string;
}

const SOURCE_COMMAND = "aiqt checkpoint amend";

/** Work unit statuses whose checkpoints may be amended at all (M12 §10). */
const AMENDABLE_STATUSES = new Set(["done", "needs_review"]);

function failInvalidInput(id: string, message: string): CommandResult {
  return makeResult({
    status: "failed",
    action: "checkpoint",
    summary: message,
    exitCode: ExitCode.InvalidInput,
    blockingIssues: [
      {
        id,
        severity: "high",
        area: "input",
        message,
        agentCanFix: false,
      },
    ],
  });
}

/**
 * aiqt checkpoint amend --checkpoint <id> [--acceptance ...] [--validation ...]
 * [--resolve-not-completed <original-item> [--resolution-evidence <reference>]]
 * [--reconcile-acceptance-criterion <original-criterion> --criterion-result <result> [--criterion-evidence <reference>]]
 * --reason "..." (M12 §8.1). Stores an amendment overlay without rewriting
 * the original checkpoint. The only amendment-triggered status transition is
 * needs_review -> done, gated by applyCheckpointAmendment's completion gate;
 * done work units are never reopened or demoted.
 */
export function runCheckpointAmend(
  ctx: CommandContext,
  options: RunCheckpointAmendOptions,
): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "checkpoint",
        summary: "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-NO-PROJECT",
            severity: "high",
            area: "workflow",
            message: ".aiqt/ not found in the current folder.",
            suggestedAction: "Run aiqt init.",
            agentCanFix: false,
          },
        ],
      });
    }

    const checkpointId = (options.checkpointId ?? "").trim();
    if (checkpointId === "") {
      return failInvalidInput(
        "CHECKPOINT-AMEND-MISSING-ID",
        'A checkpoint id is required: aiqt checkpoint amend --checkpoint <checkpoint-id> [--acceptance ...] [--validation ...] --reason "..."',
      );
    }

    if (options.acceptance === undefined && options.validation === undefined && options.resolvedNotCompleted === undefined && options.reconciledAcceptanceCriterion === undefined) {
      return failInvalidInput(
        "CHECKPOINT-AMEND-MISSING-FIELD",
        "At least one of --acceptance, --validation, --resolve-not-completed, or --reconcile-acceptance-criterion is required.",
      );
    }

    let acceptanceCriteriaResult: AcceptanceCriteriaResult | undefined;
    if (options.acceptance !== undefined) {
      const parsed = AcceptanceCriteriaResultSchema.safeParse(options.acceptance);
      if (!parsed.success) {
        return failInvalidInput(
          "CHECKPOINT-AMEND-INVALID-ACCEPTANCE",
          `--acceptance must be one of: ${AcceptanceCriteriaResultSchema.options.join(", ")}.`,
        );
      }
      acceptanceCriteriaResult = parsed.data;
    }

    let validationResult: ValidationResult | undefined;
    if (options.validation !== undefined) {
      const parsed = ValidationResultSchema.safeParse(options.validation);
      if (!parsed.success) {
        return failInvalidInput(
          "CHECKPOINT-AMEND-INVALID-VALIDATION",
          `--validation must be one of: ${ValidationResultSchema.options.join(", ")}.`,
        );
      }
      validationResult = parsed.data;
    }

    const reason = (options.reason ?? "").trim();
    if (reason === "") {
      return failInvalidInput(
        "CHECKPOINT-AMEND-MISSING-REASON",
        "--reason is required and must be non-empty.",
      );
    }

    const resolvedNotCompleted = options.resolvedNotCompleted?.trim();
    if (options.resolvedNotCompleted !== undefined && resolvedNotCompleted === "") {
      return failInvalidInput("CHECKPOINT-AMEND-INVALID-RESOLUTION", "--resolve-not-completed must be non-empty.");
    }
    const resolutionEvidenceReference = options.resolutionEvidenceReference?.trim();
    if (options.resolutionEvidenceReference !== undefined && resolutionEvidenceReference === "") {
      return failInvalidInput("CHECKPOINT-AMEND-INVALID-RESOLUTION-EVIDENCE", "--resolution-evidence must be non-empty when supplied.");
    }
    if (resolutionEvidenceReference !== undefined && resolvedNotCompleted === undefined) {
      return failInvalidInput("CHECKPOINT-AMEND-RESOLUTION-EVIDENCE-WITHOUT-RESOLUTION", "--resolution-evidence requires --resolve-not-completed.");
    }

    const reconciledCriterionText = options.reconciledAcceptanceCriterion;
    if (reconciledCriterionText !== undefined && reconciledCriterionText.trim() === "") {
      return failInvalidInput("CHECKPOINT-AMEND-INVALID-CRITERION", "--reconcile-acceptance-criterion must be non-empty.");
    }
    if (options.criterionResult !== undefined && reconciledCriterionText === undefined) {
      return failInvalidInput("CHECKPOINT-AMEND-CRITERION-RESULT-WITHOUT-CRITERION", "--criterion-result requires --reconcile-acceptance-criterion.");
    }
    if (options.criterionEvidenceReference !== undefined && reconciledCriterionText === undefined) {
      return failInvalidInput("CHECKPOINT-AMEND-CRITERION-EVIDENCE-WITHOUT-CRITERION", "--criterion-evidence requires --reconcile-acceptance-criterion.");
    }
    if (reconciledCriterionText !== undefined && options.criterionResult === undefined) {
      return failInvalidInput("CHECKPOINT-AMEND-MISSING-CRITERION-RESULT", "--reconcile-acceptance-criterion requires --criterion-result.");
    }
    if (options.criterionEvidenceReference !== undefined && options.criterionEvidenceReference.trim() === "") {
      return failInvalidInput("CHECKPOINT-AMEND-INVALID-CRITERION-EVIDENCE", "--criterion-evidence must be non-empty when supplied.");
    }
    let reconciledAcceptanceCriterion: ReconciledAcceptanceCriterion | undefined;
    if (reconciledCriterionText !== undefined) {
      const parsed = AcceptanceCriteriaResultSchema.safeParse(options.criterionResult);
      if (!parsed.success) {
        return failInvalidInput("CHECKPOINT-AMEND-INVALID-CRITERION-RESULT", `--criterion-result must be one of: ${AcceptanceCriteriaResultSchema.options.join(", ")}.`);
      }
      reconciledAcceptanceCriterion = {
        criterion: reconciledCriterionText,
        result: parsed.data,
        ...(options.criterionEvidenceReference !== undefined ? { evidenceReference: options.criterionEvidenceReference.trim() } : {}),
      };
    }

    const { paths, project, state } = loadProject(ctx);

    const checkpoint = state.checkpoints.find((cp) => cp.id === checkpointId);
    if (!checkpoint) {
      const message = `Checkpoint "${checkpointId}" does not exist.`;
      return makeResult({
        status: "failed",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-UNKNOWN-CHECKPOINT",
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (resolvedNotCompleted !== undefined && !checkpoint.notCompleted.includes(resolvedNotCompleted)) {
      return failInvalidInput(
        "CHECKPOINT-AMEND-UNKNOWN-NOT-COMPLETED",
        `Unfinished-work item ${JSON.stringify(resolvedNotCompleted)} is not recorded by checkpoint "${checkpointId}".`,
      );
    }
    if (reconciledAcceptanceCriterion !== undefined && !checkpoint.acceptanceCriteria.some((entry) => entry.criterion === reconciledAcceptanceCriterion!.criterion)) {
      return failInvalidInput(
        "CHECKPOINT-AMEND-UNKNOWN-ACCEPTANCE-CRITERION",
        `Acceptance criterion ${JSON.stringify(reconciledAcceptanceCriterion.criterion)} is not recorded by checkpoint "${checkpointId}".`,
      );
    }

    const workUnit = state.workGraph.workUnits.find((wu) => wu.id === checkpoint.workUnitId);
    if (!workUnit) {
      const message = `Checkpoint "${checkpointId}" references workUnitId "${checkpoint.workUnitId}", which does not exist.`;
      return makeResult({
        status: "failed",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-INVALID-STATE",
            severity: "critical",
            area: "state",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    if (!AMENDABLE_STATUSES.has(workUnit.status)) {
      const message = `Work unit "${workUnit.id}" has status "${workUnit.status}", which cannot be amended. Only done and needs_review work units may be amended.`;
      return makeResult({
        status: "blocked",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: message,
        exitCode: ExitCode.WorkflowBlocked,
        blockingIssues: [
          {
            id: "CHECKPOINT-AMEND-STATUS-NOT-AMENDABLE",
            severity: "medium",
            area: "workflow",
            message,
            agentCanFix: false,
          },
        ],
      });
    }

    const timestamp = new Date().toISOString();

    const amendmentIds = (state.checkpointAmendments ?? []).map((a) => a.amendmentId);
    const amendmentId = nextId("AMEND", amendmentIds, "-");

    const applied = applyCheckpointAmendment({
      state,
      checkpoint,
      workUnit,
      acceptanceCriteriaResult,
      validationResult,
      resolvedNotCompleted,
      resolutionEvidenceReference,
      reconciledAcceptanceCriterion,
      amendmentId,
      reason,
      timestamp,
    });

    if (!applied.changed) {
      const assessedState = applyWorkflowAssessmentToState(project, state);
      const nextRecommendedCommand = assessedState.nextRecommendedCommand ?? "aiqt review";
      return makeResult({
        status: "passed",
        action: "checkpoint",
        projectStatus: assessedState.projectStatus,
        currentMilestoneId: assessedState.currentMilestoneId,
        currentWorkUnitId: assessedState.currentWorkUnitId,
        summary: `Checkpoint "${checkpointId}" already has the requested effective result.`,
        nextRecommendedCommand,
        exitCode: ExitCode.Success,
        data: {
          amendmentId: null,
          checkpointId,
          workUnitId: workUnit.id,
          effectiveAcceptanceCriteriaResult: applied.effectiveAcceptanceCriteriaResult,
          effectiveValidationResult: applied.effectiveValidationResult,
          effectiveNotCompleted: computeEffectiveCheckpointResult(checkpoint, getCheckpointAmendments(state)).notCompleted,
          workUnitStatusBefore: applied.workUnitStatusBefore,
          workUnitStatusAfter: applied.workUnitStatusAfter,
          changed: false,
        },
      });
    }

    // M30 §7.3: required evidence only gates a needs_review -> done
    // transition that applyCheckpointAmendment's own completion gate
    // already decided to allow. Changing result fields alone can never
    // waive evidence -- there is no override here, only a possible
    // downgrade back to needs_review.
    let requiredGateDecision: CheckpointRequiredGateDecision | undefined;
    const completionGatePassed = applied.workUnitStatusBefore === "needs_review" && applied.workUnitStatusAfter === "done";
    if (completionGatePassed) {
      const gate = evaluateCheckpointRequiredGate({
        state,
        project,
        candidateCheckpoint: checkpoint,
        candidateWorkUnits: applied.workUnits,
        workUnit,
        timestamp,
      });

      if (gate.rejection) {
        const recoveryCommands = gate.decision ? recoveryCommandsFor(gate.decision.deficiency) : [];
        return makeResult({
          status: gate.rejection.exitCode === 2 ? "blocked" : "failed",
          action: "checkpoint",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: gate.rejection.summary,
          nextRecommendedCommand: recoveryCommands[0] ?? null,
          exitCode: gate.rejection.exitCode,
          blockingIssues: [{ id: gate.rejection.issueId, severity: "high", area: "evidence-gate", message: gate.rejection.summary, agentCanFix: false }],
        });
      }

      if (gate.evaluated && gate.decision) requiredGateDecision = gate.decision;

      if (gate.downgradeToNeedsReview) {
        // Discard the completion-gate-passed branch's mutations -- the
        // amendment overlay itself is still stored (below), just without
        // the done transition applyCheckpointAmendment would have applied.
        applied.workUnitStatusAfter = "needs_review";
        applied.workUnits = state.workGraph.workUnits;
        applied.milestones = state.workGraph.milestones;
        applied.projectStatus = state.projectStatus;
        applied.newlyReadyWorkUnitIds = [];
      }
    }

    let currentMilestoneId = state.currentMilestoneId;
    if (
      applied.workUnitStatusAfter === "done" &&
      applied.workUnitStatusBefore === "needs_review" &&
      state.currentWorkUnitId === null
    ) {
      const nextReady = selectNextReadyWorkUnit({
        ...state,
        workGraph: { ...state.workGraph, workUnits: applied.workUnits },
      });
      currentMilestoneId = nextReady.milestone?.id ?? null;
    }

    const stateWithAmendment: StateModel = {
      ...state,
      projectStatus: applied.projectStatus,
      currentMilestoneId,
      workGraph: {
        ...state.workGraph,
        workUnits: applied.workUnits,
        milestones: applied.milestones,
      },
      checkpointAmendments: [...(state.checkpointAmendments ?? []), applied.amendment!],
      lastUpdatedAt: timestamp,
      ...(requiredGateDecision && requiredGateDecision.consumedExceptionIds.length > 0
        ? {
            requiredEvidenceExceptions: (state.requiredEvidenceExceptions ?? []).map((exc) =>
              requiredGateDecision!.consumedExceptionIds.includes(exc.exceptionId)
                ? { ...exc, status: (exc.usage.mode === "single_use" ? "consumed" : exc.status) as typeof exc.status, usage: { ...exc.usage, consumedAt: timestamp, consumedByDecisionId: requiredGateDecision!.decisionId } }
                : exc,
            ),
          }
        : {}),
      ...(requiredGateDecision && requiredGateDecision.createdProjectIssues.length > 0
        ? {
            issues: {
              overrides: state.issues?.overrides ?? [],
              promotions: state.issues?.promotions ?? [],
              projectIssues: [...(state.issues?.projectIssues ?? []), ...requiredGateDecision.createdProjectIssues],
              ...(state.issues?.projectIssueTransitions ? { projectIssueTransitions: state.issues.projectIssueTransitions } : {}),
            },
          }
        : {}),
    };

    const finalState: StateModel = applyWorkflowAssessmentToState(project, stateWithAmendment);
    const nextRecommendedCommand = finalState.nextRecommendedCommand ?? "aiqt review";
    writeStateModel(paths.stateFile, finalState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const eventId = nextId("EVT", eventIds);
    appendRunlogEvent(
      paths.runlogFile,
      buildCheckpointAmendedEvent({
        id: eventId,
        timestamp,
        relatedIds: [checkpointId, workUnit.id],
        data: {
          amendmentId,
          checkpointId,
          workUnitId: workUnit.id,
          ...(acceptanceCriteriaResult !== undefined ? { acceptanceCriteriaResult } : {}),
          ...(validationResult !== undefined ? { validationResult } : {}),
          ...(resolvedNotCompleted !== undefined ? { resolvedNotCompleted } : {}),
          ...(resolutionEvidenceReference !== undefined ? { resolutionEvidenceReference } : {}),
          ...(reconciledAcceptanceCriterion !== undefined ? { reconciledAcceptanceCriterion } : {}),
          reason,
          sourceCommand: SOURCE_COMMAND,
        },
      }),
    );

    if (requiredGateDecision) {
      const decisionEventId = nextId("EVT", [...readRunlogEventIds(paths.runlogFile)]);
      appendRunlogEvent(
        paths.runlogFile,
        buildRequiredDecisionRecordedEvent({
          id: decisionEventId,
          timestamp,
          relatedIds: [checkpointId, workUnit.id, requiredGateDecision.activationId],
          data: {
            decisionId: requiredGateDecision.decisionId,
            activationId: requiredGateDecision.activationId,
            gate: "checkpoint",
            outcome: requiredGateDecision.outcome,
            deficiency: requiredGateDecision.deficiency,
            targetRefs: [`checkpoint:${checkpointId}`],
          },
        }),
      );

      for (const exceptionId of requiredGateDecision.consumedExceptionIds) {
        const consumedEventId = nextId("EVT", [...readRunlogEventIds(paths.runlogFile)]);
        appendRunlogEvent(
          paths.runlogFile,
          buildExceptionConsumedEvent({
            id: consumedEventId,
            timestamp,
            relatedIds: [exceptionId, checkpointId],
            data: { exceptionId, decisionId: requiredGateDecision.decisionId },
          }),
        );
      }

      for (const createdIssue of requiredGateDecision.createdProjectIssues) {
        const issueEventId = nextId("EVT", [...readRunlogEventIds(paths.runlogFile)]);
        appendRunlogEvent(
          paths.runlogFile,
          buildProjectIssueCreatedEvent({
            id: issueEventId,
            timestamp,
            relatedIds: [createdIssue.projectIssueId, checkpointId],
            data: { projectIssueId: createdIssue.projectIssueId, issueKey: createdIssue.issueKey, severity: createdIssue.severity, sourceType: createdIssue.sourceType },
          }),
        );
      }
    }

    // M29 §3.1/§3.2: post-success advisory refresh, strictly after the
    // amendment's own state write and runlog event above.
    const evidenceAdvisory = evaluateAndPersistAmendmentAdvisory({
      stateFile: paths.stateFile,
      runlogFile: paths.runlogFile,
      postAmendmentState: finalState,
      project,
      checkpointId,
      workUnitId: workUnit.id,
      milestoneId: workUnit.milestoneId,
      timestamp,
    });

    return makeResult({
      status: "passed",
      action: "checkpoint",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Checkpoint amendment stored for ${checkpointId}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Stored checkpoint amendment",
        "Appended runlog event",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [checkpointId, workUnit.id],
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        amendmentId,
        checkpointId,
        workUnitId: workUnit.id,
        effectiveAcceptanceCriteriaResult: applied.effectiveAcceptanceCriteriaResult,
        effectiveValidationResult: applied.effectiveValidationResult,
        effectiveNotCompleted: computeEffectiveCheckpointResult(checkpoint, [...getCheckpointAmendments(state), applied.amendment!]).notCompleted,
        workUnitStatusBefore: applied.workUnitStatusBefore,
        workUnitStatusAfter: applied.workUnitStatusAfter,
        changed: true,
        evidenceAdvisory,
        ...(requiredGateDecision
          ? {
              requiredEvidence: {
                outcome: requiredGateDecision.outcome,
                deficiency: requiredGateDecision.deficiency,
                exceptionRefs: requiredGateDecision.consumedExceptionIds,
                blockingRuleRefs: requiredGateDecision.blockingRuleRefs,
                issueKeys: requiredGateDecision.issueKeys,
                recovery: { commands: recoveryCommandsFor(requiredGateDecision.deficiency) },
              },
            }
          : {}),
      },
    });
  } catch (err) {
    return errorToResult("checkpoint", err);
  }
}
