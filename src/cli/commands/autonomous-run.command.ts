import type { CommandContext } from "../command-context.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { loadAutonomousRunRecord, saveAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { isValidRunStatusTransition } from "../../workflow/autonomous-run-lifecycle.js";
import { isApprovalRequired, isApprovalStale } from "../../workflow/autonomous-run-approval.js";
import { simulateAutonomousRun } from "../../services/autonomous-run-simulation-service.js";
import { buildAutonomousRunCommandResult } from "../../services/autonomous-run-command-result.js";
import { isAiqtOwnRepository } from "../../workflow/autonomous-run-self-management-guard.js";
import { generateAgentRequestId, saveAgentRequest } from "../../services/autonomous-agent-request-store.js";
import { buildAutonomousAgentRequest } from "../../workflow/autonomous-agent-request-builder.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";
import type { AutonomousRunAuditEntry, AutonomousRunRecord } from "../../schema/autonomous-run-record.schema.js";
import type { AutonomousRunStatus } from "../../schema/autonomous-run.schema.js";

/**
 * M37-WU01/WU03 (build spec: "aiqt autonomous run"). Two distinct paths:
 *
 * `--simulate` (WU37-01, unchanged): a pure, no-I/O preview -- never
 * touches the real M36 execution pipeline, never creates a real
 * worktree, always resultState:"needs_input". Available at any time as
 * a safe dry-run.
 *
 * Without `--simulate` (WU37-03, new): the REAL path. Still creates no
 * worktree and invokes no model itself here -- per the M37-WU02 design
 * decision (docs/engineering/m37-wu02-agent-adapter-design-note.md),
 * this only builds and persists a bounded AutonomousAgentRequest for the
 * operator to run their own coding-agent tool against, manually, outside
 * AIQT. Real worktree creation and real command execution happen later,
 * only inside `autonomous-agent-import.command.ts`, only after a
 * response has been imported and validated (M37-WU02's
 * importAutonomousAgentResponse) -- never from this command directly.
 * This file itself still never imports produceAutonomousEvidencePacket/
 * executeAutonomousRun/createAutonomousWorktree/runAutonomousCommand,
 * verified by the boundary scan's WU37-03 section.
 */
