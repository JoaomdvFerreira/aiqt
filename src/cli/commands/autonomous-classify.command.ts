import { existsSync, readFileSync } from "node:fs";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { intakeCandidate } from "../../services/autonomous-candidate-intake-service.js";
import { isAlwaysBlocked } from "../../workflow/autonomous-run-safety-classifier.js";
import { isValidRunStatusTransition } from "../../workflow/autonomous-run-lifecycle.js";
import { isApprovalRequired } from "../../workflow/autonomous-run-approval.js";
import { isAiqtOwnRepository } from "../../workflow/autonomous-run-self-management-guard.js";
import { generateAutonomousRunId, saveAutonomousRunRecord } from "../../services/autonomous-run-store.js";
import { autonomousFailure, resolveOperatorConfigOrFail } from "./autonomous-shared.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import type { AutonomousRunRecord, AutonomousRunAuditEntry } from "../../schema/autonomous-run-record.schema.js";
import { PROHIBITED_AREA_TAGS, type ProhibitedAreaTag, type AutonomousRunStatus } from "../../schema/autonomous-run.schema.js";
import { ALWAYS_DENIED_COMMAND_CLASSES } from "../../schema/autonomous-run.schema.js";
import type { AutonomousAgentProposedCommand } from "../../schema/autonomous-agent-request.schema.js";

/**
 * M37-WU01 (build spec: "aiqt autonomous classify"; "Candidate input").
 * Accepts exactly one of --from-file / --stdin / direct bounded flags,
 * runs it through M36-WU02's intakeCandidate (Zod validation + real
 * read-only preflight + fail-closed classification), refuses to target
 * the AIQT product's own repository, and persists a new run record whose
 * lifecycle status reflects the classification outcome. No workspace,
 * no command execution, no model invocation.
 */
export interface AutonomousClassifyOptions {
  fromFile?: string;
  stdin?: boolean;
  issueId?: string;
  source?: string;
  repository?: string;
  baseRef?: string;
  objective?: string;
  acceptanceCriterion?: string[];
  constraint?: string[];
  requestedPermission?: string[];
  prohibitedArea?: string[];
  validationAvailable?: boolean;
  /** M37-WU03: real validation commands for a real (non-simulated) run's completion path. Each entry is a single "cmd arg1 arg2" string, whitespace-split -- no quoting support, intentionally simple. */
  targetedValidationCommand?: string[];
  authoritativeValidationCommand?: string[];
  configPath?: string;
  evidenceDir?: string;
}

