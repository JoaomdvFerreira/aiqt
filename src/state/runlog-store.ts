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
    case "replanned":
      return `Work unit ${data.workUnitId} replanned.`;
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

export interface PlanExtendedEventData {
  operation: "append" | "refine";
  addedMilestoneIds: string[];
  addedWorkUnitIds: string[];
  addedDependencyIds: string[];
  nextRecommendedCommand: string | null;
  /** refine only. */
  targetWorkUnitId?: string;
  /** refine only. */
  reason?: string;
  /** refine only. */
  entryWorkUnitIds?: string[];
  /** refine only. */
  exitWorkUnitIds?: string[];
  /** refine only. */
  copiedIncomingDependencyIds?: string[];
  /** refine only. */
  copiedOutgoingDependencyIds?: string[];
}

/** M17 §12.1/M17-RC1 §15: the plan.extended event appended by `aiqt plan --extend` (append or refine) on success. Reused verbatim by `aiqt import plan --stdin --extend`. */
export function buildPlanExtendedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: PlanExtendedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "plan.extended",
    timestamp: input.timestamp,
    actor: "aiqt",
    summary:
      input.data.operation === "refine"
        ? `Work graph extended; refined work unit ${input.data.targetWorkUnitId}.`
        : "Work graph extended via append.",
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

export interface GraphRepairedChange {
  workUnitId: string;
  from: string;
  to: string;
}

export interface GraphRepairedEventData {
  repairType: "stale_readiness" | "workflow_integrity";
  workUnitIds: string[];
  repairedPointers?: Array<{ pointerName: "currentMilestoneId" | "currentWorkUnitId"; from: string; to: null }>;
  changes: GraphRepairedChange[];
}

