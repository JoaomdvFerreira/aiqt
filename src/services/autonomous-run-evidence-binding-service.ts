import type {
  AutonomousCandidate,
  AutonomousSafetyAssessment,
  AutonomousBudgets,
  AutonomousExecutionPolicy,
  AutonomousEvidencePacket,
  AutonomousResultState,
  AutonomousRecommendedAction,
  AutonomousDiffSummary,
} from "../schema/autonomous-run.schema.js";
import {
  runAutonomousCommandLoop,
  type ExecuteAutonomousRunParams,
  type ExecuteAutonomousRunOutcome,
} from "./autonomous-run-execution-service.js";
import { removeAutonomousWorktree } from "../workspaces/autonomous-worktree-lifecycle.js";
import { captureAutonomousDiffSummary, listAutonomousChangedFilePaths } from "../workflow/autonomous-run-diff-summary.js";
import { runAutonomousValidation, type AutonomousValidationResult } from "./autonomous-run-validation-service.js";
import { runAutonomousCommand, type AutonomousCommandRequest } from "../workspaces/autonomous-command-runner.js";
import { reviewAutonomousRun } from "../workflow/autonomous-run-self-review.js";

/**
 * M36-WU04 (build spec Sec 7 WU36-04 Scope: "evidence packet assembly";
 * acceptance criteria: "packet follows the M33 machine contract," "no
 * pass without validation," "unexpected changes block the run," "review
 * findings are surfaced," "evidence is bound to commit and diff," "no
 * merge or deployment occurs"). This is the one place that ties WU36-03's
 * bounded execution loop together with WU36-04's diff capture, validation,
 * and self-review into a single AutonomousEvidencePacket (WU36-01 schema).
 *
 * Ordering constraint this file exists to satisfy: WU36-03's
 * `executeAutonomousRun` cleans up the worktree unconditionally before
 * returning, but diff capture and validation both need the worktree to
 * still be on disk -- so this module calls the lower-level
 * `runAutonomousCommandLoop` (cleanup NOT yet performed) directly, runs
 * diff-capture/validation/self-review against the still-present worktree,
 * and only then removes it itself, exactly once, in a `finally` block --
 * preserving WU36-03's "cleanup is attempted exactly once, unconditionally"
 * invariant.
 *
 * No merge: there is no function in this file that merges, pushes, or
 * checks out the `autonomous/` branch back onto the source repository's
 * default branch.
 */
export interface BindAutonomousRunEvidenceParams {
  runId: string;
  candidate: AutonomousCandidate;
  safetyAssessment: AutonomousSafetyAssessment;
  sourceRepositoryPath: string;
  baseCommit: string;
  workspaceRoot: string;
  policy: AutonomousExecutionPolicy;
  budgets: AutonomousBudgets;
  agentAdapter: ExecuteAutonomousRunParams["agentAdapter"];
  targetedValidationCommands: AutonomousCommandRequest[];
  authoritativeValidationCommands: AutonomousCommandRequest[];
  cancellationSignal?: AbortSignal;
}

const NOT_VALIDATED: AutonomousValidationResult = {
  targetedTestsPassed: false,
  authoritativeValidationPassed: null,
  durationSeconds: 0,
  commandsExecuted: [],
  blockedReason: null,
};

function emptyDiffSummary(): AutonomousDiffSummary {
  return { changedFiles: 0, insertedLines: 0, deletedLines: 0, unexpectedFiles: [] };
}

const MAX_COMMIT_MESSAGE_CHARS = 500;

/**
 * M37-WU04 ("commit preparation"). Reuses WU36-03's already-reviewed,
 * policy-checked runAutonomousCommand for two fixed, deterministic
 * commands (`git add -A`, `git commit -m <bounded message>`) --
 * intentionally NOT a new mutating primitive in git-command-runner.ts
 * (M25's own 2-function mutating allowlist stays exactly worktree add/
 * remove); this reuses the exact same command-execution surface an
 * agent's own proposed commands already go through, just with a
 * fixed, AIQT-authored command list instead of an imported one.
 *
 * Purpose: without this, a "completed" outcome whose proposed commands
 * never included their own `git commit` would either (a) leave the
 * worktree dirty, causing `git worktree remove` to fail (the real
 * M36-WU04/WU37-03 defect this milestone already found and fixed once --
 * a run genuinely reporting cleanup_failed is correct behavior for a
 * dirty worktree, but an operator should not need every agent response
 * to remember to commit for cleanup to succeed), or (b) on a
 * (coincidentally) clean tree, leave the branch with no real commit at
 * all once the worktree is removed -- an empty, unreviewable handoff.
 * This step runs regardless of resultState (not only "passed") so a
 * validation_failed/review_rejected run's branch is still reviewable via
 * a patch export.
 *
 * Deliberately NOT counted against the run's own command budget
 * (`checkBudget`) -- this is AIQT's own housekeeping action taken after
 * the agent's bounded command loop has already finished, not a further
 * agent-proposed action.
 *
 * Best-effort: if either command is denied by policy or fails for any
 * reason, this function does nothing further -- cleanup proceeds exactly
 * as it would have without this step (worst case, cleanup_failed on a
 * still-dirty tree, identical to pre-WU37-04 behavior).
 */