interface Deps {
  stdin?: StdinLike;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** "git status" -> {command:"git", args:["status"]}. No quoting/escaping support -- a deliberately simple whitespace split, matching this flag's documented "no quoting support" limitation. */
function parseCommandString(text: string): AutonomousAgentProposedCommand {
  const parts = text.trim().split(/\s+/).filter((p) => p.length > 0);
  return { command: parts[0] ?? "", args: parts.slice(1) };
}

function auditEntry(event: AutonomousRunAuditEntry["event"], detail: string): AutonomousRunAuditEntry {
  return { event, at: nowIso(), detail };
}

export async function runAutonomousClassify(ctx: CommandContext, options: AutonomousClassifyOptions, deps: Deps = {}): Promise<CommandResult> {
  if (options.fromFile && options.stdin) {
    return autonomousFailure("aiqt autonomous classify accepts exactly one of --from-file or --stdin.", ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-CONFLICTING-INPUT");
  }

  let raw: unknown;
  if (options.fromFile) {
    if (!existsSync(options.fromFile)) {
      return autonomousFailure(`Candidate input file not found: ${options.fromFile}`, ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-FILE-NOT-FOUND");
    }
    try {
      raw = JSON.parse(readFileSync(options.fromFile, "utf8"));
    } catch {
      return autonomousFailure(`Candidate input file is not valid JSON: ${options.fromFile}`, ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-FILE-INVALID-JSON");
    }
  } else if (options.stdin) {
    if (isStdinInteractiveTty(deps.stdin)) {
      return autonomousFailure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-STDIN-TTY");
    }
    const text = await readStdinText(deps.stdin);
    if (text.trim() === "") {
      return autonomousFailure("Received empty input on stdin.", ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-STDIN-EMPTY");
    }
    try {
      raw = JSON.parse(text);
    } catch {
      return autonomousFailure("Candidate input on stdin is not valid JSON.", ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-STDIN-INVALID-JSON");
    }
  } else {
    raw = {
      issueId: options.issueId,
      source: options.source ?? "manual",
      repository: options.repository,
      baseRef: options.baseRef,
      objective: options.objective,
      acceptanceCriteria: options.acceptanceCriterion ?? [],
      constraints: options.constraint ?? [],
      requestedPermissions: options.requestedPermission ?? [],
    };
  }

  const candidateShape = raw as { repository?: unknown };
  const repositoryPath = typeof candidateShape.repository === "string" ? candidateShape.repository : "";
  if (repositoryPath && isAiqtOwnRepository(repositoryPath)) {
    return autonomousFailure(
      "aiqt autonomous classify refuses to target the AIQT product's own repository (self-management is never permitted).",
      ExitCode.WorkflowBlocked,
      "AUTONOMOUS-CLASSIFY-SELF-TARGET",
    );
  }

  const invalidProhibitedAreas = (options.prohibitedArea ?? []).filter((tag) => !(PROHIBITED_AREA_TAGS as readonly string[]).includes(tag));
  if (invalidProhibitedAreas.length > 0) {
    return autonomousFailure(
      `Unknown --prohibited-area value(s): ${invalidProhibitedAreas.join(", ")}. Valid values: ${PROHIBITED_AREA_TAGS.join(", ")}.`,
      ExitCode.InvalidInput,
      "AUTONOMOUS-CLASSIFY-INVALID-PROHIBITED-AREA",
    );
  }

  const targetedValidationCommands = (options.targetedValidationCommand ?? []).map(parseCommandString);
  const authoritativeValidationCommands = (options.authoritativeValidationCommand ?? []).map(parseCommandString);
  if ([...targetedValidationCommands, ...authoritativeValidationCommands].some((c) => c.command === "")) {
    return autonomousFailure("A --targeted-validation-command/--authoritative-validation-command value was empty.", ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-EMPTY-VALIDATION-COMMAND");
  }

  const configOutcome = resolveOperatorConfigOrFail({
    cwd: ctx.cwd,
    configPath: options.configPath,
    cliFlags: options.evidenceDir ? { evidenceOutputDir: options.evidenceDir } : {},
  });
  if (!configOutcome.ok) return configOutcome.result;
  const config = configOutcome.config;

  const intake = intakeCandidate({
    rawCandidate: raw,
    repositoryPath,
    validationCommandsAvailable: Boolean(options.validationAvailable),
    prohibitedAreaTags: (options.prohibitedArea ?? []) as ProhibitedAreaTag[],
  });

  if (!intake.ok) {
    return autonomousFailure(`Candidate rejected: ${intake.issues.join("; ")}`, ExitCode.InvalidInput, "AUTONOMOUS-CLASSIFY-INVALID-CANDIDATE");
  }

  const runId = generateAutonomousRunId();
  const auditLog: AutonomousRunAuditEntry[] = [auditEntry("autonomous_run.created", `Run ${runId} created for issue "${intake.candidate.issueId}".`)];

  // Reuse M36-WU01's own lifecycle transition table to walk through the
  // real intermediate statuses (created -> preflight -> classified/
  // blocked) rather than jumping straight to the final status -- each
  // hop is validated, not merely asserted.
  let status: AutonomousRunStatus = "created";
  const advance = (to: AutonomousRunStatus): boolean => {
    if (!isValidRunStatusTransition(status, to)) return false;
    status = to;
    return true;
  };
  advance("preflight");
  auditLog.push(auditEntry("autonomous_run.preflight_completed", `Repository dirty=${intake.preflight.repositoryDirty}, baseRefResolvable=${intake.preflight.baseRefResolvable}.`));

  const alwaysBlocked = isAlwaysBlocked(intake.safetyAssessment.riskClass);
  const needsApproval = isApprovalRequired(intake.safetyAssessment.riskClass, intake.candidate.requestedPermissions, config.approvalPolicy);

  advance("classified");
  auditLog.push(auditEntry("autonomous_run.classified", `Risk class: ${intake.safetyAssessment.riskClass}.`));

  if (alwaysBlocked) {
    advance("blocked");
    auditLog.push(auditEntry("autonomous_run.blocked", intake.safetyAssessment.reason));
  } else if (needsApproval) {
    advance("awaiting_approval");
    auditLog.push(auditEntry("autonomous_run.approval_requested", intake.safetyAssessment.reason));
  }
  // Otherwise status stays "classified" -- low-risk, no approval required.

  const record: AutonomousRunRecord = {
    runId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status,
    repositoryPath,
    baseCommit: intake.preflight.resolvedBaseCommit,
    candidate: intake.candidate,
    safetyAssessment: intake.safetyAssessment,
    budgets: config.defaultBudgets,
    policy: {
      allowedCommandClasses: config.allowedCommandClasses.filter((c) => !ALWAYS_DENIED_COMMAND_CLASSES.has(c)),
      blockedCommandClasses: [...ALWAYS_DENIED_COMMAND_CLASSES],
      networkPolicy: config.networkPolicy,
      filesystemBoundary: config.worktreeRoot,
      gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
    },
    approval: null,
    evidencePacket: null,
    auditLog,
    agentRequestId: null,
    targetedValidationCommands,
    authoritativeValidationCommands,
    sandboxContainerId: null,
    sandboxEvidence: null,
  };

  saveAutonomousRunRecord(record, config.evidenceOutputDir);

  const nextCommand = alwaysBlocked ? null : needsApproval ? "aiqt autonomous approve" : "aiqt autonomous run";

  return makeResult({
    status: alwaysBlocked ? "blocked" : "passed",
    action: "autonomous",
    summary: alwaysBlocked
      ? `Run ${runId} classified as "${intake.safetyAssessment.riskClass}" and is always blocked: ${intake.safetyAssessment.reason}`
      : needsApproval
        ? `Run ${runId} classified as "${intake.safetyAssessment.riskClass}" and requires human approval before it may proceed.`
        : `Run ${runId} classified as "${intake.safetyAssessment.riskClass}" and may proceed without approval.`,
    exitCode: alwaysBlocked ? ExitCode.WorkflowBlocked : ExitCode.Success,
    nextRecommendedCommand: nextCommand,
    data: { runId, status: record.status, safetyAssessment: intake.safetyAssessment, budgets: record.budgets, policy: record.policy },
  });
}
