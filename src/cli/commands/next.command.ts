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
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildAgentPacketCreatedEvent,
  buildWorkUnitStatusChangedEvent,
  readRunlogEventIds,
  readAgentPacketIds,
} from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { sha256Hex } from "../../core/util/hash.js";
import { isPlanningContextReady } from "../../workflow/planning-readiness.js";
import { resolveNextSelection } from "../../workflow/next-work-unit-selector.js";
import { runAgentHandoffGate } from "../../workflow/agent-handoff-gate.js";
import {
  parseSelectionRequest,
  buildActiveWorkUnitGuardResult,
  buildSelectionBlockedResult,
  buildCandidateReportingData,
  buildAlternativeCandidateGuidance,
  type RawSelectionOptions,
} from "./next-selection-helpers.js";
import { applyWorkUnitStartTransition } from "../../workflow/status-transitions.js";
import {
  resolveAgentContextRefs,
  buildUnresolvedRefWarnings,
  buildPacketContext,
  selectRelevantSkills,
  computePacketAuditMetadata,
} from "../../services/agent-packet-service.js";
import { renderAgentPacket } from "../../services/agent-packet-template.js";
import { buildSkillsPlan } from "../../services/skills-detection-service.js";
import { detectUiHeavyForProject } from "../../workflow/design/ui-heavy-detection.js";
import { detectComponentSystemPreference } from "../../workflow/component-system-preferences.js";
import type { StateModel } from "../../schema/state.schema.js";
import { applyWorkflowAssessmentToState } from "../../services/workflow-assessment-persistence.js";
import type { AgentPacketMetadata } from "../../schema/agent-packet.schema.js";