function commitAutonomousRunChanges(worktreePath: string, policy: AutonomousExecutionPolicy, candidate: AutonomousCandidate): void {
  const addResult = runAutonomousCommand({ command: "git", args: ["add", "-A"] }, worktreePath, policy);
  if (addResult.status !== "executed" || addResult.exitCode !== 0) return;

  const message = `AIQT autonomous repair for ${candidate.issueId}: ${candidate.objective}`.slice(0, MAX_COMMIT_MESSAGE_CHARS);
  runAutonomousCommand({ command: "git", args: ["commit", "-m", message] }, worktreePath, policy);
}

/**
 * Maps a non-"completed" execution outcome directly to its terminal result
 * state and recommended action -- none of these reach diff capture or
 * validation, since the run itself never finished attempting the repair
 * (build spec: "Budget exhaustion must stop the run and preserve
 * evidence," not spend further budget validating an incomplete attempt).
 */
function resultForIncompleteOutcome(
  outcome: Exclude<ExecuteAutonomousRunOutcome, "completed">,
  denialReason: string | null,
): { resultState: AutonomousResultState; recommendedHumanAction: AutonomousRecommendedAction; residualRisk: string } {
  switch (outcome) {
    case "workspace_failed":
      return {
        resultState: "failed",
        recommendedHumanAction: "provide_missing_input",
        residualRisk: `Workspace could not be prepared: ${denialReason ?? "unknown reason"}. No commands ran; no repository state was touched.`,
      };
    case "cancelled":
      return {
        resultState: "cancelled",
        recommendedHumanAction: "discard",
        residualRisk: `Run was cancelled before completion: ${denialReason ?? "cancellation signal set"}. Evidence is incomplete by design.`,
      };
    case "budget_exhausted":
      return {
        resultState: "budget_exhausted",
        recommendedHumanAction: "rerun_with_modified_budget",
        residualRisk: `Run stopped after exhausting its budget: ${denialReason ?? "unknown dimension"}. Partial evidence only.`,
      };
    case "denied":
      return {
        resultState: "blocked",
        recommendedHumanAction: "discard",
        residualRisk: `A proposed command was denied by execution policy: ${denialReason ?? "unknown reason"}. The candidate as scoped cannot proceed autonomously.`,
      };
  }
}

