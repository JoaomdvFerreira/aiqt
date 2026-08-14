import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AutonomousCandidate, AutonomousExecutionPolicy, AutonomousBudgets } from "../schema/autonomous-run.schema.js";
import type { AutonomousAgentProposedCommand } from "../schema/autonomous-agent-request.schema.js";
import type { SandboxEvidence } from "../schema/sandbox-backend.schema.js";
import type { SandboxHandle, SandboxCreateRequest } from "../workflow/sandbox-backend-contract.js";
import { DockerSandboxBackend } from "../workspaces/sandbox-docker-backend.js";
import { evaluateSandboxCapabilities } from "../workflow/sandbox-capability-evaluation.js";
import type { SandboxFallbackRecommendation } from "../workflow/sandbox-fallback-policy.js";
import { deriveAutonomousRunBranchName } from "../workflow/autonomous-run-branch-policy.js";
import { createAutonomousWorktree, removeAutonomousWorktree } from "../workspaces/autonomous-worktree-lifecycle.js";
import { executeSandboxedCommandLoop } from "../workflow/sandbox-command-loop.js";
import { reviewSandboxRun } from "../workflow/sandbox-run-self-review.js";
import type { SandboxRunResultState } from "./sandbox-run-command-result.js";

/**
 * M38-WU04 (build spec: "Integrate opt-in live execution with M37 CLI,
 * capability preflight, validation, self-review, evidence, crash
 * recovery, cleanup, and safe fallback"). Real, mutating orchestration
 * for the `aiqt autonomous agent-import --live` path -- the sandboxed
 * equivalent of M36-WU04's `autonomous-run-evidence-binding-service.ts`
 * (produceAutonomousEvidencePacket), reusing the SAME worktree-creation
 * primitive (`createAutonomousWorktree`, M36) plus the WU38-03 sandbox
 * command loop, instead of M36's bare `runAutonomousCommandLoop`.
 *
 * Split into two phases so the caller (the CLI command) can persist
 * `sandboxContainerId` to the run record BETWEEN them -- the crash-
 * recovery anchor (build spec: "crash recovery"). If AIQT itself dies
 * after `prepareLiveSandbox` succeeds but before `runLiveSandboxedRun`
 * finishes, the container id is already durably recorded, and a later
 * `aiqt autonomous cleanup` invocation can still find and destroy it.
 */
const SANDBOX_WORKTREE_PATH = "/workspace";
const SANDBOX_GIT_IDENTITY_EMAIL = "autonomous@aiqt.local";
const SANDBOX_GIT_IDENTITY_NAME = "AIQT Autonomous Sandbox";

export interface LiveSandboxPreflightFailure {
  ok: false;
  reason: string;
  fallback: SandboxFallbackRecommendation | null;
}

export interface PrepareLiveSandboxParams {
  runId: string;
  repositoryPath: string;
  baseCommit: string;
  issueId: string;
  worktreeRoot: string;
  policy: AutonomousExecutionPolicy;
  budgets: AutonomousBudgets;
}

export interface PrepareLiveSandboxSuccess {
  ok: true;
  backend: DockerSandboxBackend;
  handle: SandboxHandle;
  worktreePath: string;
  branchName: string;
}

/**
 * Capability preflight (checkAvailability + evaluateSandboxCapabilities)
 * always runs first and fails closed to a `SandboxFallbackRecommendation`
 * (never a silent, unsandboxed proceed) -- build spec cross-Work-Unit
 * invariant 2 ("No live execution without capability confirmation").
 * Creates a real worktree (the same M36 primitive every non-live run
 * already uses) and a real sandbox container around it.
 */
