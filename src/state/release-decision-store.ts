import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isFile } from "../core/filesystem/file-exists.js";
import { readJsonFile } from "../core/filesystem/file-store.js";
import { writeJsonFile, writeTextFile } from "../core/filesystem/safe-writer.js";
import { ReleaseDecisionSchema, type ReleaseDecision } from "../schema/release-governance.schema.js";
import { renderReleaseNotesMarkdown, type ReadyReleaseDecision } from "../workflow/release-notes.js";

/**
 * M40-WU03 (build spec Sec 10.1 "prepare": "produce bounded local release
 * evidence/artifacts without remote publication"). Deliberately NOT part
 * of the canonical `.aiqt/` project state (state.schema.ts) -- release
 * governance is a separate, additive local concern that must never require
 * an AIQT_SCHEMA_VERSION change. Lives under `.aiqt-release/` in the
 * target repository by default.
 */

export const DEFAULT_RELEASE_EVIDENCE_DIRNAME = ".aiqt-release";

export function resolveReleaseEvidenceDir(cwd: string, override?: string): string {
  return override ?? join(cwd, DEFAULT_RELEASE_EVIDENCE_DIRNAME);
}

/** Filesystem-safe id: candidateId contains "@" and "/" (repo/tag/commit shape). */
function sanitizeCandidateId(candidateId: string): string {
  return candidateId.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function decisionJsonPath(dir: string, candidateId: string): string {
  return join(dir, `${sanitizeCandidateId(candidateId)}.json`);
}

function notesPath(dir: string, candidateId: string): string {
  return join(dir, `${sanitizeCandidateId(candidateId)}.notes.md`);
}

export interface SavedReleaseArtifacts {
  decisionPath: string;
  notesPath: string | null;
}

/** Writes the decision JSON, and the rendered notes when risk/approval are both present (always true for assessReleaseDecision output). Bounded, local-only, no network. */
export function saveReleaseDecision(dir: string, decision: ReleaseDecision): SavedReleaseArtifacts {
  mkdirSync(dir, { recursive: true });
  const jsonPath = decisionJsonPath(dir, decision.candidate.candidateId);
  writeJsonFile(jsonPath, decision);

  if (decision.risk === null || decision.approval === null) {
    return { decisionPath: jsonPath, notesPath: null };
  }
  const ready: ReadyReleaseDecision = { ...decision, risk: decision.risk, approval: decision.approval };
  const mdPath = notesPath(dir, decision.candidate.candidateId);
  writeTextFile(mdPath, renderReleaseNotesMarkdown(ready));
  return { decisionPath: jsonPath, notesPath: mdPath };
}

export type LoadReleaseDecisionResult = { ok: true; decision: ReleaseDecision } | { ok: false; reason: string };

export function loadReleaseDecision(dir: string, candidateId: string): LoadReleaseDecisionResult {
  const path = decisionJsonPath(dir, candidateId);
  if (!isFile(path)) {
    return { ok: false, reason: `No prepared release decision found for candidate "${candidateId}" in ${dir}.` };
  }
  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    return { ok: false, reason: `Unable to read prepared release decision: ${(err as Error).message}` };
  }
  const parsed = ReleaseDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `Prepared release decision at ${path} failed schema validation.` };
  }
  return { ok: true, decision: parsed.data };
}

export function listReleaseCandidateIds(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => e.endsWith(".json") && !e.endsWith(".notes.md")).map((e) => e.slice(0, -".json".length)).sort();
}
