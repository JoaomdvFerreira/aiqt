import type { CommandContext } from "../command-context.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { CommandResult } from "../../core/output/result.js";
import { loadAutonomousRunRecord, saveAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { isValidRunStatusTransition } from "../../workflow/autonomous-run-lifecycle.js";
import { isApprovalRequired, isApprovalStale } from "../../workflow/autonomous-run-approval.js";
import { simulateAutonomousRun } from "../../services/autonomous-run-simulation-service.js";
import { buildAutonomousRunCommandResult } from "../../services/autonomous-run-command-result.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";
import type { AutonomousRunAuditEntry } from "../../schema/autonomous-run-record.schema.js";

/**
 * M37-WU01 (build spec: "aiqt autonomous run"; operating constraints:
 * "do not invoke a coding model," "do not execute autonomous code
 * changes," "do not create a real autonomous worktree"). This command
 * NEVER calls M36's real pipeline (`produceAutonomousEvidencePacket`,
 * `executeAutonomousRun`, `createAutonomousWorktree`,
 * `runAutonomousCommand`) -- none of those functions are imported here,
 * verified by tests/unit/autonomous-run-boundary-scan.test.ts's WU37-01
 * section. `--simulate` is REQUIRED; its absence is a fail-closed
 * refusal, not a default real-execution path (there is no real-execution
 * path in this Work Unit at all -- `--simulate` exists only to make the
 * operator's intent explicit and to make a future WU37-02 real adapter
 * gate visibly obvious as a new, deliberately different code path).
 */
export interface AutonomousRunOptions {
  run?: string;
  simulate?: boolean;
  configPath?: string;
  evidenceDir?: string;
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

  if (!options.simulate) {
    return autonomousFailure(
      "No coding-agent adapter is configured in this version of AIQT. Pass --simulate to preview the evidence-packet pipeline shape without any real execution.",
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-RUN-NO-ADAPTER-CONFIGURED",
    );
  }

  if (!isValidRunStatusTransition(record.status, "blocked")) {
    return autonomousFailure(`Run ${record.runId} cannot transition from "${record.status}" to a terminal simulated result.`, ExitCode.WorkflowBlocked, "AUTONOMOUS-RUN-INVALID-TRANSITION");
  }

  const evidencePacket = simulateAutonomousRun({ runId: record.runId, candidate: record.candidate, safetyAssessment: record.safetyAssessment });

  const nowIso = new Date().toISOString();
  const auditEntry: AutonomousRunAuditEntry = { event: "autonomous_run.blocked", at: nowIso, detail: "Simulated run completed with resultState:needs_input; no real execution occurred." };
  const updated = {
    ...record,
    status: "blocked" as const,
    updatedAt: nowIso,
    evidencePacket,
    auditLog: [...record.auditLog, auditEntry],
  };
  saveAutonomousRunRecord(updated, config.evidenceOutputDir);

  return buildAutonomousRunCommandResult(evidencePacket);
}