/** Build the graph.repaired event appended by `aiqt graph repair --apply` (M18 §13). */
export function buildGraphRepairedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: GraphRepairedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "graph.repaired",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Repaired ${input.data.workUnitIds.length} stale-ready work unit(s): ${input.data.workUnitIds.join(", ")}.`,
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
      if (result.success) {
        ids.push(result.data.id);
        continue;
      }
    } catch {
      // fall through to best-effort id reservation below
    }

    const idMatch = line.match(/"id"\s*:\s*"([^"]+)"/);
    if (idMatch?.[1]) {
      ids.push(idMatch[1]);
    }
  }
  return ids;
}

/**
 * M29 §5.2: read every well-formed event in runlog.jsonl as a full object
 * (not just its id), ignoring malformed lines -- the append-only runlog is
 * the complete historical authority for advisory observation/feedback
 * telemetry and gap detection, since canonical state only mirrors the
 * current/latest-N view. Returns an empty list for a missing/unreadable
 * file, matching readRunlogEventIds' best-effort contract.
 */
export function readRunlogEvents(path: string): RunlogEvent[] {
  if (!isFile(path)) return [];
  let raw: string;
  try {
    raw = readTextFile(path);
  } catch {
    return [];
  }

  const events: RunlogEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      const result = RunlogEventSchema.safeParse(parsed);
      if (result.success) events.push(result.data);
    } catch {
      // skip malformed lines
    }
  }
  return events;
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

/**
 * M22-WU08: evidence/ProjectIssue/decision-escalation event payloads
 * contain IDs, counts, status, and digests only -- no source-finding text,
 * logs, artifact bodies, or absolute secret-bearing paths (M22 §7.3).
 */
export interface EvidenceRecordedEventData {
  evidenceId: string;
  workUnitId: string;
  providerType: string;
  trustLevel: string;
  sourceFindingCount: number;
  artifactReferenceCount: number;
}

export function buildEvidenceRecordedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: EvidenceRecordedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence.recorded",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Recorded evidence ${input.data.evidenceId} for work unit ${input.data.workUnitId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface EvidenceLinkedEventData {
  evidenceId: string;
  workUnitId: string;
}

/** Idempotent-link acknowledgment -- appended only when a caller explicitly requests recording an already-known evidenceId, never for a silent no-op. */
export function buildEvidenceLinkedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: EvidenceLinkedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence.linked",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Linked existing evidence ${input.data.evidenceId} for work unit ${input.data.workUnitId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ProjectIssueCreatedEventData {
  projectIssueId: string;
  issueKey: string;
  severity: string;
  sourceType: string;
}

export function buildProjectIssueCreatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ProjectIssueCreatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "project_issue.created",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Created project issue ${input.data.projectIssueId} (${input.data.issueKey})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ProjectIssueTransitionedEventData {
  transitionId: string;
  issueKey: string;
  projectIssueId: string;
  checkpointId: string;
  reason: string;
}

export function buildProjectIssueTransitionedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ProjectIssueTransitionedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "project_issue.transitioned",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Transitioned ${input.data.issueKey} from checkpoint ${input.data.checkpointId} to project issue ${input.data.projectIssueId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface DecisionEscalationCreatedEventData {
  escalationId: string;
  escalationKey: string;
  category: string;
}

export function buildDecisionEscalationCreatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: DecisionEscalationCreatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "decision_escalation.created",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Created decision escalation ${input.data.escalationId} (${input.data.category})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface DecisionEscalationResolvedEventData {
  escalationId: string;
  escalationKey: string;
  status: string;
}

export function buildDecisionEscalationResolvedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: DecisionEscalationResolvedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "decision_escalation.resolved",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Resolved decision escalation ${input.data.escalationId} as ${input.data.status}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

/**
 * M25 §17: bounded workspace event payloads. Never raw Git output,
 * command arguments, environment, remote, credentials, or full physical
 * path -- only IDs, provider/lifecycle facts, and a bounded outcome.
 */
export interface WorkspacePreparedEventData {
  workspaceId: string;
  providerId: string;
  workspaceSeriesKey: string;
  generation: number;
  lifecycleStatus: string;
  outcome: "created" | "linked";
}

export function buildWorkspacePreparedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspacePreparedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.prepared",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Prepared workspace ${input.data.workspaceId} (${input.data.providerId}, generation ${input.data.generation}, ${input.data.outcome})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface WorkspaceBindingCreatedEventData {
  workspaceId: string;
  workUnitId: string;
  providerId: string;
}

export function buildWorkspaceBindingCreatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspaceBindingCreatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.binding_created",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Bound work unit ${input.data.workUnitId} to workspace ${input.data.workspaceId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface WorkspaceBindingReleasedEventData {
  workspaceId: string;
  workUnitId: string;
  providerId: string;
}

export function buildWorkspaceBindingReleasedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspaceBindingReleasedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.binding_released",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Released work unit ${input.data.workUnitId}'s binding to workspace ${input.data.workspaceId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface WorkspaceReleasedEventData {
  workspaceId: string;
  providerId: string;
}

export function buildWorkspaceReleasedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspaceReleasedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.released",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Released workspace ${input.data.workspaceId} (${input.data.providerId})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface WorkspacePendingOperationEventData {
  pendingOperationId: string;
  workspaceId: string;
  workUnitId: string;
  providerId: string;
  generation: number;
}

/** M25 §14.1 step 5 / §14.2 step 2: recorded once the pending operation is persisted, before the provider side effect runs. */
export function buildWorkspacePreparePendingEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspacePendingOperationEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.prepare_pending",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Reserved pending prepare for workspace ${input.data.workspaceId} (work unit ${input.data.workUnitId})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export function buildWorkspaceReleasePendingEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspacePendingOperationEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.release_pending",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Reserved pending release for workspace ${input.data.workspaceId} (work unit ${input.data.workUnitId})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface WorkspaceRecoveryEventData {
  pendingOperationId: string;
  workspaceId: string;
  operationType: "prepare" | "release";
  action: string;
}

export function buildWorkspaceRecoveryCompletedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspaceRecoveryEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.recovery_completed",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Recovered pending ${input.data.operationType} for workspace ${input.data.workspaceId}: ${input.data.action}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export function buildWorkspaceRecoveryBlockedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: WorkspaceRecoveryEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "workspace.recovery_blocked",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Recovery blocked for pending ${input.data.operationType} on workspace ${input.data.workspaceId}: manual intervention required`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

/**
 * M26 §17/§4.3: bounded execution-session event payloads. Never raw
 * provider payload, prompts, transcripts, logs, diffs, or source -- only
 * IDs, provider identity, and bounded facts already present on the
 * canonical ExecutionSession record.
 */
export interface ExecutionSessionOpenedEventData {
  sessionId: string;
  providerId: string;
  workUnitId: string;
  packetId: string;
  outcome: "created" | "no_op";
}

export function buildExecutionSessionOpenedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionSessionOpenedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.session_opened",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Opened execution session ${input.data.sessionId} (${input.data.providerId}) for work unit ${input.data.workUnitId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionSessionStatusChangedEventData {
  sessionId: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
}

export function buildExecutionSessionStatusChangedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionSessionStatusChangedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.session_status_changed",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Execution session ${input.data.sessionId}: ${input.data.fromStatus} -> ${input.data.toStatus}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionSessionBudgetUpdatedEventData {
  sessionId: string;
  budgetState: string;
}

export function buildExecutionSessionBudgetUpdatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionSessionBudgetUpdatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.session_budget_updated",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Execution session ${input.data.sessionId} budgets updated (state: ${input.data.budgetState})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionIterationStartedEventData {
  sessionId: string;
  iterationId: string;
  sequence: number;
}

export function buildExecutionIterationStartedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionIterationStartedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.iteration_started",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Iteration ${input.data.iterationId} (#${input.data.sequence}) started for session ${input.data.sessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionIterationFinishedEventData {
  sessionId: string;
  iterationId: string;
  status: string;
}

export function buildExecutionIterationFinishedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionIterationFinishedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.iteration_finished",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Iteration ${input.data.iterationId} finished (${input.data.status}) for session ${input.data.sessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionDecisionRequestedEventData {
  sessionId: string;
  decisionId: string;
}

export function buildExecutionDecisionRequestedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionDecisionRequestedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.decision_requested",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Decision ${input.data.decisionId} requested for session ${input.data.sessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionDecisionResolvedEventData {
  sessionId: string;
  decisionId: string;
}

export function buildExecutionDecisionResolvedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionDecisionResolvedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.decision_resolved",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Decision ${input.data.decisionId} resolved for session ${input.data.sessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionRollbackReportedEventData {
  sessionId: string;
  rollbackId: string;
}

export function buildExecutionRollbackReportedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionRollbackReportedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.rollback_reported",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Unverified rollback ${input.data.rollbackId} reported for session ${input.data.sessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionSessionSummaryUpdatedEventData {
  sessionId: string;
}

export function buildExecutionSessionSummaryUpdatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionSessionSummaryUpdatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.session_summary_updated",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Learning summary updated for session ${input.data.sessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionSessionReferencesAddedEventData {
  sessionId: string;
  commitRefCount: number;
  evidenceRefCount: number;
}

export function buildExecutionSessionReferencesAddedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionSessionReferencesAddedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.session_references_added",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Added ${input.data.commitRefCount} commit ref(s) and ${input.data.evidenceRefCount} evidence ref(s) to session ${input.data.sessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionAdapterRequestCreatedEventData {
  requestId: string;
  executionSessionId: string;
  workUnitId: string;
  mode: string;
  requestSequence: number;
}

/** M27 §3.1/§5.1: records creation of a Claude Code adapter request (start or resume). Never contains prompt/provider content. */
export function buildExecutionAdapterRequestCreatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionAdapterRequestCreatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.adapter_request_created",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Created Claude Code adapter request ${input.data.requestId} (${input.data.mode}, sequence ${input.data.requestSequence}) for execution session ${input.data.executionSessionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExecutionAdapterRequestImportedEventData {
  requestId: string;
  executionSessionId: string;
  resultClass: string;
}

/** M27 §5.1: records a successful, atomic import of provider stream-json output for one adapter request. Never contains raw provider content. */
export function buildExecutionAdapterRequestImportedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExecutionAdapterRequestImportedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "execution.adapter_request_imported",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Imported Claude Code adapter request ${input.data.requestId} for execution session ${input.data.executionSessionId} (result: ${input.data.resultClass})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface EvidenceGatePolicyImportedEventData {
  policyId: string;
  version: number;
  policyDigest: string;
  ruleCount: number;
}

/** M28 §4.2: records a successful policy import. Never contains rule bodies or raw import bytes. */
export function buildEvidenceGatePolicyImportedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: EvidenceGatePolicyImportedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.policy_imported",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Imported evidence gate policy ${input.data.policyId} v${input.data.version} (${input.data.ruleCount} rule(s))`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface EvidenceGatePolicyActivatedEventData {
  policyId: string;
  version: number;
  previousPolicyId: string | null;
  previousVersion: number | null;
}

