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
