import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { CommandContext } from "../command-context.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { CommandResult } from "../../core/output/result.js";
import { loadAutonomousRunRecord, saveAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { loadAgentRequest } from "../../services/autonomous-agent-request-store.js";
import { importAutonomousAgentResponse } from "../../services/autonomous-agent-response-import-service.js";
import { buildImportAgentResponseCommandResult } from "../../services/autonomous-agent-response-import-result.js";
import { isValidRunStatusTransition, isValidTerminalPairing } from "../../workflow/autonomous-run-lifecycle.js";
import { isAiqtOwnRepository } from "../../workflow/autonomous-run-self-management-guard.js";
import { ImportedResponseAgentAdapter } from "../../workflow/autonomous-imported-response-agent-adapter.js";
import { produceAutonomousEvidencePacket } from "../../services/autonomous-run-evidence-binding-service.js";
import { buildAutonomousRunCommandResult } from "../../services/autonomous-run-command-result.js";
import { prepareLiveSandbox, runLiveSandboxedRun } from "../../services/sandbox-run-execution-service.js";
import { buildSandboxRunCommandResult } from "../../services/sandbox-run-command-result.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import type { AutonomousRunAuditEntry, AutonomousRunRecord } from "../../schema/autonomous-run-record.schema.js";
import { RESULT_STATE_TERMINAL_STATUS, type AutonomousRunStatus } from "../../schema/autonomous-run.schema.js";

/**
 * M37-WU03 (build spec: "invoke adapter"; "prepare isolated worktree").
 * The ONE command in this milestone that creates a real worktree and
 * executes real commands -- and it does so entirely by delegating to
 * M36-WU04's already-reviewed, already-dogfooded
 * produceAutonomousEvidencePacket, unchanged, via a thin
 * ImportedResponseAgentAdapter wrapping the already-imported command
 * list. Importing itself (M37-WU02's importAutonomousAgentResponse) is
 * still pure parse+validate+record -- real execution only begins AFTER
 * a successful import, inside produceAutonomousEvidencePacket's own
 * cleanup-guaranteed pipeline.
 */
export interface AutonomousAgentImportOptions {
  run?: string;
  fromFile?: string;
  stdin?: boolean;
  configPath?: string;
  evidenceDir?: string;
  /**
   * M38-WU04: execute the imported response's proposed commands inside a
   * real sandbox (DockerSandboxBackend) instead of a bare worktree.
   * Opt-in at two layers: the operator's own standing config
   * (`liveExecutionEnabled`, default false) AND this per-invocation flag
   * -- both must be true. Refuses outright, before any capability check,
   * if the operator has not opted in. Never a silent fallback either
   * way: an insufficient/unavailable sandbox recommends the (always
   * available) non-live path explicitly.
   */
  live?: boolean;
}

interface Deps {
  stdin?: StdinLike;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runAutonomousAgentImport(ctx: CommandContext, options: AutonomousAgentImportOptions, deps: Deps = {}): Promise<CommandResult> {
  if (!options.run || options.run.trim() === "") {
    return autonomousFailure("aiqt autonomous agent-import requires --run <runId>.", ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-NO-RUN");
  }
  if (options.fromFile && options.stdin) {
    return autonomousFailure("aiqt autonomous agent-import accepts exactly one of --from-file or --stdin.", ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-CONFLICTING-INPUT");
  }
  if (!options.fromFile && !options.stdin) {
    return autonomousFailure("aiqt autonomous agent-import requires --from-file <path> or --stdin.", ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-NO-INPUT");
  }

  const configOutcome = resolveOperatorConfigOrFail({
    cwd: ctx.cwd,
    configPath: options.configPath,
    cliFlags: options.evidenceDir ? { evidenceOutputDir: options.evidenceDir } : {},
  });
  if (!configOutcome.ok) return configOutcome.result;
  const config = configOutcome.config;

  const loadedRun = loadAutonomousRunRecord(options.run, config.evidenceOutputDir);
  if (!loadedRun.ok) {
    return autonomousFailure(loadedRun.reason, ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-RUN-NOT-FOUND");
  }
  const record = loadedRun.record;

  if (record.status !== "executing" || !record.agentRequestId) {
    return autonomousFailure(
      `Run ${record.runId} is in status "${record.status}" and has no pending agent request to import against.`,
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-AGENT-IMPORT-NO-PENDING-REQUEST",
    );
  }

  const loadedRequest = loadAgentRequest(record.agentRequestId, config.evidenceOutputDir);
  if (!loadedRequest.ok) {
    return autonomousFailure(loadedRequest.reason, ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-REQUEST-NOT-FOUND");
  }

  let rawText: string;
  if (options.fromFile) {
    if (!existsSync(options.fromFile)) {
      return autonomousFailure(`Response file not found: ${options.fromFile}`, ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-FILE-NOT-FOUND");
    }
    rawText = readFileSync(options.fromFile, "utf8");
  } else {
    if (isStdinInteractiveTty(deps.stdin)) {
      return autonomousFailure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-STDIN-TTY");
    }
    rawText = await readStdinText(deps.stdin);
    if (rawText.trim() === "") {
      return autonomousFailure("Received empty input on stdin.", ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-STDIN-EMPTY");
    }
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    return autonomousFailure("Response input is not valid JSON.", ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-INVALID-JSON");
  }

  const importResult = importAutonomousAgentResponse(loadedRequest.request, rawJson);
  if (!importResult.ok) {
    return buildImportAgentResponseCommandResult(importResult);
  }

  // Defense in depth, same reasoning as autonomous-run.command.ts's
  // runReal(): re-check immediately before the one real, mutating step.
  if (isAiqtOwnRepository(record.repositoryPath)) {
    return autonomousFailure(
      `Run ${record.runId} targets the AIQT product's own repository (self-management is never permitted). Refusing to execute.`,
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-AGENT-IMPORT-SELF-TARGET",
    );
  }
  if (!record.baseCommit) {
    return autonomousFailure(`Run ${record.runId} has no resolved base commit and cannot be executed.`, ExitCode.WorkflowBlocked, "AUTONOMOUS-AGENT-IMPORT-NO-BASE-COMMIT");
  }
  // M37-WU03 correction: a relative worktreeRoot resolves against
  // whatever cwd the CLI happens to be invoked from -- unpredictable,
  // and observed during this Work Unit's own manual verification to
  // land real worktree files inside the AIQT repository's own working
  // tree. Refuse outright rather than resolve it implicitly.
  if (!isAbsolute(config.worktreeRoot)) {
    return autonomousFailure(
      `The configured worktreeRoot ("${config.worktreeRoot}") is not an absolute path. Configure an absolute worktreeRoot before running a real execution.`,
      ExitCode.InvalidInput,
      "AUTONOMOUS-AGENT-IMPORT-RELATIVE-WORKTREE-ROOT",
    );
  }

  const auditLog: AutonomousRunAuditEntry[] = [
    ...record.auditLog,
    { event: "autonomous_run.command_allowed", at: nowIso(), detail: `Agent response imported: ${importResult.response.commandsProposed.length} command(s) proposed.` },
  ];

  if (options.live) {
    // Layer 1 gate: the operator's own standing opt-in. Checked BEFORE
    // any sandbox capability probe -- an operator who never opted in
    // should never see a Docker-availability error at all.
    if (!config.liveExecutionEnabled) {
      return autonomousFailure(
        `Run ${record.runId}: --live was passed, but this operator's configuration does not have liveExecutionEnabled set. Enable it explicitly (aiqt.autonomous.config.json or AIQT_AUTONOMOUS_LIVE_EXECUTION=1) before using --live, or omit --live to use the always-available request/import path.`,
        ExitCode.WorkflowBlocked,
        "AUTONOMOUS-AGENT-IMPORT-LIVE-NOT-ENABLED",
      );
    }

    // Layer 2 gate: real capability preflight (build spec cross-Work-Unit
    // invariant 2: "No live execution without capability confirmation").
    const prepared = prepareLiveSandbox({
      runId: record.runId,
      repositoryPath: record.repositoryPath,
      baseCommit: record.baseCommit,
      issueId: record.candidate.issueId,
      worktreeRoot: config.worktreeRoot,
      policy: record.policy,
      budgets: record.budgets,
    });
    if (!prepared.ok) {
      const fallbackNote = prepared.fallback ? ` Recommendation: ${prepared.fallback.reason} Use "${prepared.fallback.recommendedCommand}" (i.e. omit --live) instead.` : "";
      return autonomousFailure(`Run ${record.runId}: live sandbox could not be prepared: ${prepared.reason}.${fallbackNote}`, ExitCode.WorkflowBlocked, "AUTONOMOUS-AGENT-IMPORT-LIVE-UNAVAILABLE");
    }

    // Crash-recovery anchor: persist the real container id BEFORE
    // running any command inside it, so a later `aiqt autonomous
    // cleanup` can still find and destroy it even if this process
    // itself crashes before reaching the save below.
    const withContainerId: AutonomousRunRecord = { ...record, status: "executing", updatedAt: nowIso(), sandboxContainerId: prepared.handle.sandboxId, auditLog };
    saveAutonomousRunRecord(withContainerId, config.evidenceOutputDir);

    const liveResult = runLiveSandboxedRun({
      backend: prepared.backend,
      handle: prepared.handle,
      repositoryPath: record.repositoryPath,
      worktreePath: prepared.worktreePath,
      baseCommit: record.baseCommit,
      candidate: record.candidate,
      policy: record.policy,
      budgets: record.budgets,
      proposedCommands: importResult.response.commandsProposed,
      targetedValidationCommands: record.targetedValidationCommands,
      authoritativeValidationCommands: record.authoritativeValidationCommands,
    });

    // liveResult.resultState's values are named identically to
    // AutonomousResultState's (minus "needs_input", never produced by a
    // live run) -- RESULT_STATE_TERMINAL_STATUS's lookup works unchanged.
    const liveTerminalStatus: AutonomousRunStatus = RESULT_STATE_TERMINAL_STATUS[liveResult.resultState as keyof typeof RESULT_STATE_TERMINAL_STATUS];

    // Walk the same real intermediate hops the non-live path below does
    // -- only resultState:"passed" needs the full executing -> validating
    // -> reviewing -> completed path; every other terminal status is
    // directly reachable from "executing".
    const liveHops: AutonomousRunStatus[] = liveTerminalStatus === "completed" ? ["validating", "reviewing", "completed"] : [liveTerminalStatus];
    let liveHopStatus: AutonomousRunStatus = withContainerId.status;
    for (const hop of liveHops) {
      if (!isValidRunStatusTransition(liveHopStatus, hop)) {
        return autonomousFailure(`Run ${record.runId}: cannot transition from "${liveHopStatus}" to "${hop}".`, ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-LIVE-INVALID-TRANSITION");
      }
      liveHopStatus = hop;
    }

    const finalAuditLog: AutonomousRunAuditEntry[] = [...auditLog, { event: "autonomous_run.completed", at: nowIso(), detail: `Live sandboxed run reached terminal status "${liveTerminalStatus}" (resultState: "${liveResult.resultState}").` }];
    const finalRecord: AutonomousRunRecord = {
      ...withContainerId,
      status: liveTerminalStatus,
      updatedAt: nowIso(),
      sandboxEvidence: liveResult.evidence,
      auditLog: finalAuditLog,
    };
    saveAutonomousRunRecord(finalRecord, config.evidenceOutputDir);

    if (!liveResult.evidence) {
      return autonomousFailure(`Run ${record.runId}: ${liveResult.evidenceReason}`, ExitCode.ValidationFailed, "AUTONOMOUS-AGENT-IMPORT-LIVE-NO-EVIDENCE");
    }
    return buildSandboxRunCommandResult(record.runId, record.candidate.issueId, liveResult.resultState, liveResult.findings, liveResult.evidence);
  }

  const adapter = new ImportedResponseAgentAdapter(importResult.response.commandsProposed);
  const packet = produceAutonomousEvidencePacket({
    runId: record.runId,
    candidate: record.candidate,
    safetyAssessment: record.safetyAssessment,
    sourceRepositoryPath: record.repositoryPath,
    baseCommit: record.baseCommit,
    workspaceRoot: config.worktreeRoot,
    policy: record.policy,
    budgets: record.budgets,
    agentAdapter: adapter,
    targetedValidationCommands: record.targetedValidationCommands,
    authoritativeValidationCommands: record.authoritativeValidationCommands,
  });

  const terminalStatus: AutonomousRunStatus = RESULT_STATE_TERMINAL_STATUS[packet.resultState];
  if (!isValidTerminalPairing(terminalStatus, packet.resultState)) {
    // Fail-closed: this should be structurally unreachable -- resultState
    // and its terminal status pairing is fixed by the schema itself
    // (RESULT_STATE_TERMINAL_STATUS). Refuse rather than persist an
    // inconsistent record if it ever does happen.
    return autonomousFailure(
      `Run ${record.runId}: the evidence packet's resultState ("${packet.resultState}") does not pair with terminal status "${terminalStatus}".`,
      ExitCode.InvalidInput,
      "AUTONOMOUS-AGENT-IMPORT-INVALID-TERMINAL-PAIRING",
    );
  }

  // Walk the real intermediate hops the lifecycle table requires: only
  // resultState:"passed" (status "completed") needs the full
  // executing -> validating -> reviewing -> completed path, since
  // produceAutonomousEvidencePacket only actually reaches validation/
  // review for a "completed" execution outcome (M36-WU04's own
  // resultState decision logic). Every other terminal status
  // (blocked/failed/cancelled/budget_exhausted) is directly reachable
  // from "executing" (see autonomous-run-lifecycle.ts's M37-WU03
  // correction for the "blocked" case specifically).
  const hops: AutonomousRunStatus[] = terminalStatus === "completed" ? ["validating", "reviewing", "completed"] : [terminalStatus];
  let hopStatus: AutonomousRunStatus = record.status;
  for (const hop of hops) {
    if (!isValidRunStatusTransition(hopStatus, hop)) {
      return autonomousFailure(`Run ${record.runId}: cannot transition from "${hopStatus}" to "${hop}".`, ExitCode.InvalidInput, "AUTONOMOUS-AGENT-IMPORT-INVALID-TRANSITION");
    }
    hopStatus = hop;
  }

  auditLog.push({ event: "autonomous_run.completed", at: nowIso(), detail: `Run reached terminal status "${terminalStatus}" (resultState: "${packet.resultState}").` });

  const updated: AutonomousRunRecord = { ...record, status: terminalStatus, updatedAt: nowIso(), evidencePacket: packet, auditLog };
  saveAutonomousRunRecord(updated, config.evidenceOutputDir);

  return buildAutonomousRunCommandResult(packet);
}