/** M28 §4.3: records activation -- a pointer change only, never a simulation or finding. */
export function buildEvidenceGatePolicyActivatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: EvidenceGatePolicyActivatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.policy_activated",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Activated evidence gate policy ${input.data.policyId} v${input.data.version}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface EvidenceGateAdvisoryObservationRecordedEventData {
  observationId: string;
  checkpointId: string;
  workUnitId: string;
  trigger: "checkpoint" | "amendment" | "manual_refresh";
  evaluationStatus: "evaluated" | "not_configured" | "unavailable";
  overallResult: "pass" | "fail" | "indeterminate" | null;
  policyRef?: { policyId?: string; version?: number; digest?: string };
  asOf: string;
  simulationDigest?: string;
  issueKeys: string[];
  recordedAt: string;
}

/**
 * M29 §3.1: the complete append-only historical authority for advisory
 * observations -- canonical state keeps only a current/latest-N mirror.
 * Deterministic `observationId` (see checkpoint-advisory-identity.ts) makes
 * repeated append attempts for the same logical observation idempotent at
 * the caller level; this builder itself performs no dedup.
 */
export function buildEvidenceGateAdvisoryObservationRecordedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: EvidenceGateAdvisoryObservationRecordedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.advisory_observation_recorded",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Advisory observation for checkpoint ${input.data.checkpointId}: ${input.data.evaluationStatus}${input.data.overallResult ? ` (${input.data.overallResult})` : ""}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface EvidenceGateAdvisoryFeedbackRecordedEventData {
  issueKey: string;
  classification: "confirmed" | "false_positive" | "policy_gap" | "evidence_missing";
  recordedAt: string;
  updatedAt: string;
}

/**
 * M29 §5.1: records a human's bounded, non-semantic classification of an
 * advisory issue. Never touches issue lifecycle, severity, readiness,
 * checkpoint state, or enforcement -- rationale text is stored in state
 * (bounded, capped) but never included in this event's payload.
 */
export function buildEvidenceGateAdvisoryFeedbackRecordedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: EvidenceGateAdvisoryFeedbackRecordedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.advisory_feedback_recorded",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Advisory feedback recorded for ${input.data.issueKey}: ${input.data.classification}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

/** Build the warning Issue for malformed runlog lines, or null if healthy. */
export interface EnforcementProfileImportedEventData {
  profileId: string;
  version: number;
  profileDigest: string;
}

/** M30 §11: profile import is append-only, never activates enforcement. */
export function buildEnforcementProfileImportedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: EnforcementProfileImportedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.enforcement_profile_imported",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Imported enforcement profile ${input.data.profileId} v${input.data.version}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface RecoveryProofImportedEventData {
  proofId: string;
  gate: string;
  ruleId: string;
  recoveryKind: string;
  proofDigest: string;
}

export function buildRecoveryProofImportedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: RecoveryProofImportedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.recovery_proof_imported",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Imported recovery proof ${input.data.proofId} for rule ${input.data.ruleId} (${input.data.gate})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ActivationPlanPreparedEventData {
  planId: string;
  profileId: string;
  profileVersion: number;
  projectActivationResidualRisk: number;
  blockerCount: number;
}

export function buildActivationPlanPreparedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ActivationPlanPreparedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.activation_plan_prepared",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Prepared activation plan ${input.data.planId} (risk ${input.data.projectActivationResidualRisk})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface RequiredModeActivatedEventData {
  activationId: string;
  planId: string;
  profileId: string;
  profileVersion: number;
  activatedBy: string;
}

/** M30 §5.3: activation is explicit, human-authored, and audited -- never silent. */
export function buildRequiredModeActivatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: RequiredModeActivatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.required_mode_activated",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Activated required mode ${input.data.activationId} (profile ${input.data.profileId} v${input.data.profileVersion})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface RequiredModeDeactivatedEventData {
  activationId: string;
  deactivatedBy: string;
}

export function buildRequiredModeDeactivatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: RequiredModeDeactivatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.required_mode_deactivated",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Deactivated required mode ${input.data.activationId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface RequiredDecisionRecordedEventData {
  decisionId: string;
  activationId: string;
  gate: string;
  outcome: string;
  deficiency: string;
  targetRefs: string[];
}

/** M30 §7.4: appended for every persisted checkpoint/amendment required-evidence decision. */
export function buildRequiredDecisionRecordedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: RequiredDecisionRecordedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.required_decision_recorded",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Required decision ${input.data.decisionId}: ${input.data.outcome} (${input.data.deficiency})`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExceptionCreatedEventData {
  exceptionId: string;
  activationId: string;
  gate: string;
  ruleIds: string[];
  authorizedBy: string;
  expiresAt: string;
}

