import { familyFailureResult, type CommandResult } from "../../core/output/result.js";

/** M46-WU02: shared helpers for every `aiqt portfolio *` command. */
export function portfolioFailure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "portfolio", area: "portfolio", summary, exitCode, issueId });
}
