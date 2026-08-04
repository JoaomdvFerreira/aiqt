import type {
  AutonomousCandidate,
  AutonomousBudgets,
  AutonomousBudgetUsage,
  AutonomousExecutionPolicy,
  AutonomousWorkspaceRecord,
} from "../schema/autonomous-run.schema.js";
import { checkBudget } from "../workflow/autonomous-run-budget.js";
import { deriveAutonomousRunBranchName } from "../workflow/autonomous-run-branch-policy.js";
import { createAutonomousWorktree, removeAutonomousWorktree } from "../workspaces/autonomous-worktree-lifecycle.js";
import { runAutonomousCommand } from "../workspaces/autonomous-command-runner.js";
import type { AgentAdapter } from "../workflow/autonomous-run-agent-adapter.js";

/**
 * M36-WU03: the real execution orchestration loop (build spec Sec 7
 * WU36-03 Scope: "worktree creation; branch naming; bounded agent
 * adapter; command-policy enforcement; wall-clock and command budgets;
 * cancellation; cleanup; no merge"). This is the one place in the M36
 * codebase so far that ties worktree creation, command execution, and
 * budget enforcement together into a single bounded run.
 *
 * Invariants this function enforces directly:
 * - the source repository's default branch is never touched -- the
 *   worktree is always created on a brand-new `autonomous/` branch
 *   (deriveAutonomousRunBranchName), and no code path in this file (or
 *   anything it calls) ever checks out, resets, or commits directly
 *   against `sourceRepositoryPath`;
 * - cleanup is attempted exactly once, unconditionally, whether the run
 *   completed, was denied, hit a budget, or was cancelled (build spec:
 *   "Budget exhaustion must stop the run and preserve evidence" --
 *   evidence here is preserved by returning a full result, not by
 *   skipping cleanup);
 * - no merge: there is no function in this file, or anywhere in this
 *   Work Unit, that merges a branch.
 */
export interface ExecuteAutonomousRunParams {
  candidate: AutonomousCandidate;
  runId: string;
  sourceRepositoryPath: string;
  baseCommit: string;
  workspaceRoot: string;
  policy: AutonomousExecutionPolicy;
  budgets: AutonomousBudgets;
  agentAdapter: AgentAdapter;
  cancellationSignal?: AbortSignal;
}

export type ExecuteAutonomousRunOutcome = "completed" | "cancelled" | "budget_exhausted" | "denied" | "workspace_failed";

export interface ExecuteAutonomousRunResult {
  outcome: ExecuteAutonomousRunOutcome;
  workspace: AutonomousWorkspaceRecord | null;
  commandsExecuted: string[];
  denialReason: string | null;
  budgetUsage: AutonomousBudgetUsage;
}

function emptyUsage(): AutonomousBudgetUsage {
  return { wallClockSeconds: 0, commandCount: 0, retryCount: 0, changedFiles: 0, diffLines: 0, validationSeconds: 0 };
}

export function executeAutonomousRun(params: ExecuteAutonomousRunParams): ExecuteAutonomousRunResult {
  const { candidate, runId, sourceRepositoryPath, baseCommit, workspaceRoot, policy, budgets, agentAdapter, cancellationSignal } = params;
  const startedAt = Date.now();
  const usage = emptyUsage();
  const commandsExecuted: string[] = [];

  const branchName = deriveAutonomousRunBranchName(candidate.issueId, runId);
  const worktreeResult = createAutonomousWorktree({
    sourceRepositoryPath,
    baseCommit,
    branchName,
    workspaceRoot,
    workspaceId: runId,
  });

  if (!worktreeResult.ok) {
    return {
      outcome: "workspace_failed",
      workspace: null,
      commandsExecuted: [],
      denialReason: worktreeResult.reason,
      budgetUsage: usage,
    };
  }

  const worktreePath = worktreeResult.worktreePath;
  let outcome: ExecuteAutonomousRunOutcome = "completed";
  let denialReason: string | null = null;

  const { commands } = agentAdapter.proposeCommands(candidate);

  for (const command of commands) {
    if (cancellationSignal?.aborted) {
      outcome = "cancelled";
      denialReason = "Cancelled by cancellationSignal before the next command ran.";
      break;
    }

    // Check the budget against the usage this command WOULD produce if it
    // runs (commandCount + 1, current wall-clock), not the usage as of
    // the end of the previous command -- checking the pre-command usage
    // against an inclusive-ceiling budget (checkBudget's own semantics:
    // "a value exactly at the limit is not exceeded") would let exactly
    // one extra command past the limit before the check ever caught up.
    const prospectiveUsage = { ...usage, commandCount: usage.commandCount + 1, wallClockSeconds: (Date.now() - startedAt) / 1000 };
    const budgetCheck = checkBudget(budgets, prospectiveUsage);
    if (budgetCheck.exhausted) {
      outcome = "budget_exhausted";
      denialReason = `Budget would be exhausted by running the next command: ${budgetCheck.exceededDimensions.join(", ")}.`;
      break;
    }

    const result = runAutonomousCommand(command, worktreePath, policy);

    if (result.status === "denied" || result.status === "out_of_boundary") {
      outcome = "denied";
      denialReason = result.reason;
      break;
    }
    if (result.status === "spawn_error") {
      outcome = "denied";
      denialReason = `Command failed to spawn: ${result.reason}`;
      break;
    }
    // result.status === "executed": a non-zero exit code is a legitimate
    // outcome for the command itself (e.g. a failing test run) -- it does
    // not by itself stop this loop or mark the run "denied." A future
    // Work Unit's validation step (WU36-04) is where a failing exit code
    // becomes a run-level validation_failed result. Only a command that
    // actually reached execFileSync (status: "executed") is recorded as
    // executed -- a denied/out-of-boundary/spawn-error command never
    // ran, and must never appear in commandsExecuted.
    usage.commandCount += 1;
    usage.wallClockSeconds = (Date.now() - startedAt) / 1000;
    commandsExecuted.push(`${command.command} ${command.args.join(" ")}`.trim());
  }

  usage.wallClockSeconds = (Date.now() - startedAt) / 1000;

  const removeResult = removeAutonomousWorktree(sourceRepositoryPath, worktreePath);

  const workspace: AutonomousWorkspaceRecord = {
    sourceRepository: sourceRepositoryPath,
    baseRef: candidate.baseRef,
    baseCommit,
    branch: branchName,
    worktreePath,
    createdFiles: [],
    cleanupStatus: removeResult.ok ? "cleaned" : "cleanup_failed",
  };

  return { outcome, workspace, commandsExecuted, denialReason, budgetUsage: usage };
}