export function buildExceptionCreatedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExceptionCreatedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.exception_created",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Created scoped exception ${input.data.exceptionId} for gate ${input.data.gate}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExceptionConsumedEventData {
  exceptionId: string;
  decisionId: string;
}

export function buildExceptionConsumedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExceptionConsumedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.exception_consumed",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Consumed scoped exception ${input.data.exceptionId} via decision ${input.data.decisionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface ExceptionRevokedEventData {
  exceptionId: string;
  revokedBy: string;
}

export function buildExceptionRevokedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: ExceptionRevokedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "evidence_gate.exception_revoked",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Revoked scoped exception ${input.data.exceptionId}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface DefectCandidateDiscoveredEventData {
  defectId: string;
  sourceKind: string;
  fingerprint: string;
  outcome: "created" | "enriched";
}

export function buildDefectCandidateDiscoveredEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: DefectCandidateDiscoveredEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "defect.candidate_discovered",
    timestamp: input.timestamp,
    actor: "cli",
    summary:
      input.data.outcome === "created"
        ? `Discovered defect candidate ${input.data.defectId} from ${input.data.sourceKind}`
        : `Linked new evidence to existing defect ${input.data.defectId} from ${input.data.sourceKind}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface DefectStatusChangedEventData {
  defectId: string;
  fromStatus: string;
  toStatus: string;
  reason?: string;
}

export function buildDefectStatusChangedEvent(input: {
  id: string;
  timestamp: string;
  relatedIds: string[];
  data: DefectStatusChangedEventData;
}): RunlogEvent {
  return {
    id: input.id,
    type: "defect.status_changed",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Defect ${input.data.defectId}: ${input.data.fromStatus} -> ${input.data.toStatus}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

// ---------------------------------------------------------------------------
// M45: maintenance schedule/occurrence events (build spec Sec 14).
// ---------------------------------------------------------------------------

export interface MaintenanceScheduleMutatedEventData {
  scheduleId: string;
  taskKind: string;
  [key: string]: unknown;
}

function buildMaintenanceScheduleEvent(
  type: "maintenance.schedule_created" | "maintenance.schedule_updated" | "maintenance.schedule_enabled" | "maintenance.schedule_disabled" | "maintenance.schedule_removed",
  summaryVerb: string,
  input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceScheduleMutatedEventData },
): RunlogEvent {
  return {
    id: input.id,
    type,
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Schedule ${input.data.scheduleId} (${input.data.taskKind}) ${summaryVerb}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export function buildMaintenanceScheduleCreatedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceScheduleMutatedEventData }): RunlogEvent {
  return buildMaintenanceScheduleEvent("maintenance.schedule_created", "created", input);
}
export function buildMaintenanceScheduleUpdatedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceScheduleMutatedEventData }): RunlogEvent {
  return buildMaintenanceScheduleEvent("maintenance.schedule_updated", "updated", input);
}
export function buildMaintenanceScheduleEnabledEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceScheduleMutatedEventData }): RunlogEvent {
  return buildMaintenanceScheduleEvent("maintenance.schedule_enabled", "enabled", input);
}
export function buildMaintenanceScheduleDisabledEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceScheduleMutatedEventData }): RunlogEvent {
  return buildMaintenanceScheduleEvent("maintenance.schedule_disabled", "disabled", input);
}
export function buildMaintenanceScheduleRemovedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceScheduleMutatedEventData }): RunlogEvent {
  return buildMaintenanceScheduleEvent("maintenance.schedule_removed", "removed", input);
}

export interface MaintenanceRunStartedEventData {
  occurrenceId: string;
  scheduleId: string;
  taskKind: string;
  dueAt: string;
  missedOccurrenceCount: number;
}

export function buildMaintenanceRunStartedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceRunStartedEventData }): RunlogEvent {
  return {
    id: input.id,
    type: "maintenance.run_started",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Started occurrence ${input.data.occurrenceId} for schedule ${input.data.scheduleId} (${input.data.taskKind})${input.data.missedOccurrenceCount > 0 ? `, ${input.data.missedOccurrenceCount} missed occurrence(s) skipped` : ""}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface MaintenanceRunFinishedEventData {
  occurrenceId: string;
  scheduleId: string;
  taskKind: string;
  resultStatus: string;
  nextDueAt: string;
  [key: string]: unknown;
}

function buildMaintenanceRunFinishedEvent(
  type: "maintenance.run_completed" | "maintenance.run_failed" | "maintenance.run_cancelled",
  input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceRunFinishedEventData },
): RunlogEvent {
  return {
    id: input.id,
    type,
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Occurrence ${input.data.occurrenceId} for schedule ${input.data.scheduleId} (${input.data.taskKind}) finished: ${input.data.resultStatus}; next due ${input.data.nextDueAt}`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export function buildMaintenanceRunCompletedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceRunFinishedEventData }): RunlogEvent {
  return buildMaintenanceRunFinishedEvent("maintenance.run_completed", input);
}
export function buildMaintenanceRunFailedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceRunFinishedEventData }): RunlogEvent {
  return buildMaintenanceRunFinishedEvent("maintenance.run_failed", input);
}
export function buildMaintenanceRunCancelledEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: MaintenanceRunFinishedEventData }): RunlogEvent {
  return buildMaintenanceRunFinishedEvent("maintenance.run_cancelled", input);
}

