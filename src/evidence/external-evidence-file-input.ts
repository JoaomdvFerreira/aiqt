import { statSync, readFileSync } from "node:fs";
import { EXTERNAL_INPUT_MAX_PAYLOAD_BYTES } from "../schema/external-evidence/limits.js";

export type ExternalEvidenceFileReadResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * M23 §8 (input safety, file input): requires an existing regular file
 * (directories/devices/sockets/pipes are rejected by `stats.isFile()`);
 * `statSync` follows symlinks, so a symlink is allowed only when its
 * resolved target is itself a regular file. Enforces the byte cap via
 * `stats.size` BEFORE reading the file content, so an oversized file is
 * never fully buffered. Never persists the given path anywhere -- the
 * caller must not store or copy it into `.aiqt/`.
 */
export function readExternalEvidenceFile(path: string): ExternalEvidenceFileReadResult {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return { ok: false, error: `File not found or unreadable: ${path}` };
  }
  if (!stats.isFile()) {
    return { ok: false, error: `Not a regular file: ${path}` };
  }
  if (stats.size > EXTERNAL_INPUT_MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      error: `File exceeds max_payload_bytes (${EXTERNAL_INPUT_MAX_PAYLOAD_BYTES}): ${path}`,
    };
  }
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (err) {
    return { ok: false, error: `Unable to read file: ${path} (${(err as Error).message})` };
  }
}
