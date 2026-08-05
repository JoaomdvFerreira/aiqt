import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
      worktreeMount: { hostPath: worktreeResult.worktreePath, sandboxPath: "/workspace", mode: "read_write" },
      readOnlyMounts: [],
      isolatedOutputDirectory: outputDir,
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

  try {
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

    if (mainLoop.terminationReason === "cancelled") {
      resultState = "cancelled";
    } else if (mainLoop.terminationReason === "budget_exhausted") {
      resultState = "budget_exhausted";
    } else if (mainLoop.terminationReason === "policy_denied" || mainLoop.terminationReason === "resource_limit_exceeded") {
      resultState = "blocked";
    } else if (mainLoop.terminationReason !== "completed") {
      resultState = "failed";
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

  if (resultState! === "passed") {
    const review = reviewSandboxRun({ filesChanged: evidenceResult.evidence.filesChanged });
    if (review.hasUnresolvedCriticalFindings) {
      resultState = "review_rejected";
    }
    findings = review.findings;
  }

  return { resultState: resultState!, findings, evidence: evidenceResult.evidence, evidenceReason: evidenceResult.reason };
}
