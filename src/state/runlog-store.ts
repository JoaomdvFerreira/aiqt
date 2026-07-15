import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { Issue } from "../core/output/issue.js";
import { appendJsonLine } from "../core/filesystem/safe-writer.js";
import { readTextFile, FileReadError } from "../core/filesystem/file-store.js";
import { isFile } from "../core/filesystem/file-exists.js";
import {
  RunlogEventSchema,
  type RunlogEvent,
} from "../schema/runlog-event.schema.js";

export interface RunlogHealth {
  totalLines: number;
  validLines: number;
  malformedLines: number;
  malformedLineNumbers: number[];
}

/** Build the canonical project.initialized event appended by `aiqt init`. */
export function buildProjectInitializedEvent(input: {
  id: string;
  projectId: string;
  timestamp: string;
  schemaVersion: string;
}): RunlogEvent {
  return {
    id: input.id,
    type: "project.initialized",
    timestamp: input.timestamp,
    actor: "aiqt",
    summary: "Project initialized with canonical AIQT state files.",
    relatedIds: [input.projectId],
    data: { schemaVersion: input.schemaVersion },
  };
}

export function appendRunlogEvent(path: string, event: RunlogEvent): void {
  appendJsonLine(path, event);
}

export interface ProjectUpdatedEventData {
  changedFields: string[];
  changedSections: string[];
  createdRecordIds: string[];
  updatedRecordIds: string[];
  planningContextReady: boolean;
  nextRecommendedCommand: string | null;
}

/** Build the project.updated event appended by `aiqt update` on mutation. */
export function buildProjectUpdatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ProjectUpdatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "project.updated",
    timestamp: input.timestamp,
    actor: "human",
    summary: "Project context updated.",
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

/** Build the decision.recorded event appended once per newly created decision. */
export function buildDecisionRecordedEvent(input: {
  id: string;
  timestamp: string;
  projectId: string;
  decisionId: string;
  decision: string;
  reason: string;
  impact: string;
}): RunlogEvent {
  return {
    id: input.id,
    type: "decision.recorded",
    timestamp: input.timestamp,
    actor: "human",
    summary: "Decision recorded.",
    relatedIds: [input.projectId, input.decisionId],
    data: {
      decisionId: input.decisionId,
      decision: input.decision,
      reason: input.reason,
      impact: input.impact,
    },
  };
}

export interface WorkGraphGeneratedEventData {
  source: "from-file";
  milestoneCount: number;
  workUnitCount: number;
  dependencyCount: number;
  readyWorkUnitId: string | null;
  nextRecommendedCommand: string | null;
}

/** Build the work_graph.generated event appended by `aiqt plan` on success. */
export function buildWorkGraphGeneratedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkGraphGeneratedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "work_graph.generated",
    timestamp: input.timestamp,
    actor: "aiqt",
    summary: "Work graph generated from structured plan input.",
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface PacketGuidanceFlagsData {
  includesDesignGuidance: boolean;
  includesWorkingDirectoryDiscipline: boolean;
  includesComponentSystemGuidance: boolean;
  includesRecoveryGuidance: boolean;
  /** M15 §13: additive. Older runlog events lack this key; readers default it to false. */
  includesSourceControlGuidance: boolean;
}

export interface AgentPacketCreatedEventData {
  packetId: string;
  workUnitId: string;
  milestoneId: string;
  format: "markdown";
  contentHash: string;
  nextRecommendedCommand: string | null;
  /** M14 §11.1: additive audit metadata. The authoritative historical record for packet guidance audit -- not just a state.lastAgentPacket mirror. */
  renderedSections?: string[];
  guidanceFlags?: PacketGuidanceFlagsData;
}

