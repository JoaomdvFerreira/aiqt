import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AutonomousRunRecordSchema, type AutonomousRunRecord } from "../schema/autonomous-run-record.schema.js";

/**
 * M37-WU01: the persistence layer for CLI-visible autonomous runs -- one
 * JSON file per run, under the operator-resolved evidenceOutputDir,
 * never under this repository's own `.aiqt/` and never requiring an AIQT
 * project to exist. This is a deliberately new, standalone mechanism
 * (not AIQT's canonical state.json/runlog.jsonl) since an autonomous
 * run's target repository is not, and must never be required to be, an
 * AIQT-tracked project.
 */
const RUN_ID_PATTERN = /^run-\d+-[0-9a-f]{8}$/;

/** The only shape generateAutonomousRunId() ever produces -- also the only shape load/delete accept, so a user-supplied `--run` value can never be used to construct a path outside evidenceOutputDir. */
export function isValidAutonomousRunId(id: string): boolean {
  return RUN_ID_PATTERN.test(id);
}

export function generateAutonomousRunId(): string {
  return `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function runFilePath(evidenceDir: string, runId: string): string {
  return join(evidenceDir, `${runId}.json`);
}

export function saveAutonomousRunRecord(record: AutonomousRunRecord, evidenceDir: string): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(runFilePath(evidenceDir, record.runId), JSON.stringify(record, null, 2) + "\n", "utf8");
}

export type LoadAutonomousRunRecordResult = { ok: true; record: AutonomousRunRecord } | { ok: false; reason: string };

export function loadAutonomousRunRecord(runId: string, evidenceDir: string): LoadAutonomousRunRecordResult {
  if (!isValidAutonomousRunId(runId)) {
    return { ok: false, reason: `"${runId}" is not a valid autonomous run id.` };
  }
  const path = runFilePath(evidenceDir, runId);
  if (!existsSync(path)) {
    return { ok: false, reason: `No run record found for run id "${runId}" in ${evidenceDir}.` };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `Failed to read run record: ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `Run record file is not valid JSON: ${path}` };
  }

  const result = AutonomousRunRecordSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: `Run record failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { ok: true, record: result.data };
}

export function listAutonomousRunIds(evidenceDir: string): string[] {
  if (!existsSync(evidenceDir)) return [];
  return readdirSync(evidenceDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter(isValidAutonomousRunId)
    .sort();
}

/**
 * Deletes ONLY the one run record file for `runId`, strictly within
 * `evidenceDir` -- never a recursive/glob delete, never a path outside
 * this directory (isValidAutonomousRunId's fixed pattern makes path
 * traversal via `runId` structurally impossible before this ever runs).
 * This is the entire "cleanup" surface for WU37-01: no real worktree
 * exists anywhere in this Work Unit's pipeline to also remove.
 */
export function deleteAutonomousRunRecord(runId: string, evidenceDir: string): { ok: true } | { ok: false; reason: string } {
  if (!isValidAutonomousRunId(runId)) {
    return { ok: false, reason: `"${runId}" is not a valid autonomous run id.` };
  }
  const path = runFilePath(evidenceDir, runId);
  if (existsSync(path)) unlinkSync(path);
  return { ok: true };
}
