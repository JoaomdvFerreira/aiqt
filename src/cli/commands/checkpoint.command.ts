import type { CommandContext } from "../command-context.js";
import {
  makeResult,
  errorToResult,
  type CommandResult,
} from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { AiqtError } from "../../core/output/aiqt-error.js";
import type { Issue } from "../../core/output/issue.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import {
  readJsonFile,
  FileReadError,
  JsonParseError,
} from "../../core/filesystem/file-store.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildCheckpointCreatedEvent,
  buildWorkUnitStatusChangedEvent,
  readRunlogEventIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import {
  CheckpointInputSchema,
  type CheckpointInput,
} from "../../schema/checkpoint-input.schema.js";
import { applyCheckpoint } from "../../services/checkpoint-service.js";
import { isPlanningContextReady } from "../../workflow/planning-readiness.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { WorkUnit } from "../../schema/work-unit.schema.js";
import { getExecutionSessions, findSessionsForPacket } from "../../services/execution-session-service.js";
import { isTerminalSessionStatus } from "../../schema/execution-session.schema.js";
import { runCheckpointAdvisory } from "../../workflow/checkpoint-advisory-integration.js";
import { persistCheckpointAdvisoryResult } from "../../workflow/checkpoint-advisory-persistence.js";
import { buildEvidenceAdvisorySummary, type EvidenceAdvisorySummary } from "../../workflow/checkpoint-advisory-visibility.js";
import { evaluateCheckpointRequiredGate, recoveryCommandsFor, type CheckpointRequiredGateDecision } from "../../workflow/checkpoint-required-evidence-integration.js";
import { buildRequiredDecisionRecordedEvent, buildExceptionConsumedEvent, buildProjectIssueCreatedEvent } from "../../state/runlog-store.js";

/**
 * M29 §3.1: automatic post-success advisory evaluation. Runs strictly after
 * the checkpoint's own state/runlog effects are already durable (called
 * only after those writes below). Any failure here -- evaluation, the
 * second state write, or the runlog append -- is caught and folded into an
 * "unavailable" advisory summary; it can never change the checkpoint's own
 * exit code, status, or already-persisted state (M29 §3.1/§7.2). A runlog
 * gap after a successful state write is likewise never surfaced as a
 * checkpoint-level failure -- it is left detectable via telemetry/export
 * and repairable via idempotent refresh.
 */