/** Build the agent_packet.created event appended by `aiqt next` on success. */
export function buildAgentPacketCreatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: AgentPacketCreatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "agent_packet.created",
    timestamp: input.timestamp,
    actor: "aiqt",
    summary: `Agent packet created for work unit ${input.data.workUnitId}.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface WorkUnitStatusChangedEventData {
  workUnitId: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
}

/** Build the work_unit.status_changed event appended by `aiqt next` on success. */
function defaultWorkUnitStatusChangedSummary(data: WorkUnitStatusChangedEventData): string {
  switch (data.toStatus) {
    case "in_progress":
      return `Work unit ${data.workUnitId} started.`;
    case "done":
      return `Work unit ${data.workUnitId} completed.`;
    case "ready":
      return `Work unit ${data.workUnitId} became ready.`;
    default:
      return `Work unit ${data.workUnitId} status changed to ${data.toStatus}.`;
  }
}

export function buildWorkUnitStatusChangedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkUnitStatusChangedEventData;
  summary?: string;
}): RunlogEvent {
  return {
    id: input.id,
    type: "work_unit.status_changed",
    timestamp: input.timestamp,
    actor: "aiqt",
    summary: input.summary ?? defaultWorkUnitStatusChangedSummary(input.data),
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface CheckpointCreatedEventData {
  checkpointId: string;
  workUnitId: string;
  packetId: string | null;
  validationResult: string;
  acceptanceCriteriaResult: string;
  targetStatus: string;
  nextRecommendedCommand: string | null;
}

/** Build the checkpoint.created event appended by `aiqt checkpoint` on success. */
export function buildCheckpointCreatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: CheckpointCreatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "checkpoint.created",
    timestamp: input.timestamp,
    actor: "human",
    summary: `Checkpoint captured for work unit ${input.data.workUnitId}.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExportGeneratedEventData {
  target: string;
  format: "markdown";
  files: string[];
  skippedTargets?: string[];
  dryRun: false;
}

