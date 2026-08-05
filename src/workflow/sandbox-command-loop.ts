import type { AutonomousExecutionPolicy } from "../schema/autonomous-run.schema.js";
import type { SandboxResourcePolicy, SandboxTerminationReason } from "../schema/sandbox-backend.schema.js";
import type { SandboxHandle, SandboxProcessLaunchRequest, SandboxProcessLaunchResult, SandboxCancellationResult } from "./sandbox-backend-contract.js";
import { decideCommand } from "./autonomous-run-command-policy.js";

/**
 * M38-WU03 (build spec: "Run one agent inside the sandbox with
 * structured events, policy-mediated commands, full process-tree
 * ownership, deterministic cancellation, and output/budget limits";
 * Sec 6 "Command mediation": "Every requested command must be
 * classified, approved or rejected, executed inside the sandbox,
 * bounded, and recorded"). This is the "live agent process" step in
 * the M38 pipeline (build spec Sec 2) -- but per Sec 1.1's carried-
 * forward M37 invariant ("no live agent process owned by AIQT" /
 * "manual external-agent execution" must be preserved), this is NOT a
 * new coding-model invocation. It is the sandboxed equivalent of
 * M36/M37's own `runAutonomousCommandLoop` (`autonomous-run-execution-
 * service.ts`): a caller (WU38-04's CLI integration, or M37's own
 * imported agent response) supplies an already-decided command list --
 * this function mediates each one through the SAME M36 command-policy
 * classifier (`decideCommand`, reused unmodified) before ever running
 * it, this time inside a real sandbox instead of a bare worktree.
 *
 * Depends on a minimal structural interface, not the concrete
 * `DockerSandboxBackend` class, so a lightweight, fully in-memory test
 * double can exercise this file's own mediation/budget logic without
 * a real Docker daemon (`SandboxExecutionBackend` below).
 */
export interface ProposedSandboxCommand {
  command: string;
  args: string[];
}

/** The minimal backend surface this loop needs -- `DockerSandboxBackend` (WU38-02/03) satisfies this structurally, as does any test double. */
export interface SandboxExecutionBackend {
  launchProcess(request: SandboxProcessLaunchRequest): SandboxProcessLaunchResult;
  cancel(handle: SandboxHandle): SandboxCancellationResult;
  checkDiskUsageBytes(handle: SandboxHandle): number | null;
}

export interface SandboxCommandLoopResult {
  terminationReason: SandboxTerminationReason;
  commandsExecuted: string[];
  denialReason: string | null;
}

/**
 * Mediates and executes `proposedCommands` in order, stopping at the
 * first denial, budget breach, or execution failure -- mirrors
 * `runAutonomousCommandLoop`'s own "check the budget the command WOULD
 * produce, not the usage as of the previous command" inclusive-ceiling
 * discipline (a value exactly at the limit is not exceeded).
 * `cancellationSignal` is checked before every command, matching the
 * same pattern; a cancelled loop calls `backend.cancel(handle)` itself
 * so the caller never needs to remember to.
 */
export function executeSandboxedCommandLoop(
  backend: SandboxExecutionBackend,
  handle: SandboxHandle,
  proposedCommands: readonly ProposedSandboxCommand[],
  executionPolicy: AutonomousExecutionPolicy,
  resourcePolicy: SandboxResourcePolicy,
  cancellationSignal?: AbortSignal,
): SandboxCommandLoopResult {
  const startedAt = Date.now();
  const commandsExecuted: string[] = [];

  for (const proposed of proposedCommands) {
    if (cancellationSignal?.aborted) {
      backend.cancel(handle);
      return { terminationReason: "cancelled", commandsExecuted, denialReason: "Cancelled before the next command ran." };
    }

    const prospectiveCommandCount = commandsExecuted.length + 1;
    if (prospectiveCommandCount > resourcePolicy.maxCommandCount) {
      return { terminationReason: "budget_exhausted", commandsExecuted, denialReason: `Command count budget (${resourcePolicy.maxCommandCount}) would be exceeded by running the next command.` };
    }
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds > resourcePolicy.maxWallClockSeconds) {
      return { terminationReason: "budget_exhausted", commandsExecuted, denialReason: `Wall-clock budget (${resourcePolicy.maxWallClockSeconds}s) exceeded before the next command could run.` };
    }

    const commandLine = `${proposed.command} ${proposed.args.join(" ")}`.trim();
    const decision = decideCommand(commandLine, executionPolicy);
    if (!decision.allowed) {
      return { terminationReason: "policy_denied", commandsExecuted, denialReason: decision.reason };
    }

    const result = backend.launchProcess({ handle, command: proposed.command, args: proposed.args });
    if (!result.ok) {
      return { terminationReason: "policy_denied", commandsExecuted, denialReason: result.reason };
    }
    commandsExecuted.push(commandLine);

    const diskUsage = backend.checkDiskUsageBytes(handle);
    if (diskUsage !== null && diskUsage > resourcePolicy.maxDiskWriteBytes) {
      return { terminationReason: "resource_limit_exceeded", commandsExecuted, denialReason: `Disk usage (${diskUsage} bytes) exceeded the maxDiskWriteBytes budget (${resourcePolicy.maxDiskWriteBytes}).` };
    }
  }

  return { terminationReason: "completed", commandsExecuted, denialReason: null };
}