/**
 * M48-WU05 (build spec Sec 4/14): Night Audit session history. Completed-
 * session history lives here, never re-persisted verbatim into canonical
 * StateModel (mirrors the maintenance-occurrence precedent above) --
 * `aiqt review night status` reads the most recent `night_audit.session_*`
 * event when no session is currently active.
 */
export interface NightAuditSessionStartedEventData {
  sessionId: string;
  repositoryRoot: string;
  budget: Record<string, unknown>;
}

export function buildNightAuditSessionStartedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditSessionStartedEventData }): RunlogEvent {
  return {
    id: input.id,
    type: "night_audit.session_started",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Started Night Audit session ${input.data.sessionId} for ${input.data.repositoryRoot}.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface NightAuditSessionFinishedEventData {
  sessionId: string;
  stopReason: string;
  result: Record<string, unknown>;
}

function buildNightAuditSessionFinishedEvent(
  type: "night_audit.session_completed" | "night_audit.session_interrupted" | "night_audit.session_cancelled",
  input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditSessionFinishedEventData },
): RunlogEvent {
  return {
    id: input.id,
    type,
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Night Audit session ${input.data.sessionId} finished: ${input.data.stopReason}.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export function buildNightAuditSessionCompletedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditSessionFinishedEventData }): RunlogEvent {
  return buildNightAuditSessionFinishedEvent("night_audit.session_completed", input);
}
export function buildNightAuditSessionInterruptedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditSessionFinishedEventData }): RunlogEvent {
  return buildNightAuditSessionFinishedEvent("night_audit.session_interrupted", input);
}
export function buildNightAuditSessionCancelledEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditSessionFinishedEventData }): RunlogEvent {
  return buildNightAuditSessionFinishedEvent("night_audit.session_cancelled", input);
}

export interface NightAuditFindingEventData {
  sessionId: string;
  taskId: string;
  findingKey: string;
  domain: string;
  [key: string]: unknown;
}

export function buildNightAuditFindingAcceptedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditFindingEventData }): RunlogEvent {
  return {
    id: input.id,
    type: "night_audit.finding_accepted",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Finding ${input.data.findingKey} (${input.data.domain}) accepted by the quality gate for task ${input.data.taskId}.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export function buildNightAuditFindingRejectedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditFindingEventData }): RunlogEvent {
  return {
    id: input.id,
    type: "night_audit.finding_rejected",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Finding (${input.data.domain}) rejected by the quality gate for task ${input.data.taskId}.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

export interface NightAuditIssuePublishedEventData {
  sessionId: string;
  defectId: string;
  findingKey: string;
  outcome: string;
  issueNumber?: number;
  issueUrl?: string;
}

export function buildNightAuditIssuePublishedEvent(input: { id: string; timestamp: string; relatedIds: string[]; data: NightAuditIssuePublishedEventData }): RunlogEvent {
  return {
    id: input.id,
    type: "night_audit.issue_publication",
    timestamp: input.timestamp,
    actor: "cli",
    summary: `Issue publication for defect ${input.data.defectId} (finding ${input.data.findingKey}): ${input.data.outcome}${input.data.issueNumber ? ` (#${input.data.issueNumber})` : ""}.`,
    relatedIds: input.relatedIds,
    data: { ...input.data },
  };
}

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