/** Build the export.generated event appended by `aiqt export` only on write. */
export function buildExportGeneratedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExportGeneratedEventData;
}): RunlogEvent {
  const fileCount = input.data.files.length;
  return {
    id: input.id,
    type: "export.generated",
    timestamp: input.timestamp,
    actor: "aiqt",
    summary:
      fileCount === 1
        ? "Generated AIQT export documents."
        : `Generated ${fileCount} export documents.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ReviewFindingAcknowledgedEventData {
  findingKey: string;
  reason: string;
  sourceCommand: string;
}

/** Build the review.finding_acknowledged event appended by `aiqt review acknowledge` (M9 §10.1). */
export function buildReviewFindingAcknowledgedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ReviewFindingAcknowledgedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "review.finding_acknowledged",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Acknowledged review finding ${input.data.findingKey}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface PacketCancelledEventData {
  packetId: string;
  workUnitId: string;
  milestoneId: string;
  restoredWorkUnitStatus: string;
  previousLastAgentPacketId: string | null;
  sourceCommand: string;
}

/** Build the packet.cancelled event appended by `aiqt next cancel` (M9 §10.2). */
export function buildPacketCancelledEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: PacketCancelledEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "packet.cancelled",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Cancelled agent packet ${input.data.packetId} for work unit ${input.data.workUnitId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface IssueUpdatedEventData {
  issueKey: string;
  status: string;
  reason: string;
  sourceCommand: string;
}

/** Build the issue.updated event appended by `aiqt issue update` (M11 §13.1). */
export function buildIssueUpdatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: IssueUpdatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "issue.updated",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Updated issue ${input.data.issueKey} to ${input.data.status}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface IssuePromotedEventData {
  issueKey: string;
  workUnitId: string;
  milestoneId: string;
  title: string;
  sourceCommand: string;
}

/** Build the issue.promoted event appended by `aiqt issue promote` (M11 §13.2). */
export function buildIssuePromotedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: IssuePromotedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "issue.promoted",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Promoted ${input.data.issueKey.split(":")[1] ?? input.data.issueKey} issue to work unit ${input.data.workUnitId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface CheckpointAmendedEventData {
  amendmentId: string;
  checkpointId: string;
  workUnitId: string;
  acceptanceCriteriaResult?: string;
  validationResult?: string;
  reason: string;
  sourceCommand: string;
}

/** Build the checkpoint.amended event appended by `aiqt checkpoint amend` (M12 §12.1). */
export function buildCheckpointAmendedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: CheckpointAmendedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "checkpoint.amended",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Amended checkpoint ${input.data.checkpointId} for work unit ${input.data.workUnitId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface DependencyUpdatedEventData {
  dependencyId: string;
  fromWorkUnitId: string;
  toWorkUnitId: string;
  previousType: string;
  newType: string;
  reason: string;
  sourceCommand: string;
}

/** Build the dependency.updated event appended by `aiqt dependency update` (M12 §12.2). */
export function buildDependencyUpdatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: DependencyUpdatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "dependency.updated",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Updated dependency ${input.data.dependencyId} from ${input.data.previousType} to ${input.data.newType}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

/**
 * Find the most recent agent_packet.created event whose packetId is not
 * `excludePacketId`, scanning runlog history in chronological (append) order.
 * Used by `aiqt next cancel` (M9 §8.5) to restore lastAgentPacket to the
 * previously valid packet, since state only ever tracks the single current
 * packet directly.
 */
export function findPreviousAgentPacketMetadata(
  path: string,
  excludePacketId: string,
): {
  id: string;
  workUnitId: string;
  milestoneId: string;
  createdAt: string;
  format: "markdown";
  contentHash: string;
  sourceCommand: "aiqt next";
} | null {
  if (!isFile(path)) return null;
  let raw: string;
  try {
    raw = readTextFile(path);
  } catch {
    return null;
  }

  let previous: {
    id: string;
    workUnitId: string;
    milestoneId: string;
    createdAt: string;
    format: "markdown";
    contentHash: string;
    sourceCommand: "aiqt next";
  } | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      const result = RunlogEventSchema.safeParse(parsed);
      if (result.success && result.data.type === "agent_packet.created") {
        const data = result.data.data as
          | { packetId?: unknown; workUnitId?: unknown; milestoneId?: unknown; contentHash?: unknown }
          | undefined;
        if (
          typeof data?.packetId === "string" &&
          data.packetId !== excludePacketId &&
          typeof data.workUnitId === "string" &&
          typeof data.milestoneId === "string" &&
          typeof data.contentHash === "string"
        ) {
          previous = {
            id: data.packetId,
            workUnitId: data.workUnitId,
            milestoneId: data.milestoneId,
            createdAt: result.data.timestamp,
            format: "markdown",
            contentHash: data.contentHash,
            sourceCommand: "aiqt next",
          };
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return previous;
}

/**
 * M14 §11.3: find the latest valid agent_packet.created runlog event
 * matching `packetId`, scanning the full runlog history (later entries win,
 * mirroring findPreviousAgentPacketMetadata's convention). Returns null when
 * no matching event exists or it carries no renderedSections/guidanceFlags
 * -- e.g. older packets created before M14. This is the authoritative
 * historical audit source; state.lastAgentPacket is only ever a mirror.
 */
export function findAgentPacketAuditMetadata(
  path: string,
  packetId: string,
): { renderedSections: string[]; guidanceFlags: PacketGuidanceFlagsData } | null {
  if (!isFile(path)) return null;
  let raw: string;
  try {
    raw = readTextFile(path);
  } catch {
    return null;
  }

  let found: { renderedSections: string[]; guidanceFlags: PacketGuidanceFlagsData } | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      const result = RunlogEventSchema.safeParse(parsed);
      if (result.success && result.data.type === "agent_packet.created") {
        const data = result.data.data as
          | {
              packetId?: unknown;
              renderedSections?: unknown;
              guidanceFlags?: unknown;
            }
          | undefined;
        if (
          data?.packetId === packetId &&
          Array.isArray(data.renderedSections) &&
          data.renderedSections.every((s) => typeof s === "string") &&
          typeof data.guidanceFlags === "object" &&
          data.guidanceFlags !== null
        ) {
          const flags = data.guidanceFlags as Record<string, unknown>;
          found = {
            renderedSections: data.renderedSections as string[],
            guidanceFlags: {
              includesDesignGuidance: Boolean(flags.includesDesignGuidance),
              includesWorkingDirectoryDiscipline: Boolean(flags.includesWorkingDirectoryDiscipline),
              includesComponentSystemGuidance: Boolean(flags.includesComponentSystemGuidance),
              includesRecoveryGuidance: Boolean(flags.includesRecoveryGuidance),
              includesSourceControlGuidance: Boolean(flags.includesSourceControlGuidance),
            },
          };
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return found;
}

/**
 * Read every PKT- packet id discoverable from runlog agent_packet.created
 * events, plus `lastAgentPacket.id` when present. Used to continue the
 * stable PKT- id sequence.
 */
export function readAgentPacketIds(
  path: string,
  lastAgentPacket?: { id?: string } | null,
): string[] {
  const ids: string[] = [];
  if (isFile(path)) {
    let raw: string;
    try {
      raw = readTextFile(path);
    } catch {
      raw = "";
    }
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed = JSON.parse(line);
        const result = RunlogEventSchema.safeParse(parsed);
        if (result.success && result.data.type === "agent_packet.created") {
          const packetId = (result.data.data as { packetId?: unknown } | undefined)
            ?.packetId;
          if (typeof packetId === "string") ids.push(packetId);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  if (lastAgentPacket && typeof lastAgentPacket.id === "string") {
    ids.push(lastAgentPacket.id);
  }
  return ids;
}

/**
 * Read the `id` of every well-formed event in runlog.jsonl, ignoring
 * malformed lines. Used to continue the stable EVT- id sequence. Returns an
 * empty list for a missing/unreadable file rather than throwing, since event
 * ID continuation is best-effort and the caller has already validated runlog
 * health via inspectRunlogHealth.
 */
export function readRunlogEventIds(path: string): string[] {
  if (!isFile(path)) return [];
  let raw: string;
  try {
    raw = readTextFile(path);
  } catch {
    return [];
  }

  const ids: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      const result = RunlogEventSchema.safeParse(parsed);
      if (result.success) ids.push(result.data.id);
    } catch {
      // skip malformed lines
    }
  }
  return ids;
}

function invalidRunlogIssue(message: string): Issue {
  return {
    id: "RUNLOG-INVALID",
    severity: "critical",
    area: "runlog",
    message,
    suggestedAction: "Restore a readable .aiqt/runlog.jsonl.",
    agentCanFix: false,
  };
}

/**
 * Inspect runlog.jsonl health. A missing or unreadable file is invalid state
 * and blocks with exit code 3. Malformed individual lines are counted and
 * surfaced as warnings by the caller, but do not block.
 */
export function inspectRunlogHealth(path: string): RunlogHealth {
  if (!isFile(path)) {
    throw new AiqtError(
      `Missing runlog: ${path}`,
      ExitCode.InvalidInput,
      invalidRunlogIssue(`Missing runlog file: ${path}`),
    );
  }

  let raw: string;
  try {
    raw = readTextFile(path);
  } catch (err) {
    if (err instanceof FileReadError) {
      throw new AiqtError(
        err.message,
        ExitCode.InvalidInput,
        invalidRunlogIssue(err.message),
      );
    }
    throw err;
  }

  const lines = raw.split(/\r?\n/);
  let totalLines = 0;
  let validLines = 0;
  const malformedLineNumbers: number[] = [];

  lines.forEach((line, index) => {
    if (line.trim() === "") return; // ignore blank lines (e.g. trailing newline)
    totalLines += 1;
    const lineNumber = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLineNumbers.push(lineNumber);
      return;
    }
    if (RunlogEventSchema.safeParse(parsed).success) {
      validLines += 1;
    } else {
      malformedLineNumbers.push(lineNumber);
    }
  });

  return {
    totalLines,
    validLines,
    malformedLines: malformedLineNumbers.length,
    malformedLineNumbers,
  };
}

/** Build the warning Issue for malformed runlog lines, or null if healthy. */
export function runlogHealthWarning(health: RunlogHealth): Issue | null {
  if (health.malformedLines === 0) return null;
  return {
    id: "RUNLOG-MALFORMED-LINES",
    severity: "medium",
    area: "runlog",
    message: `runlog.jsonl contains ${health.malformedLines} malformed line(s): ${health.malformedLineNumbers.join(", ")}.`,
    affectedItems: health.malformedLineNumbers.map((n) => `line ${n}`),
    suggestedAction: "Repair or remove the malformed runlog lines.",
    agentCanFix: false,
  };
}
