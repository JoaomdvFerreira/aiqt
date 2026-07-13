import type { CommandContext } from "../command-context.js";
import type { CommandResult } from "../../core/output/result.js";
import { runGuidanceCommand } from "../../services/guidance-service.js";

/** aiqt start: read-only guided navigation, friendlier framing for a new project. */
export function runStart(ctx: CommandContext): CommandResult {
  return runGuidanceCommand(ctx, "start");
}
