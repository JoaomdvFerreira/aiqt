import { ExitCode } from "./exit-codes.js";
import type { Issue } from "./issue.js";

/**
 * An error that carries an AIQT exit code and an optional structured Issue.
 * Command handlers translate these into CommandResult failures.
 */
export class AiqtError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = ExitCode.InvalidInput,
    public readonly issue?: Issue,
  ) {
    super(message);
    this.name = "AiqtError";
  }
}
