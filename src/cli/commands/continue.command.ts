import type { CommandContext } from "../command-context.js";
import type { CommandResult } from "../../core/output/result.js";
import { runGuidanceCommand } from "../../services/guidance-service.js";

/** aiqt continue: read-only guided navigation, friendlier framing for a resumed project. */
export function runContinue(ctx: CommandContext): CommandResult {
  return runGuidanceCommand(ctx, "continue");
}