function blockedOnState(
  state: StateModel,
  summary: string,
  nextRecommendedCommand: string,
  issueId: string,
): CommandResult {
  return makeResult({
    status: "blocked",
    action: "next",
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

export type RunNextOptions = RawSelectionOptions;

export function runNext(ctx: CommandContext, options: RunNextOptions = {}): CommandResult {
  try {
    const parsed = parseSelectionRequest(options, "NEXT");
    if (!parsed.ok) return parsed.result;

    // .aiqt/ missing has a specific next-command hint ("aiqt init") per the
    // M4 error table; the generic AiqtError -> errorToResult path used for
    // other failures below always leaves nextRecommendedCommand null.
    if (!aiqtDirExists(ctx)) {
      return makeResult({
        status: "failed",
        action: "next",
        summary:
          "No AIQT project found. Run aiqt init to create the canonical state files.",
        nextRecommendedCommand: "aiqt init",
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: "NEXT-NO-PROJECT",
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
        "NEXT-NO-WORK-GRAPH",
      );
    }

    // M20 §7: the active-work-unit guard takes precedence over every
    // selection mode.
    if (state.currentWorkUnitId !== null) {
      return buildActiveWorkUnitGuardResult(state, "NEXT");
    }

    const selection = resolveNextSelection(state, parsed.request);
    if (!selection.selectedWorkUnit) {
      // Preserve the exact pre-M20 issue id/message for default mode's
      // "nothing is ready" case; work_unit/milestone modes are new, so use
      // the richer M20 blocked-result builder for those instead.
      if (selection.mode === "default") {
        return blockedOnState(
          state,
          "No ready work unit exists. Run aiqt review.",
          "aiqt review",
          "NEXT-NO-READY-WORK-UNIT",
        );
      }
      if (selection.blockingReason) {
        return buildSelectionBlockedResult(state, selection.blockingReason, "NEXT");
      }
      return blockedOnState(
        state,
        "No ready work unit exists. Run aiqt review.",
        "aiqt review",
        "NEXT-NO-READY-WORK-UNIT",
      );
    }
    const workUnit = selection.selectedWorkUnit;
    const milestone = selection.selectedMilestone;

    try {
      runAgentHandoffGate(workUnit, milestone, state);
    } catch (err) {
      if (err instanceof AiqtError) {
        return makeResult({
          status: "failed",
          action: "next",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: err.message,
          nextRecommendedCommand: "aiqt review",
          exitCode: err.exitCode,
          blockingIssues: err.issue ? [err.issue] : [],
        });
      }
      throw err;
    }

    // The gate guarantees milestone is non-null and matches workUnit.milestoneId.
    const selectedMilestone = milestone!;

    const resolved = resolveAgentContextRefs(workUnit.agentContextRefs, project);
    const warnings: Issue[] = buildUnresolvedRefWarnings(resolved.unresolvedRefs);

    // M10 §12: concise, advisory integration skill hints when this work
    // unit's own text touches a detected integration. Read-only repository
    // scan; never blocks or mutates packet generation on its own.
    const skillsPlan = buildSkillsPlan(paths.root, project);
    const relevantSkills = selectRelevantSkills(workUnit, skillsPlan.detectedIntegrations);

    // M13 §12: project-level UI-heavy confidence, computed once per aiqt
    // next call via the single shared detector.
    const uiHeavyResult = detectUiHeavyForProject({ project, repoRoot: paths.root });

    // M14 §9: component-system preference (shadcn/ui enforcement), reusing
    // the same shared detector rather than a second one.
    const componentSystemPreference = detectComponentSystemPreference({
      project,
      repoRoot: paths.root,
    });

    const packetContext = buildPacketContext(
      project,
      state,
      workUnit,
      selectedMilestone,
      resolved,
      relevantSkills,
      uiHeavyResult.confidence,
      paths.root,
      componentSystemPreference.preference,
    );
    const packetBody = renderAgentPacket(packetContext);
    const contentHash = sha256Hex(packetBody);

    // M14 §11.1: derive audit metadata from the exact same PacketContext
    // fields used to render the packet, so the record can never drift from
    // what was actually rendered.
    const auditMetadata = computePacketAuditMetadata(packetContext);

    const timestamp = new Date().toISOString();
    const existingPacketIds = readAgentPacketIds(paths.runlogFile, state.lastAgentPacket);
    const packetId = nextId("PKT", existingPacketIds, "-");

    const packetMetadata: AgentPacketMetadata = {
      id: packetId,
      workUnitId: workUnit.id,
      milestoneId: selectedMilestone.id,
      createdAt: timestamp,
      format: "markdown",
      contentHash,
      sourceCommand: "aiqt next",
      // M14 §11.2: optional latest-packet mirror only. The authoritative
      // historical record is the agent_packet.created runlog event below.
      renderedSections: auditMetadata.renderedSections,
      guidanceFlags: auditMetadata.guidanceFlags,
    };

    const transition = applyWorkUnitStartTransition(
      state,
      workUnit.id,
      selectedMilestone.id,
      timestamp,
    );

    const candidateState: StateModel = {
      ...state,
      currentMilestoneId: selectedMilestone.id,
      currentWorkUnitId: workUnit.id,
      workGraph: {
        ...state.workGraph,
        workUnits: transition.workUnits,
        milestones: transition.milestones,
      },
      lastAgentPacket: packetMetadata,
      lastUpdatedAt: timestamp,
    };
    const newState = applyWorkflowAssessmentToState(project, candidateState);
    const nextRecommendedCommand = newState.nextRecommendedCommand ?? "aiqt review";

    writeStateModel(paths.stateFile, newState);

    const eventIds = readRunlogEventIds(paths.runlogFile);
    const packetEventId = nextId("EVT", eventIds);
    const relatedIds = [
      project.project.id,
      selectedMilestone.id,
      workUnit.id,
      packetId,
    ];
    appendRunlogEvent(
      paths.runlogFile,
      buildAgentPacketCreatedEvent({
        id: packetEventId,
        timestamp,
        relatedIds,
        data: {
          packetId,
          workUnitId: workUnit.id,
          milestoneId: selectedMilestone.id,
          format: "markdown",
          contentHash,
          nextRecommendedCommand,
          renderedSections: auditMetadata.renderedSections,
          guidanceFlags: auditMetadata.guidanceFlags,
        },
      }),
    );

    const statusEventId = nextId("EVT", [...eventIds, packetEventId]);
    appendRunlogEvent(
      paths.runlogFile,
      buildWorkUnitStatusChangedEvent({
        id: statusEventId,
        timestamp,
        relatedIds: [project.project.id, selectedMilestone.id, workUnit.id],
        data: {
          workUnitId: workUnit.id,
          fromStatus: "ready",
          toStatus: "in_progress",
          reason: "Selected by aiqt next.",
        },
      }),
    );

    const alternativeGuidance = buildAlternativeCandidateGuidance(selection);

    return makeResult({
      status: warnings.length > 0 ? "warning" : "passed",
      action: "next",
      projectStatus: newState.projectStatus,
      currentMilestoneId: selectedMilestone.id,
      currentWorkUnitId: workUnit.id,
      summary: `Agent packet created for ${workUnit.id}.${alternativeGuidance ? ` ${alternativeGuidance}` : ""}`,
      completedActions: [
        "Read project.json",
        "Read state.json",
        "Selected ready work unit",
        "Generated agent packet",
        "Updated workflow state",
        "Appended runlog events",
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [project.project.id, selectedMilestone.id, workUnit.id, packetId],
      warnings,
      nextRecommendedCommand,
      exitCode: ExitCode.Success,
      data: {
        packetId,
        workUnitId: workUnit.id,
        milestoneId: selectedMilestone.id,
        packetFormat: "markdown" as const,
        contentHash,
        packet: packetBody,
        ...buildCandidateReportingData(selection),
        statusChanges: [
          { entityType: "workUnit", id: workUnit.id, from: "ready", to: "in_progress" },
          {
            entityType: "milestone",
            id: selectedMilestone.id,
            from: selectedMilestone.status,
            to: "in_progress",
          },
        ],
      },
    });
  } catch (err) {
    return errorToResult("next", err);
  }
}
