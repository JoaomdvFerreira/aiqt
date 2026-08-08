import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { readRunlogEvents } from "../../state/runlog-store.js";
import { maintenanceFailure } from "./maintenance-shared.js";

/**
 * `aiqt maintenance status` / `aiqt maintenance history` (M45-WU02, build
 * spec Sec 15): read-only compact operator views. `status` derives from
 * canonical state only (schedules + the single active-occurrence slot);
 * `history` derives from the runlog rather than requiring an unbounded
 * completed-run array in state.json. Neither mutates state or appends a
 * runlog event.
 */

const MAINTENANCE_EVENT_TYPE_PREFIX = "maintenance.";

export function runMaintenanceStatus(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-STATUS-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const schedules = state.maintenanceSchedules ?? [];
  const enabled = schedules.filter((s) => s.enabled);
  const nextDue = [...enabled].sort((a, b) => Date.parse(a.nextDueAt) - Date.parse(b.nextDueAt) || a.id.localeCompare(b.id))[0] ?? null;
  const active = state.maintenanceActiveOccurrence ?? null;

  return makeResult({
    status: "passed",
    action: "maintenance",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary:
      active !== null
        ? `Occurrence ${active.occurrenceId} is active for schedule ${active.scheduleId} (${active.taskKind}).`
        : nextDue !== null
          ? `${schedules.length} schedule(s) (${enabled.length} enabled); next due: ${nextDue.id} at ${nextDue.nextDueAt}.`
          : `${schedules.length} schedule(s) (${enabled.length} enabled); none due.`,
    exitCode: ExitCode.Success,
    data: {
      totalSchedules: schedules.length,
      enabledSchedules: enabled.length,
      disabledSchedules: schedules.length - enabled.length,
      nextDueScheduleId: nextDue?.id ?? null,
      nextDueAt: nextDue?.nextDueAt ?? null,
      activeOccurrence: active,
    },
  });
}

export interface RunMaintenanceHistoryOptions {
  scheduleId?: string;
  limit?: number;
}

export function runMaintenanceHistory(ctx: CommandContext, options: RunMaintenanceHistoryOptions): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return maintenanceFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "MAINTENANCE-HISTORY-NO-PROJECT");
  }
  const { paths, state } = loadProject(ctx);
  const allEvents = readRunlogEvents(paths.runlogFile);
  const maintenanceEvents = allEvents.filter((e) => e.type.startsWith(MAINTENANCE_EVENT_TYPE_PREFIX));
  const filtered = options.scheduleId ? maintenanceEvents.filter((e) => e.relatedIds.includes(options.scheduleId!)) : maintenanceEvents;
  const limit = options.limit && options.limit > 0 ? options.limit : 50;
  const events = filtered.slice(-limit).reverse();

  return makeResult({
    status: "passed",
    action: "maintenance",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${events.length} maintenance event(s)${options.scheduleId ? ` for schedule ${options.scheduleId}` : ""} (of ${filtered.length} total).`,
    exitCode: ExitCode.Success,
    data: { events, totalCount: filtered.length },
  });
}