export function prepareLiveSandbox(params: PrepareLiveSandboxParams): PrepareLiveSandboxSuccess | LiveSandboxPreflightFailure {
  const backend = new DockerSandboxBackend();
  const availability = backend.checkAvailability();
  if (!availability.available) {
    return { ok: false, reason: `Sandbox backend unavailable: ${availability.reason}`, fallback: null };
  }

  const capabilityCheck = evaluateSandboxCapabilities(backend.reportCapabilities());
  if (!capabilityCheck.sufficient) {
    return { ok: false, reason: `Sandbox capability check failed: missing ${capabilityCheck.missingCapabilities.join(", ")}.`, fallback: capabilityCheck.fallback };
  }

  const branchName = deriveAutonomousRunBranchName(params.issueId, params.runId);
  const worktreeResult = createAutonomousWorktree({
    sourceRepositoryPath: params.repositoryPath,
    baseCommit: params.baseCommit,
    branchName,
    workspaceRoot: params.worktreeRoot,
    workspaceId: params.runId,
  });
  if (!worktreeResult.ok) {
    return { ok: false, reason: `Failed to create isolated worktree: ${worktreeResult.reason}`, fallback: null };
  }

  const outputDir = join(params.worktreeRoot, "sandbox-output", params.runId);
  mkdirSync(outputDir, { recursive: true });

  const createRequest: SandboxCreateRequest = {
    runId: params.runId,
    filesystemPolicy: {
      worktreeMount: { hostPath: worktreeResult.worktreePath, sandboxPath: SANDBOX_WORKTREE_PATH, mode: "read_write" },
      readOnlyMounts: [],
      isolatedOutputDirectory: outputDir,
      // Required for the worktree's own `.git` gitdir pointer (an
      // absolute host path into `<repositoryPath>/.git/worktrees/<id>`)
      // to resolve inside the sandbox at all -- see schema.ts's own doc
      // comment on sourceRepositoryMount for the full rationale. Scoped
      // to just the `.git` directory, not the source repository's own
      // working tree, to keep this exception as narrow as possible.
      sourceRepositoryMount: { hostPath: resolve(join(params.repositoryPath, ".git")), sandboxPath: resolve(join(params.repositoryPath, ".git")), mode: "read_write" },
    },
    // No environment variable is forwarded by default -- the sandbox
    // image's own baked-in PATH is sufficient for git/basic tooling;
    // this repository has no operator-facing way to configure a live
    // allowlist yet (a reasonable future addition, not built here).
    environmentPolicy: { allowedVariableNames: [] },
    networkPolicy: { mode: "denied", approval: null },
    // Fixed, conservative sandbox-specific resource dimensions -- the
    // M36 AutonomousBudgetsSchema (params.budgets) has no CPU/memory/
    // disk/process-count/output-byte fields (those never existed before
    // a real sandbox could enforce them), so this Work Unit picks safe,
    // documented fixed defaults rather than inventing new operator-
    // config surface for them. A future Work Unit could expose these
    // as their own configurable budgets.
    processPolicy: { processCountLimit: 32, gracefulStopTimeoutSeconds: 10, forceTerminationTimeoutSeconds: 20 },
    resourcePolicy: {
      maxWallClockSeconds: params.budgets.maxWallClockSeconds,
      maxCpuSeconds: params.budgets.maxWallClockSeconds,
      maxMemoryBytes: 512 * 1024 * 1024,
      maxDiskWriteBytes: 100 * 1024 * 1024,
      maxProcessCount: 32,
      maxCommandCount: params.budgets.maxCommandCount,
      maxOutputBytes: 1024 * 1024,
      maxRetryCount: params.budgets.maxRetryCount,
    },
  };

  const created = backend.create(createRequest);
  if (!created.ok || !created.handle) {
    removeAutonomousWorktree(params.repositoryPath, worktreeResult.worktreePath);
    return { ok: false, reason: `Failed to create sandbox: ${created.reason}`, fallback: null };
  }

  return { ok: true, backend, handle: created.handle, worktreePath: worktreeResult.worktreePath, branchName };
}

export interface RunLiveSandboxedRunParams {
  backend: DockerSandboxBackend;
  handle: SandboxHandle;
  repositoryPath: string;
  worktreePath: string;
  baseCommit: string;
  candidate: AutonomousCandidate;
  policy: AutonomousExecutionPolicy;
  budgets: AutonomousBudgets;
  proposedCommands: readonly AutonomousAgentProposedCommand[];
  targetedValidationCommands: readonly AutonomousAgentProposedCommand[];
  authoritativeValidationCommands: readonly AutonomousAgentProposedCommand[];
}

