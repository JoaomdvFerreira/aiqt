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