function evaluateAndPersistCheckpointAdvisory(params: {
  stateFile: string;
  runlogFile: string;
  postCheckpointState: StateModel;
  project: Parameters<typeof runCheckpointAdvisory>[0]["project"];
  checkpointId: string;
  workUnitId: string;
  milestoneId: string;
  timestamp: string;
}): EvidenceAdvisorySummary {
  try {
    const result = runCheckpointAdvisory({
      state: params.postCheckpointState,
      project: params.project,
      checkpointId: params.checkpointId,
      workUnitId: params.workUnitId,
      milestoneId: params.milestoneId,
      trigger: "checkpoint",
      asOf: params.timestamp,
      recordedAt: params.timestamp,
    });

    persistCheckpointAdvisoryResult({
      stateFile: params.stateFile,
      runlogFile: params.runlogFile,
      state: params.postCheckpointState,
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

function blockedOnState(
  state: StateModel,
  summary: string,
  nextRecommendedCommand: string,
  issueId: string,
): CommandResult {
  return makeResult({
    status: "blocked",
    action: "checkpoint",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary,
    nextRecommendedCommand,
    exitCode: ExitCode.WorkflowBlocked,
    blockingIssues: [
      {
        id: issueId,
        severity: "high",
        area: "workflow",
        message: summary,
        agentCanFix: false,
      },
    ],
  });
}

function failedOnState(
  state: StateModel,
  summary: string,
  nextRecommendedCommand: string | null,
  exitCode: number,
  issueOrId: Issue | string,
): CommandResult {
  const issue: Issue =
    typeof issueOrId === "string"
      ? {
          id: issueOrId,
          severity: "high",
          area: "workflow",
          message: summary,
          agentCanFix: false,
        }
      : issueOrId;
  return makeResult({
    status: "failed",
    action: "checkpoint",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary,
    nextRecommendedCommand,
    exitCode,
    blockingIssues: [issue],
  });
}

function validateCheckpointInput(raw: unknown): CheckpointInput {
  const parsed = CheckpointInputSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid checkpoint input: ${parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ")}`;
    throw new AiqtError(message, ExitCode.InvalidInput, {
      id: "CHECKPOINT-INPUT-SCHEMA-INVALID",
      severity: "critical",
      area: "input",
      message,
      agentCanFix: false,
    });
  }
  return parsed.data;
}

function loadCheckpointInputFromFile(path: string): CheckpointInput {
  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      throw new AiqtError(err.message, ExitCode.InvalidInput, {
        id: "CHECKPOINT-FROM-FILE-INVALID",
        severity: "critical",
        area: "input",
        message: err.message,
        agentCanFix: false,
      });
    }
    throw err;
  }
  return validateCheckpointInput(raw);
}

export interface RunCheckpointOptions {
  fromFile?: string;
  /** Pre-parsed checkpoint JSON (e.g. from aiqt import checkpoint --stdin). Takes precedence over fromFile when set. */
  input?: unknown;
}

export function runCheckpoint(
  ctx: CommandContext,
  options: RunCheckpointOptions,
): CommandResult {
  try {
    // .aiqt/ missing has a specific next-command hint ("aiqt init") per the
    // M5 error table; the generic AiqtError -> errorToResult path used for
    // other failures below always leaves nextRecommendedCommand null.
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "checkpoint",
        summary:
          "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "CHECKPOINT-NO-PROJECT",
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

    const hasWorkGraph = state.workGraph.milestones.length > 0;
    if (!hasWorkGraph) {
      const ready = isPlanningContextReady(project);
      return blockedOnState(
        state,
        ready
          ? "Project context is ready, but no work graph exists yet. Run aiqt plan to generate the work graph."
          : "Project context is not ready for planning. Run aiqt update to capture more context.",
        ready ? "aiqt plan" : "aiqt update",
        "CHECKPOINT-NO-WORK-GRAPH",
      );
    }

    if (state.currentWorkUnitId === null) {
      return blockedOnState(
        state,
        "No work unit is currently in progress. Run aiqt next to select one.",
        "aiqt next",
        "CHECKPOINT-NO-CURRENT-WORK-UNIT",
      );
    }

    const workUnit: WorkUnit | undefined = state.workGraph.workUnits.find(
      (wu) => wu.id === state.currentWorkUnitId,
    );
    if (!workUnit) {
      return failedOnState(
        state,
        `currentWorkUnitId "${state.currentWorkUnitId}" does not reference an existing work unit.`,
        "aiqt next",
        ExitCode.InvalidInput,
        "CHECKPOINT-UNKNOWN-WORK-UNIT",
      );
    }

    if (workUnit.status !== "in_progress") {
      return failedOnState(
        state,
        `Current work unit "${workUnit.id}" does not have status in_progress (found "${workUnit.status}").`,
        "aiqt next",
        ExitCode.InvalidInput,
        "CHECKPOINT-WORK-UNIT-NOT-IN-PROGRESS",
      );
    }

    if (!state.lastAgentPacket || state.lastAgentPacket.workUnitId !== workUnit.id) {
      return failedOnState(
        state,
        "No agent packet metadata references the current work unit. Run aiqt next to regenerate a packet.",
        "aiqt next",
        ExitCode.InvalidInput,
        "CHECKPOINT-PACKET-MISMATCH",
      );
    }

    // M26 §5.1: a non-terminal execution session, an open decision, or a
    // running iteration for the current packet all block checkpoint.
    // Checkpoint may proceed once every session for the packet is
    // terminal with no open decision (a running iteration is impossible
    // on a terminal session, so checking terminality + open decisions
    // covers both).
    const packetSessions = findSessionsForPacket(state.lastAgentPacket.id, getExecutionSessions(state));
    const blockingSession = packetSessions.find(
      (s) => !isTerminalSessionStatus(s.status) || s.decisions.some((d) => d.status === "open"),
    );
    if (blockingSession) {
      return blockedOnState(
        state,
        `Execution session ${blockingSession.id} for the current packet is not eligible for checkpoint (status "${blockingSession.status}", ${blockingSession.decisions.filter((d) => d.status === "open").length} open decision(s)).`,
        "aiqt execution status",
        "CHECKPOINT-EXECUTION-SESSION-BLOCKING",
      );
    }

    if (!options.fromFile && options.input === undefined) {
      return makeResult({
        status: "needs_input",
        action: "checkpoint",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary:
          "No checkpoint input file supplied. Provide a structured checkpoint result via --from-file.",
        requiresHumanInput: true,
        nextRecommendedCommand: "aiqt checkpoint --from-file <path>",
        exitCode: ExitCode.HumanInputRequired,
      });
    }

    const retryHint = options.input !== undefined
      ? "aiqt prompt checkpoint"
      : `aiqt checkpoint --from-file ${options.fromFile}`;

    let result;
    let requiredGateDecision: CheckpointRequiredGateDecision | undefined;
    try {
      const input = options.input !== undefined
        ? validateCheckpointInput(options.input)
        : loadCheckpointInputFromFile(options.fromFile!);
      const timestamp = new Date().toISOString();
      const checkpointId = nextId("C", state.checkpoints.map((c) => c.id), "");

      let applied = applyCheckpoint({
        state,
        workUnit,
        input,
        checkpointId,
        timestamp,
        executionSessionIds: packetSessions.map((s) => s.id),
      });

      // M30 §7.2: required evidence only ever gates a transition that
      // would otherwise become "done" -- existing acceptance/validation
      // failure (needs_review) always takes precedence and is never
      // touched here.
      if (applied.checkpoint.finalWorkUnitStatus === "done") {
        const gate = evaluateCheckpointRequiredGate({
          state,
          project,
          candidateCheckpoint: applied.checkpoint,
          candidateWorkUnits: applied.workUnits,
          workUnit,
          timestamp,
        });

        if (gate.rejection) {
          // M30 §7.2/§7.4: blocked/invalid attempts perform zero canonical
          // mutation -- return immediately, before any state is built.
          const recoveryCommands = gate.decision ? recoveryCommandsFor(gate.decision.deficiency) : [];
          if (gate.rejection.exitCode === 2) {
            return blockedOnState(state, gate.rejection.summary, recoveryCommands[0] ?? "aiqt evidence import --from-file <path>", gate.rejection.issueId);
          }
          return failedOnState(state, gate.rejection.summary, recoveryCommands[0] ?? null, gate.rejection.exitCode, gate.rejection.issueId);
        }

        if (gate.evaluated && gate.decision) {
          requiredGateDecision = gate.decision;
        }

        if (gate.downgradeToNeedsReview) {
          // M30 §7.2/transition matrix: required evidence may downgrade a
          // would-be done to needs_review, never upgrade failure to
          // success. Re-derive via the SAME existing pure applyCheckpoint,
          // forcing targetStatus so its own needs_review branch (never
          // recalculating readiness) is used -- no second readiness or
          // completion engine.
          applied = applyCheckpoint({
            state,
            workUnit,
            input: { ...input, targetStatus: "needs_review" },
            checkpointId,
            timestamp,
            executionSessionIds: packetSessions.map((s) => s.id),
          });
        }
      }

      result = { applied, timestamp };
    } catch (err) {
      if (err instanceof AiqtError) {
        return failedOnState(
          state,
          err.message,
          retryHint,
          err.exitCode,
          err.issue ?? "CHECKPOINT-FAILED",
        );
      }
      throw err;
    }

    const { applied, timestamp } = result;

    const newState: StateModel = {
      ...state,
      projectStatus: applied.projectStatus,
      currentMilestoneId: applied.currentMilestoneId,
      currentWorkUnitId: null,
      workGraph: {
        ...state.workGraph,
        workUnits: applied.workUnits,
        milestones: applied.milestones,
      },
      checkpoints: [...state.checkpoints, applied.checkpoint],
      nextRecommendedCommand: applied.nextRecommendedCommand,
      lastUpdatedAt: timestamp,
      // M30 §7.4: exception consumption is persisted in the SAME state
      // write as the checkpoint/decision it was consumed by.
      ...(requiredGateDecision && requiredGateDecision.consumedExceptionIds.length > 0
        ? {
            requiredEvidenceExceptions: (state.requiredEvidenceExceptions ?? []).map((exc) =>
              requiredGateDecision!.consumedExceptionIds.includes(exc.exceptionId)
                ? { ...exc, status: (exc.usage.mode === "single_use" ? "consumed" : exc.status) as typeof exc.status, usage: { ...exc.usage, consumedAt: timestamp, consumedByDecisionId: requiredGateDecision!.decisionId } }
                : exc,
            ),
          }
        : {}),
      // M30 §10.1: required deficiencies reuse the M22 ProjectIssue
      // lifecycle (accepted M29 architecture correction) -- same state
      // write as the checkpoint/decision that produced them.
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

    writeStateModel(paths.stateFile, newState);

    let eventIds = readRunlogEventIds(paths.runlogFile);
    const checkpointEventId = nextId("EVT", eventIds);
    eventIds = [...eventIds, checkpointEventId];

    const changedFiles = [paths.stateFile, paths.runlogFile];
    const relatedIds = [
      project.project.id,
      workUnit.milestoneId,
      workUnit.id,
      applied.checkpoint.id,
      ...(applied.checkpoint.packetId ? [applied.checkpoint.packetId] : []),
    ];

    appendRunlogEvent(
      paths.runlogFile,
      buildCheckpointCreatedEvent({
        id: checkpointEventId,
        timestamp,
        relatedIds,
        data: {
          checkpointId: applied.checkpoint.id,
          workUnitId: workUnit.id,
          packetId: applied.checkpoint.packetId,
          validationResult: applied.checkpoint.validationResult,
          acceptanceCriteriaResult: applied.checkpoint.acceptanceCriteriaResult,
          targetStatus: applied.checkpoint.finalWorkUnitStatus,
          nextRecommendedCommand: applied.nextRecommendedCommand,
        },
      }),
    );

    const selectedEventId = nextId("EVT", eventIds);
    eventIds = [...eventIds, selectedEventId];
    appendRunlogEvent(
      paths.runlogFile,
      buildWorkUnitStatusChangedEvent({
        id: selectedEventId,
        timestamp,
        relatedIds: [
          project.project.id,
          workUnit.milestoneId,
          workUnit.id,
          applied.checkpoint.id,
        ],
        data: {
          workUnitId: workUnit.id,
          fromStatus: "in_progress",
          toStatus: applied.checkpoint.finalWorkUnitStatus,
          reason: "Checkpoint captured.",
        },
      }),
    );

    for (const readyId of applied.newlyReadyWorkUnitIds) {
      const readyWorkUnit = applied.workUnits.find((wu) => wu.id === readyId)!;
      const eventId = nextId("EVT", eventIds);
      eventIds = [...eventIds, eventId];
      appendRunlogEvent(
        paths.runlogFile,
        buildWorkUnitStatusChangedEvent({
          id: eventId,
          timestamp,
          relatedIds: [
            project.project.id,
            readyWorkUnit.milestoneId,
            readyWorkUnit.id,
            applied.checkpoint.id,
          ],
          data: {
            workUnitId: readyId,
            fromStatus: "planned",
            toStatus: "ready",
            reason: "Unblocked by dependency completion.",
          },
        }),
      );
    }

    // M30 §7.4: appended in the same ordered sequence as the checkpoint's
    // own events, right after readiness events -- never a second write.
    if (requiredGateDecision) {
      const decisionEventId = nextId("EVT", eventIds);
      eventIds = [...eventIds, decisionEventId];
      appendRunlogEvent(
        paths.runlogFile,
        buildRequiredDecisionRecordedEvent({
          id: decisionEventId,
          timestamp,
          relatedIds: [applied.checkpoint.id, workUnit.id, requiredGateDecision.activationId],
          data: {
            decisionId: requiredGateDecision.decisionId,
            activationId: requiredGateDecision.activationId,
            gate: "checkpoint",
            outcome: requiredGateDecision.outcome,
            deficiency: requiredGateDecision.deficiency,
            targetRefs: [`checkpoint:${applied.checkpoint.id}`],
          },
        }),
      );

      for (const exceptionId of requiredGateDecision.consumedExceptionIds) {
        const consumedEventId = nextId("EVT", eventIds);
        eventIds = [...eventIds, consumedEventId];
        appendRunlogEvent(
          paths.runlogFile,
          buildExceptionConsumedEvent({
            id: consumedEventId,
            timestamp,
            relatedIds: [exceptionId, applied.checkpoint.id],
            data: { exceptionId, decisionId: requiredGateDecision.decisionId },
          }),
        );
      }

      for (const createdIssue of requiredGateDecision.createdProjectIssues) {
        const issueEventId = nextId("EVT", eventIds);
        eventIds = [...eventIds, issueEventId];
        appendRunlogEvent(
          paths.runlogFile,
          buildProjectIssueCreatedEvent({
            id: issueEventId,
            timestamp,
            relatedIds: [createdIssue.projectIssueId, applied.checkpoint.id],
            data: { projectIssueId: createdIssue.projectIssueId, issueKey: createdIssue.issueKey, severity: createdIssue.severity, sourceType: createdIssue.sourceType },
          }),
        );
      }
    }

    // M29 §3.1: advisory evaluation is attempted only after every step above
    // (the checkpoint's own state write and all its runlog events) has
    // already succeeded. `newState` is the durable post-checkpoint state.
    const evidenceAdvisory = evaluateAndPersistCheckpointAdvisory({
      stateFile: paths.stateFile,
      runlogFile: paths.runlogFile,
      postCheckpointState: newState,
      project,
      checkpointId: applied.checkpoint.id,
      workUnitId: workUnit.id,
      milestoneId: workUnit.milestoneId,
      timestamp,
    });

    return makeResult({
      status: "passed",
      action: "checkpoint",
      projectStatus: applied.projectStatus,
      currentMilestoneId: applied.currentMilestoneId,
      currentWorkUnitId: null,
      summary: `Checkpoint captured for ${workUnit.id}.`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Created checkpoint",
        "Updated workflow state",
        "Appended runlog events",
      ],
      changedFiles,
      affectedItems: [
        project.project.id,
        workUnit.milestoneId,
        workUnit.id,
        applied.checkpoint.id,
      ],
      nextRecommendedCommand: applied.nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        checkpointId: applied.checkpoint.id,
        workUnitId: workUnit.id,
        packetId: applied.checkpoint.packetId,
        fromStatus: "in_progress",
        toStatus: applied.checkpoint.finalWorkUnitStatus,
        validationResult: applied.checkpoint.validationResult,
        acceptanceCriteriaResult: applied.checkpoint.acceptanceCriteriaResult,
        newlyReadyWorkUnitIds: applied.newlyReadyWorkUnitIds,
        nextReadyWorkUnitId: applied.nextReadyWorkUnitId,
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
