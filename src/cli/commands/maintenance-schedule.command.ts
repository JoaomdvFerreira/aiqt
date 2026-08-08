import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import {
  appendRunlogEvent,
  buildMaintenanceScheduleCreatedEvent,
  buildMaintenanceScheduleUpdatedEvent,
  buildMaintenanceScheduleEnabledEvent,
  buildMaintenanceScheduleDisabledEvent,
  buildMaintenanceScheduleRemovedEvent,
} from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { maintenanceFailure } from "./maintenance-shared.js";
import { parseCadenceInput } from "../../workflow/maintenance-cadence.js";
import { addSchedule, updateSchedule, enableSchedule, disableSchedule, removeSchedule } from "../../services/maintenance-schedule-service.js";
import { MaintenanceTaskKindSchema, MaintenanceSchedulePolicySchema } from "../../schema/maintenance-schedule.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

/**
 * `aiqt maintenance schedule add|list|inspect|update|enable|disable|remove`
 * (M45-WU02, build spec Sec 10): mutation commands touch only scheduling
 * state and append matching runlog evidence -- none of them executes a
 * maintenance task as a side effect (that is `run-due`, WU45-03).
 */

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

export interface RunMaintenanceScheduleAddOptions {
  taskKind: string;
  cadence: string;
  anchorAt?: string;
  maxAutomaticRisk?: number;
  disabled?: boolean;
}