export interface AutonomousRunOptions {
  run?: string;
  simulate?: boolean;
  configPath?: string;
  evidenceDir?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function runSimulated(record: AutonomousRunRecord, evidenceDir: string): CommandResult {
  if (!isValidRunStatusTransition(record.status, "blocked")) {
    return autonomousFailure(`Run ${record.runId} cannot transition from "${record.status}" to a terminal simulated result.`, ExitCode.WorkflowBlocked, "AUTONOMOUS-RUN-INVALID-TRANSITION");
  }

  const evidencePacket = simulateAutonomousRun({ runId: record.runId, candidate: record.candidate, safetyAssessment: record.safetyAssessment });

  const auditEntry: AutonomousRunAuditEntry = { event: "autonomous_run.blocked", at: nowIso(), detail: "Simulated run completed with resultState:needs_input; no real execution occurred." };
  const updated: AutonomousRunRecord = { ...record, status: "blocked", updatedAt: nowIso(), evidencePacket, auditLog: [...record.auditLog, auditEntry] };
  saveAutonomousRunRecord(updated, evidenceDir);

  return buildAutonomousRunCommandResult(evidencePacket);
}

function runReal(record: AutonomousRunRecord, evidenceDir: string): CommandResult {
  // Defense in depth: repositoryPath was already checked at classify
  // time, but the run record is a plain JSON file an operator could in
  // principle hand-edit before this, real, mutating-adjacent step --
  // re-checked here since this is the actual point past which a real
  // worktree will eventually be created (in agent-import).
  if (isAiqtOwnRepository(record.repositoryPath)) {
    return autonomousFailure(
      `Run ${record.runId} targets the AIQT product's own repository (self-management is never permitted). Refusing to proceed.`,
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-RUN-SELF-TARGET",
    );
  }
  if (!record.baseCommit) {
    return autonomousFailure(`Run ${record.runId} has no resolved base commit and cannot be run.`, ExitCode.WorkflowBlocked, "AUTONOMOUS-RUN-NO-BASE-COMMIT");
  }

  // Walk the real intermediate status(es) the M36-WU01 lifecycle table
  // requires -- classified has no direct edge to "executing", only to
  // "preparing_workspace" first; a record already in "preparing_workspace"
  // (post-approval) skips straight to the second hop. Concurrent-run
  // protection falls directly out of this: a run already in "executing"
  // (or any later status) is rejected by the earlier "must be classified
  // or preparing_workspace" guard in runAutonomousRun below, so a second
  // `run` invocation against the same runId can never start a second
  // agent request.
  let status: AutonomousRunStatus = record.status;
  const auditLog: AutonomousRunAuditEntry[] = [...record.auditLog];
  const advance = (to: AutonomousRunStatus, event: AutonomousRunAuditEntry["event"], detail: string): boolean => {
    if (!isValidRunStatusTransition(status, to)) return false;
    status = to;
    auditLog.push({ event, at: nowIso(), detail });
    return true;
  };
  if (status === "classified") {
    advance("preparing_workspace", "autonomous_run.workspace_prepared", "No workspace created yet -- worktree creation is deferred to agent-import, per the request/import architecture.");
  }
  if (!advance("executing", "autonomous_run.execution_started", "Agent request created; awaiting the operator to run their own coding-agent tool and import its response.")) {
    return autonomousFailure(`Run ${record.runId} cannot transition from "${record.status}" to "executing".`, ExitCode.WorkflowBlocked, "AUTONOMOUS-RUN-INVALID-TRANSITION");
  }

  const requestId = generateAgentRequestId();
  const request = buildAutonomousAgentRequest({ requestId, runId: record.runId, candidate: record.candidate, budgets: record.budgets, policy: record.policy });
  saveAgentRequest(request, evidenceDir);

  const updated: AutonomousRunRecord = { ...record, status, updatedAt: nowIso(), agentRequestId: requestId, auditLog };
  saveAutonomousRunRecord(updated, evidenceDir);

  return makeResult({
    status: "needs_input",
    action: "autonomous",
    summary: `Run ${record.runId}: agent request ${requestId} created. Run your own coding-agent tool against the request's prompt package, then import its response with aiqt autonomous agent-import.`,
    exitCode: ExitCode.HumanInputRequired,
    requiresHumanInput: true,
    nextRecommendedCommand: "aiqt autonomous agent-import",
    data: { runId: record.runId, status: updated.status, agentRequestId: requestId, promptPackage: request.promptPackage },
  });
}

export function runAutonomousRun(ctx: CommandContext, options: AutonomousRunOptions): CommandResult {
  if (!options.run || options.run.trim() === "") {
    return autonomousFailure("aiqt autonomous run requires --run <runId>.", ExitCode.InvalidInput, "AUTONOMOUS-RUN-NO-RUN");
  }

  const configOutcome = resolveOperatorConfigOrFail({
    cwd: ctx.cwd,
    configPath: options.configPath,
    cliFlags: options.evidenceDir ? { evidenceOutputDir: options.evidenceDir } : {},
  });
  if (!configOutcome.ok) return configOutcome.result;
  const config = configOutcome.config;

  const loaded = loadAutonomousRunRecord(options.run, config.evidenceOutputDir);
  if (!loaded.ok) {
    return autonomousFailure(loaded.reason, ExitCode.InvalidInput, "AUTONOMOUS-RUN-RUN-NOT-FOUND");
  }
  const record = loaded.record;

  if (record.status !== "classified" && record.status !== "preparing_workspace") {
    return autonomousFailure(
      `Run ${record.runId} is in status "${record.status}" and cannot be run (must be "classified" with no approval required, or "preparing_workspace" after approval).`,
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-RUN-WRONG-STATUS",
    );
  }

  const needsApproval = isApprovalRequired(record.safetyAssessment.riskClass, record.candidate.requestedPermissions, config.approvalPolicy);
  if (needsApproval) {
    if (!record.approval) {
      return autonomousFailure(`Run ${record.runId} requires approval before it may run. Run aiqt autonomous approve first.`, ExitCode.WorkflowBlocked, "AUTONOMOUS-RUN-APPROVAL-REQUIRED");
    }
    if (!record.baseCommit || isApprovalStale(record.approval.bindingDigest, { candidate: record.candidate, baseCommit: record.baseCommit, budgets: record.budgets })) {
      return autonomousFailure(
        `Run ${record.runId}'s approval is stale (the candidate, base commit, or budgets changed since it was approved). Re-approve before running.`,
        ExitCode.WorkflowBlocked,
        "AUTONOMOUS-RUN-STALE-APPROVAL",
      );
    }
  }

  return options.simulate ? runSimulated(record, config.evidenceOutputDir) : runReal(record, config.evidenceOutputDir);
}