export function produceAutonomousEvidencePacket(params: BindAutonomousRunEvidenceParams): AutonomousEvidencePacket {
  const {
    runId,
    candidate,
    safetyAssessment,
    sourceRepositoryPath,
    baseCommit,
    workspaceRoot,
    policy,
    budgets,
    agentAdapter,
    targetedValidationCommands,
    authoritativeValidationCommands,
    cancellationSignal,
  } = params;

  const loopResult = runAutonomousCommandLoop({
    candidate,
    runId,
    sourceRepositoryPath,
    baseCommit,
    workspaceRoot,
    policy,
    budgets,
    agentAdapter,
    cancellationSignal,
  });

  // No worktree was ever created -- nothing to clean up, nothing to diff.
  if (!loopResult.worktreePath) {
    const { resultState, recommendedHumanAction, residualRisk } = resultForIncompleteOutcome(
      loopResult.outcome as Exclude<ExecuteAutonomousRunOutcome, "completed">,
      loopResult.denialReason,
    );
    return {
      runId,
      candidate,
      safetyAssessment,
      commandsExecuted: loopResult.commandsExecuted,
      filesChanged: [],
      findings: loopResult.denialReason ? [loopResult.denialReason] : [],
      residualRisk,
      resultState,
      recommendedHumanAction,
    };
  }

  const worktreePath = loopResult.worktreePath;
  let diffSummary: AutonomousDiffSummary = emptyDiffSummary();
  let filesChanged: string[] = [];
  let validation: AutonomousValidationResult = NOT_VALIDATED;
  let findings: string[] = [];
  // M37-WU03 correction: this used to be discarded entirely, with
  // `workspace.cleanupStatus` hardcoded to "cleaned" below regardless of
  // what actually happened -- found while writing WU37-03's own real
  // (non-simulated) execution tests, which exercise a genuinely dirty
  // worktree (an uncommitted `git mv`) that `git worktree remove`
  // legitimately refuses without `--force` (this repository never
  // passes `--force`, by design). The M36-WU05 dogfood pilot's own
  // "successful" scenario used the identical `git mv` shape and was
  // therefore ALSO silently misreporting "cleaned" the entire time --
  // recorded here honestly as a real defect in already-shipped, already-
  // tagged M36 code, not merely a WU37-03 addition.
  let cleanupOk = false;

  try {
    // Diff evidence is captured for every outcome that reached a worktree
    // (build spec: "evidence is bound to commit and diff") -- even a
    // denied/cancelled/budget-exhausted run may have left partial changes
    // on disk, and those changes are exactly what a human reviewer needs
    // to see. Validation, however, only runs for a "completed" outcome --
    // running further commands against an already-stopped run would
    // spend budget the run no longer has authorization to spend.
    diffSummary = captureAutonomousDiffSummary(worktreePath, baseCommit);
    filesChanged = listAutonomousChangedFilePaths(worktreePath, baseCommit);

    if (loopResult.outcome === "completed") {
      validation = runAutonomousValidation({
        worktreePath,
        policy,
        targetedCommands: targetedValidationCommands,
        authoritativeCommands: authoritativeValidationCommands,
        maxValidationSeconds: budgets.maxValidationSeconds,
      });
      const review = reviewAutonomousRun({ diffSummary, validation, budgets });
      findings = review.findings;

      if (diffSummary.changedFiles > 0) {
        commitAutonomousRunChanges(worktreePath, policy, candidate);
      }
    }
  } finally {
    cleanupOk = removeAutonomousWorktree(sourceRepositoryPath, worktreePath).ok;
  }

  const workspace = {
    sourceRepository: sourceRepositoryPath,
    baseRef: candidate.baseRef,
    baseCommit,
    branch: loopResult.branchName!,
    worktreePath,
    createdFiles: [] as string[],
    cleanupStatus: cleanupOk ? ("cleaned" as const) : ("cleanup_failed" as const),
  };

  if (loopResult.outcome !== "completed") {
    const { resultState, recommendedHumanAction, residualRisk } = resultForIncompleteOutcome(loopResult.outcome, loopResult.denialReason);
    return {
      runId,
      candidate,
      safetyAssessment,
      workspace,
      commandsExecuted: loopResult.commandsExecuted,
      filesChanged,
      diffSummary,
      findings: loopResult.denialReason ? [loopResult.denialReason] : [],
      residualRisk,
      resultState,
      recommendedHumanAction,
    };
  }

  // "No pass without validation": targetedTestsPassed can only be true if
  // at least one targeted command ran and every one exited 0
  // (runAutonomousValidation's own contract) -- checked directly here,
  // not merely inferred from the self-review verdict, so this decision
  // does not silently depend on reviewAutonomousRun's internal ordering.
  let resultState: AutonomousResultState;
  let recommendedHumanAction: AutonomousRecommendedAction;
  let residualRisk: string;

  if (!validation.targetedTestsPassed || validation.authoritativeValidationPassed === false || validation.blockedReason) {
    resultState = "validation_failed";
    recommendedHumanAction = "request_changes";
    residualRisk = validation.blockedReason
      ? `Validation was blocked before completing: ${validation.blockedReason}.`
      : "Targeted or authoritative validation did not pass -- the repair attempt is not verified.";
  } else if (findings.length > 0) {
    resultState = "review_rejected";
    recommendedHumanAction = "request_changes";
    residualRisk = `Validation passed, but self-review surfaced ${findings.length} finding(s) outside the declared repair scope.`;
  } else {
    resultState = "passed";
    recommendedHumanAction = "review_and_merge";
    residualRisk = "Validation passed and no self-review findings were raised. A human reviewer must still approve before merge -- this run never merges automatically.";
  }

  return {
    runId,
    candidate,
    safetyAssessment,
    workspace,
    commandsExecuted: loopResult.commandsExecuted,
    filesChanged,
    diffSummary,
    validation: {
      targetedTestsPassed: validation.targetedTestsPassed,
      authoritativeValidationPassed: validation.authoritativeValidationPassed,
      durationSeconds: validation.durationSeconds,
    },
    findings,
    residualRisk,
    resultState,
    recommendedHumanAction,
  };
}