export function runMaintenanceScheduleAdd(ctx: CommandContext, options: RunMaintenanceScheduleAddOptions): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-ADD-NO-PROJECT");
    }
    const taskKindParse = MaintenanceTaskKindSchema.safeParse(options.taskKind);
    if (!taskKindParse.success) {
      return maintenanceFailure(`Invalid --task-kind "${options.taskKind}". Expected one of: structural_review, defect_discovery, defect_remediation.`, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-ADD-INVALID-TASK-KIND");
    }
    const cadenceParse = parseCadenceInput(options.cadence);
    if (!cadenceParse.ok) {
      return maintenanceFailure(cadenceParse.reason, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-ADD-INVALID-CADENCE");
    }
    const policyParse = MaintenanceSchedulePolicySchema.safeParse(options.maxAutomaticRisk === undefined ? {} : { maxAutomaticRisk: options.maxAutomaticRisk });
    if (!policyParse.success) {
      return maintenanceFailure(`Invalid --max-automatic-risk "${options.maxAutomaticRisk}": must be an integer from 0 to 49 (it can only lower the existing <50 automatic-approval ceiling, never raise it).`, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-ADD-INVALID-POLICY");
    }

    const { paths, state } = loadProject(ctx);
    const now = new Date().toISOString();
    const anchorAt = options.anchorAt ?? now;
    if (Number.isNaN(Date.parse(anchorAt))) {
      return maintenanceFailure(`Invalid --anchor-at "${options.anchorAt}": not a parseable date/time.`, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-ADD-INVALID-ANCHOR");
    }

    const existing = state.maintenanceSchedules ?? [];
    const outcome = addSchedule(existing, {
      taskKind: taskKindParse.data,
      cadenceSeconds: cadenceParse.cadenceSeconds,
      anchorAt,
      enabled: !options.disabled,
      policy: policyParse.data,
      now,
    });
    if (!outcome.ok) {
      return maintenanceFailure(outcome.reason, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-ADD-CAP-REACHED");
    }

    const finalState: StateModel = { ...state, maintenanceSchedules: outcome.schedules };
    writeStateModel(paths.stateFile, finalState);

    const nextEventId = nextEventIdFactory(paths.runlogFile);
    appendRunlogEvent(
      paths.runlogFile,
      buildMaintenanceScheduleCreatedEvent({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [outcome.schedule.id],
        data: { scheduleId: outcome.schedule.id, taskKind: outcome.schedule.taskKind, cadenceSeconds: outcome.schedule.cadenceSeconds, enabled: outcome.schedule.enabled },
      }),
    );

    return makeResult({
      status: "passed",
      action: "maintenance",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Created schedule ${outcome.schedule.id} (${outcome.schedule.taskKind}, every ${options.cadence}, ${outcome.schedule.enabled ? "enabled" : "disabled"}).`,
      completedActions: ["Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [outcome.schedule.id],
      exitCode: ExitCode.Success,
      data: { schedule: outcome.schedule },
    });
  } catch (err) {
    return maintenanceFailure(err instanceof Error ? err.message : String(err), ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-ADD-UNEXPECTED-ERROR");
  }
}

// ---------------------------------------------------------------------------
// list / inspect (read-only, no mutation, no runlog append)
// ---------------------------------------------------------------------------

export function runMaintenanceScheduleList(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-LIST-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const schedules = state.maintenanceSchedules ?? [];
  return makeResult({
    status: "passed",
    action: "maintenance",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: schedules.length === 0 ? "No maintenance schedules exist." : `${schedules.length} maintenance schedule(s) found.`,
    exitCode: ExitCode.Success,
    data: { schedules },
  });
}

export function runMaintenanceScheduleInspect(ctx: CommandContext, scheduleId: string): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-INSPECT-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const schedule = (state.maintenanceSchedules ?? []).find((s) => s.id === scheduleId);
  if (!schedule) {
    return maintenanceFailure(`Schedule "${scheduleId}" does not exist.`, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-INSPECT-NOT-FOUND");
  }
  const isActive = state.maintenanceActiveOccurrence?.scheduleId === scheduleId;
  return makeResult({
    status: "passed",
    action: "maintenance",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `Schedule ${schedule.id} (${schedule.taskKind}): ${schedule.enabled ? "enabled" : "disabled"}, next due ${schedule.nextDueAt}${isActive ? ", occurrence currently active" : ""}.`,
    exitCode: ExitCode.Success,
    data: { schedule, activeOccurrence: isActive ? state.maintenanceActiveOccurrence : null },
  });
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export interface RunMaintenanceScheduleUpdateOptions {
  cadence?: string;
  maxAutomaticRisk?: number | null;
}

export function runMaintenanceScheduleUpdate(ctx: CommandContext, scheduleId: string, options: RunMaintenanceScheduleUpdateOptions): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-UPDATE-NO-PROJECT");
    }
    if (options.cadence === undefined && options.maxAutomaticRisk === undefined) {
      return maintenanceFailure("Provide at least one of --cadence or --max-automatic-risk to update.", ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-UPDATE-NO-CHANGES");
    }

    let cadenceSeconds: number | undefined;
    if (options.cadence !== undefined) {
      const cadenceParse = parseCadenceInput(options.cadence);
      if (!cadenceParse.ok) return maintenanceFailure(cadenceParse.reason, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-UPDATE-INVALID-CADENCE");
      cadenceSeconds = cadenceParse.cadenceSeconds;
    }

    const { paths, state } = loadProject(ctx);
    const existing = state.maintenanceSchedules ?? [];
    const current = existing.find((s) => s.id === scheduleId);
    if (!current) {
      return maintenanceFailure(`Schedule "${scheduleId}" does not exist.`, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-UPDATE-NOT-FOUND");
    }

    let policy = current.policy;
    if (options.maxAutomaticRisk !== undefined) {
      const nextPolicy = options.maxAutomaticRisk === null ? {} : { maxAutomaticRisk: options.maxAutomaticRisk };
      const policyParse = MaintenanceSchedulePolicySchema.safeParse(nextPolicy);
      if (!policyParse.success) {
        return maintenanceFailure(`Invalid --max-automatic-risk "${options.maxAutomaticRisk}": must be an integer from 0 to 49.`, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-UPDATE-INVALID-POLICY");
      }
      policy = policyParse.data;
    }

    const now = new Date().toISOString();
    const outcome = updateSchedule(existing, scheduleId, { cadenceSeconds, policy, now });
    if (!outcome.ok) {
      return maintenanceFailure(outcome.reason, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-UPDATE-NOT-FOUND");
    }

    const finalState: StateModel = { ...state, maintenanceSchedules: outcome.schedules };
    writeStateModel(paths.stateFile, finalState);

    const nextEventId = nextEventIdFactory(paths.runlogFile);
    appendRunlogEvent(
      paths.runlogFile,
      buildMaintenanceScheduleUpdatedEvent({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [scheduleId],
        data: { scheduleId, taskKind: outcome.schedule.taskKind, cadenceSeconds: outcome.schedule.cadenceSeconds, nextDueAt: outcome.schedule.nextDueAt },
      }),
    );

    return makeResult({
      status: "passed",
      action: "maintenance",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Updated schedule ${scheduleId}; next due ${outcome.schedule.nextDueAt}.`,
      completedActions: ["Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [scheduleId],
      exitCode: ExitCode.Success,
      data: { schedule: outcome.schedule },
    });
  } catch (err) {
    return maintenanceFailure(err instanceof Error ? err.message : String(err), ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-UPDATE-UNEXPECTED-ERROR");
  }
}

// ---------------------------------------------------------------------------
// enable / disable
// ---------------------------------------------------------------------------

function runSetEnabled(ctx: CommandContext, scheduleId: string, enabled: boolean): CommandResult {
  const ISSUE_PREFIX = enabled ? "MAINTENANCE-SCHEDULE-ENABLE" : "MAINTENANCE-SCHEDULE-DISABLE";
  try {
    if (!aiqtDirExists(ctx)) {
      return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, `${ISSUE_PREFIX}-NO-PROJECT`);
    }
    const { paths, state } = loadProject(ctx);
    const existing = state.maintenanceSchedules ?? [];
    const now = new Date().toISOString();
    const outcome = enabled ? enableSchedule(existing, scheduleId, now) : disableSchedule(existing, scheduleId, now);
    if (!outcome.ok) {
      return maintenanceFailure(outcome.reason, ExitCode.InvalidInput, `${ISSUE_PREFIX}-NOT-FOUND`);
    }

    const finalState: StateModel = { ...state, maintenanceSchedules: outcome.schedules };
    writeStateModel(paths.stateFile, finalState);

    const nextEventId = nextEventIdFactory(paths.runlogFile);
    const builder = enabled ? buildMaintenanceScheduleEnabledEvent : buildMaintenanceScheduleDisabledEvent;
    appendRunlogEvent(
      paths.runlogFile,
      builder({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [scheduleId],
        data: { scheduleId, taskKind: outcome.schedule.taskKind },
      }),
    );

    return makeResult({
      status: "passed",
      action: "maintenance",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `${enabled ? "Enabled" : "Disabled"} schedule ${scheduleId}.`,
      completedActions: ["Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [scheduleId],
      exitCode: ExitCode.Success,
      data: { schedule: outcome.schedule },
    });
  } catch (err) {
    return maintenanceFailure(err instanceof Error ? err.message : String(err), ExitCode.InvalidInput, `${ISSUE_PREFIX}-UNEXPECTED-ERROR`);
  }
}

export function runMaintenanceScheduleEnable(ctx: CommandContext, scheduleId: string): CommandResult {
  return runSetEnabled(ctx, scheduleId, true);
}
export function runMaintenanceScheduleDisable(ctx: CommandContext, scheduleId: string): CommandResult {
  return runSetEnabled(ctx, scheduleId, false);
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

export function runMaintenanceScheduleRemove(ctx: CommandContext, scheduleId: string): CommandResult {
  try {
    if (!aiqtDirExists(ctx)) {
      return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-REMOVE-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    if (state.maintenanceActiveOccurrence?.scheduleId === scheduleId) {
      return maintenanceFailure(
        `Schedule "${scheduleId}" has an active occurrence (${state.maintenanceActiveOccurrence.occurrenceId}). Cancel it first with "aiqt maintenance cancel" before removing the schedule.`,
        ExitCode.WorkflowBlocked,
        "MAINTENANCE-SCHEDULE-REMOVE-ACTIVE-OCCURRENCE",
      );
    }

    const existing = state.maintenanceSchedules ?? [];
    const removedSchedule = existing.find((s) => s.id === scheduleId);
    const outcome = removeSchedule(existing, scheduleId);
    if (!outcome.ok) {
      return maintenanceFailure(outcome.reason, ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-REMOVE-NOT-FOUND");
    }

    const finalState: StateModel = { ...state, maintenanceSchedules: outcome.schedules };
    writeStateModel(paths.stateFile, finalState);

    const now = new Date().toISOString();
    const nextEventId = nextEventIdFactory(paths.runlogFile);
    appendRunlogEvent(
      paths.runlogFile,
      buildMaintenanceScheduleRemovedEvent({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [scheduleId],
        data: { scheduleId, taskKind: removedSchedule?.taskKind ?? "unknown" },
      }),
    );

    return makeResult({
      status: "passed",
      action: "maintenance",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Removed schedule ${scheduleId}. Prior runlog history is preserved.`,
      completedActions: ["Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [scheduleId],
      exitCode: ExitCode.Success,
      data: { removedScheduleId: scheduleId },
    });
  } catch (err) {
    return maintenanceFailure(err instanceof Error ? err.message : String(err), ExitCode.InvalidInput, "MAINTENANCE-SCHEDULE-REMOVE-UNEXPECTED-ERROR");
  }
}
