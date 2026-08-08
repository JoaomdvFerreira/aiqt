import { familyFailureResult, type CommandResult } from "../../core/output/result.js";

/**
 * M45-WU02: shared helpers for every `aiqt maintenance *` command, mirroring
 * release-shared.ts / the M42 defects family's local `failure()` pattern.
 */
export function maintenanceFailure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "maintenance", area: "maintenance", summary, exitCode, issueId });
}
