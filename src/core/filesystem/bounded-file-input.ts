import { statSync, readFileSync } from "node:fs";

export type BoundedFileReadResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * M27 §4.2: requires an existing regular file (statSync follows symlinks,
 * so a symlink is allowed only when its resolved target is itself a
 * regular file); enforces the byte cap via `stats.size` BEFORE reading, so
 * an oversized file is never fully buffered. Mirrors
 * evidence/external-evidence-file-input.ts's readExternalEvidenceFile, but
 * parameterized on maxBytes since M27's stream-json transport uses a much
 * larger bound than M23/M26's single-JSON-document limit.
 */
export function readBoundedTextFile(path: string, maxBytes: number): BoundedFileReadResult {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return { ok: false, error: `File not found or unreadable: ${path}` };
  }
  if (!stats.isFile()) {
    return { ok: false, error: `Not a regular file: ${path}` };
  }
  if (stats.size > maxBytes) {
    return { ok: false, error: `File exceeds max_total_bytes (${maxBytes}): ${path}` };
  }
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (err) {
    return { ok: false, error: `Unable to read file: ${path} (${(err as Error).message})` };
  }
}