export interface RunLiveSandboxedRunResult {
  resultState: SandboxRunResultState;
  findings: string[];
  evidence: SandboxEvidence | null;
  evidenceReason: string;
}

/**
 * Runs the main proposed-command loop, then (only if it completed)
 * targeted validation, then (only if targeted passed) authoritative
 * validation, then self-review -- mirroring M36-WU04's own tiering
 * ("no pass without validation": an empty targetedValidationCommands
 * list can never produce `passed`). Cleanup (container + worktree) is
 * unconditional, in a `finally` block, regardless of outcome --
 * matching every M36/M37/M38 precedent this session has established.
 */
export function runLiveSandboxedRun(params: RunLiveSandboxedRunParams): RunLiveSandboxedRunResult {
  const { backend, handle, repositoryPath, worktreePath, policy, budgets } = params;
  let resultState: SandboxRunResultState;
  let findings: string[] = [];
  // Real diagnostic detail for whatever stopped the run short of
  // "passed" -- surfaced into the evidence's residualRisk field below,
  // never silently discarded (a real, if narrow, forensics gap this
  // Work Unit's own CI run exposed: a blocked/failed live run's
  // evidence previously gave no clue why).
  let denialReason: string | null = null;
  // Captured BEFORE cleanup() destroys the container -- exportEvidence's
  // own listChangedFiles only ever sees `git status --porcelain`, which
  // is wrongly empty once a repair commits its own changes (a real
  // CI-only failure this Work Unit's own run exposed: a run that
  // genuinely renamed and committed a file was rejected by self-review
  // for "no files changed").
  let changedFiles: string[] | null = null;

  try {
    // Fixed, AIQT-authored housekeeping -- never mediated through
    // decideCommand (it is not an agent-proposed command) and never
    // counted toward the run's own command-count/wall-clock budget.
    // Without this, git refuses to operate at all ("detected dubious
    // ownership") in a repository whose global config has no
    // safe.directory entry for it, and `git commit` has no identity to
    // commit as -- a real container-specific requirement found via this
    // Work Unit's own CI run (this project's Windows development
    // machine has no Docker to have caught it locally). A fixed,
    // synthetic identity is used deliberately -- never the operator's
    // own real name/email, which this sandbox has no way to know and
    // must not guess.
    backend.launchProcess({ handle, command: "git", args: ["config", "--global", "--add", "safe.directory", SANDBOX_WORKTREE_PATH] });
    backend.launchProcess({ handle, command: "git", args: ["config", "--global", "user.email", SANDBOX_GIT_IDENTITY_EMAIL] });
    backend.launchProcess({ handle, command: "git", args: ["config", "--global", "user.name", SANDBOX_GIT_IDENTITY_NAME] });

    const mainLoop = executeSandboxedCommandLoop(backend, handle, params.proposedCommands, policy, {
      maxWallClockSeconds: budgets.maxWallClockSeconds,
      maxCpuSeconds: budgets.maxWallClockSeconds,
      maxMemoryBytes: 512 * 1024 * 1024,
      maxDiskWriteBytes: 100 * 1024 * 1024,
      maxProcessCount: 32,
      maxCommandCount: budgets.maxCommandCount,
      maxOutputBytes: 1024 * 1024,
      maxRetryCount: budgets.maxRetryCount,
    });

    // Real, while the container still exists -- must run before the
    // finally block's cleanup() destroys it. Captured regardless of
    // mainLoop's own outcome (even a blocked/failed run may have
    // genuinely changed files before it stopped).
    changedFiles = backend.getChangedFilesAgainstBaseCommit(handle, params.baseCommit);

    if (mainLoop.terminationReason === "cancelled") {
      resultState = "cancelled";
      denialReason = mainLoop.denialReason;
    } else if (mainLoop.terminationReason === "budget_exhausted") {
      resultState = "budget_exhausted";
      denialReason = mainLoop.denialReason;
    } else if (mainLoop.terminationReason === "policy_denied" || mainLoop.terminationReason === "resource_limit_exceeded" || mainLoop.terminationReason === "disk_measurement_unavailable") {
      resultState = "blocked";
      denialReason = mainLoop.denialReason;
    } else if (mainLoop.terminationReason !== "completed") {
      resultState = "failed";
      denialReason = mainLoop.denialReason;
    } else if (params.targetedValidationCommands.length === 0) {
      resultState = "validation_failed";
    } else {
      const targetedLoop = executeSandboxedCommandLoop(backend, handle, params.targetedValidationCommands, policy, {
        maxWallClockSeconds: budgets.maxValidationSeconds,
        maxCpuSeconds: budgets.maxValidationSeconds,
        maxMemoryBytes: 512 * 1024 * 1024,
        maxDiskWriteBytes: 100 * 1024 * 1024,
        maxProcessCount: 32,
        maxCommandCount: params.targetedValidationCommands.length,
        maxOutputBytes: 1024 * 1024,
        maxRetryCount: 0,
      });
      if (targetedLoop.terminationReason !== "completed") {
        resultState = "validation_failed";
        denialReason = targetedLoop.denialReason;
      } else if (params.authoritativeValidationCommands.length > 0) {
        const authoritativeLoop = executeSandboxedCommandLoop(backend, handle, params.authoritativeValidationCommands, policy, {
          maxWallClockSeconds: budgets.maxValidationSeconds,
          maxCpuSeconds: budgets.maxValidationSeconds,
          maxMemoryBytes: 512 * 1024 * 1024,
          maxDiskWriteBytes: 100 * 1024 * 1024,
          maxProcessCount: 32,
          maxCommandCount: params.authoritativeValidationCommands.length,
          maxOutputBytes: 1024 * 1024,
          maxRetryCount: 0,
        });
        resultState = authoritativeLoop.terminationReason === "completed" ? "passed" : "validation_failed";
        if (authoritativeLoop.terminationReason !== "completed") denialReason = authoritativeLoop.denialReason;
      } else {
        resultState = "passed";
      }
    }

    // Self-review only makes sense once we have real evidence to review
    // -- deferred until after cleanup() below, where exportEvidence()
    // becomes callable.
  } finally {
    // Cleanup is unconditional and attempted exactly once, regardless of
    // outcome -- matching every M36/M37/M38 precedent this session has
    // established. Container cleanup and worktree removal are two
    // separate real resources; both are attempted even if one fails.
    backend.cleanup(handle);
    removeAutonomousWorktree(repositoryPath, worktreePath);
  }

  const evidenceResult = backend.exportEvidence(handle);
  if (!evidenceResult.ok || !evidenceResult.evidence) {
    return { resultState: "failed", findings: [`Evidence export failed: ${evidenceResult.reason}`], evidence: null, evidenceReason: evidenceResult.reason };
  }

  // Real diagnostic/forensic detail, never silently discarded or
  // overwritten by a post-cleanup query that can no longer see it:
  // - filesChanged: exportEvidence's own listChangedFiles only sees
  //   `git status --porcelain` AFTER cleanup already destroyed the
  //   container, which is wrongly empty once a repair commits its own
  //   changes. The real, pre-cleanup changedFiles captured above is
  //   authoritative when available.
  // - residualRisk: a run that did not pass carries WHY, not just the
  //   backend's own generic text.
  const evidence: SandboxEvidence = {
    ...evidenceResult.evidence,
    ...(changedFiles !== null ? { filesChanged: changedFiles } : {}),
    ...(denialReason ? { residualRisk: `${evidenceResult.evidence.residualRisk} ${denialReason}` } : {}),
  };

  if (resultState! === "passed") {
    const review = reviewSandboxRun({ filesChanged: evidence.filesChanged });
    if (review.hasUnresolvedCriticalFindings) {
      resultState = "review_rejected";
    }
    findings = review.findings;
  }

  return { resultState: resultState!, findings, evidence, evidenceReason: evidenceResult.reason };
}
