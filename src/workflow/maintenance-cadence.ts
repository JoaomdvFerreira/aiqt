import { MAINTENANCE_CADENCE_MAX_SECONDS, MAINTENANCE_CADENCE_MIN_SECONDS } from "../schema/maintenance-schedule.schema.js";

/**
 * M45-WU02 (build spec Sec 7.3): normalizes a concise operator-facing
 * cadence string ("1h"/"6h"/"1d"/"7d") into the one canonical
 * `cadenceSeconds` representation the schema stores. Deliberately narrow --
 * only whole-hour ("h") and whole-day ("d") suffixes are accepted, which
 * structurally excludes both seconds-level high-frequency execution by
 * default and arbitrary cron-grammar complexity (no minutes, no cron
 * expressions).
 */

const CADENCE_PATTERN = /^(\d+)(h|d)$/;

export type ParseCadenceResult = { ok: true; cadenceSeconds: number } | { ok: false; reason: string };

export function parseCadenceInput(input: string): ParseCadenceResult {
  const trimmed = input.trim();
  const match = CADENCE_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false, reason: `Cadence "${input}" is not a valid duration. Use a whole number followed by "h" (hours) or "d" (days), e.g. "1h", "6h", "1d", "7d".` };
  }
  const value = Number.parseInt(match[1], 10);
  const unit = match[2];
  const cadenceSeconds = unit === "h" ? value * 3600 : value * 86400;

  if (cadenceSeconds < MAINTENANCE_CADENCE_MIN_SECONDS) {
    return { ok: false, reason: `Cadence "${input}" is below the minimum of ${MAINTENANCE_CADENCE_MIN_SECONDS / 3600}h.` };
  }
  if (cadenceSeconds > MAINTENANCE_CADENCE_MAX_SECONDS) {
    return { ok: false, reason: `Cadence "${input}" exceeds the maximum of ${MAINTENANCE_CADENCE_MAX_SECONDS / 86400}d.` };
  }
  return { ok: true, cadenceSeconds };
}

/** Renders a stored cadenceSeconds back into the most natural "Nh"/"Nd" form for human display. */
export function formatCadenceSeconds(cadenceSeconds: number): string {
  if (cadenceSeconds % 86400 === 0) return `${cadenceSeconds / 86400}d`;
  return `${cadenceSeconds / 3600}h`;
}
