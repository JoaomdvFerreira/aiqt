import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";
import { appendRunlogEvent } from "./runlog-store.js";

export interface CanonicalWrite {
  label: string;
  write: () => void;
}

export interface CoordinatedMutationInput {
  operation: string;
  writes: CanonicalWrite[];
  runlogFile: string;
  runlogEvents: RunlogEvent[];
  recoveryHint: string;
}

export function persistCoordinatedMutation(input: CoordinatedMutationInput): void {
  for (const write of input.writes) {
    write.write();
  }

  try {
    for (const event of input.runlogEvents) {
      appendRunlogEvent(input.runlogFile, event);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const message =
      `Canonical state was written for ${input.operation}, but the runlog append failed. ` +
      `${input.recoveryHint} Original error: ${detail}`;
    throw new AiqtError(message, ExitCode.InvalidInput, {
      id: "CANONICAL-RUNLOG-GAP",
      severity: "critical",
      area: "runlog",
      message,
      suggestedAction: input.recoveryHint,
      agentCanFix: false,
    });
  }
}
