import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildRecoveryProofImportedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { readBoundedTextFile } from "../../core/filesystem/bounded-file-input.js";
import { assertSafeParsedJson } from "../../schema/external-evidence/limits.js";
import { EvidenceGateSimulationSchema } from "../../schema/evidence-gate-simulation.schema.js";
import { RequiredGateSchema, RecoveryKindSchema, MAX_RECOVERY_PROOFS, type RequiredRuleRecoveryProof } from "../../schema/required-rule-recovery-proof.schema.js";
import { getRecoveryProofs } from "../../services/evidence-enforcement-service.js";
import { computeCanonicalPayloadDigest } from "../../schema/external-evidence/canonical-json.js";
import { nextId } from "../../state/ids.js";
import type { StateModel } from "../../schema/state.schema.js";

const MAX_REPORT_BYTES = 262144;

export interface RunEvidenceGateEnforcementRecoveryImportOptions {
  profileId?: string;
  version?: number;
  gate?: string;
  ruleId?: string;
  beforeFile?: string;
  afterFile?: string;
  recoveryKind?: string;
  preview?: boolean;
  asOf?: string;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return makeResult({
    status: exitCode === ExitCode.WorkflowBlocked ? "blocked" : "failed",
    action: "evidence",
    summary,
    exitCode,
    blockingIssues: [{ id: issueId, severity: "high", area: "evidence-gate", message: summary, agentCanFix: false }],
  });
}

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function loadReport(path: string) {
  const read = readBoundedTextFile(path, MAX_REPORT_BYTES);
  if (!read.ok) return { ok: false as const, error: read.error };
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
    assertSafeParsedJson(parsed);
  } catch (err) {
    return { ok: false as const, error: `Malformed or unsafe JSON payload: ${(err as Error).message}` };
  }
  // A simulation report may be persisted directly, or wrapped as `{ simulation: {...} }` (aiqt evidence gate simulate --output shape).
  const candidate = parsed && typeof parsed === "object" && "simulation" in (parsed as Record<string, unknown>) ? (parsed as Record<string, unknown>).simulation : parsed;
  const result = EvidenceGateSimulationSchema.safeParse(candidate);
  if (!result.success) {
    return { ok: false as const, error: `Report failed schema validation: ${result.error.issues[0]?.message ?? "invalid"}` };
  }
  return { ok: true as const, report: result.data };
}

/**
 * aiqt evidence gate enforcement recovery import --profile --version --gate
 * --rule --before --after --recovery-kind [--preview] [--json] (M30 §5.2):
 * verifies two complete M28 simulation reports (before: fail/indeterminate,
 * after: pass, same policy identity/target/rule) and persists only bounded
 * proof metadata and digests -- never the raw reports.
 */
export async function runEvidenceGateEnforcementRecoveryImport(
  ctx: CommandContext,
  options: RunEvidenceGateEnforcementRecoveryImportOptions,
): Promise<CommandResult> {
  try {
    if (!options.profileId || options.version === undefined) {
      return failure("aiqt evidence gate enforcement recovery import requires --profile <id> and --version <n>.", ExitCode.HumanInputRequired, "RECOVERY-IMPORT-NO-PROFILE");
    }
    const gateParse = RequiredGateSchema.safeParse((options.gate ?? "").replace(/-/g, "_"));
    if (!options.gate || !gateParse.success) {
      return failure("aiqt evidence gate enforcement recovery import requires --gate <checkpoint|development-review|release-review>.", ExitCode.HumanInputRequired, "RECOVERY-IMPORT-NO-GATE");
    }
    if (!options.ruleId) {
      return failure("aiqt evidence gate enforcement recovery import requires --rule <rule-id>.", ExitCode.HumanInputRequired, "RECOVERY-IMPORT-NO-RULE");
    }
    if (!options.beforeFile || !options.afterFile) {
      return failure("aiqt evidence gate enforcement recovery import requires --before <path> and --after <path>.", ExitCode.HumanInputRequired, "RECOVERY-IMPORT-NO-REPORTS");
    }
    const recoveryKindParse = RecoveryKindSchema.safeParse(options.recoveryKind);
    if (!options.recoveryKind || !recoveryKindParse.success) {
      return failure(`--recovery-kind must be one of: ${RecoveryKindSchema.options.join(", ")}.`, ExitCode.InvalidInput, "RECOVERY-IMPORT-INVALID-KIND");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "RECOVERY-IMPORT-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "RECOVERY-IMPORT-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    const before = loadReport(options.beforeFile);
    if (!before.ok) return failure(`--before: ${before.error}`, ExitCode.InvalidInput, "RECOVERY-IMPORT-BEFORE-INVALID");
    const after = loadReport(options.afterFile);
    if (!after.ok) return failure(`--after: ${after.error}`, ExitCode.InvalidInput, "RECOVERY-IMPORT-AFTER-INVALID");

    if (
      before.report.policy.policyId !== after.report.policy.policyId ||
      before.report.policy.version !== after.report.policy.version ||
      before.report.policy.digest !== after.report.policy.digest
    ) {
      return failure("Before/after reports do not reference the same policy identity and digest.", ExitCode.InvalidInput, "RECOVERY-IMPORT-POLICY-MISMATCH");
    }
    if (before.report.target.type !== after.report.target.type || before.report.target.id !== after.report.target.id) {
      return failure("Before/after reports do not reference the same simulation target.", ExitCode.InvalidInput, "RECOVERY-IMPORT-TARGET-MISMATCH");
    }

    const beforeRule = before.report.ruleResults.find((r) => r.ruleId === options.ruleId);
    const afterRule = after.report.ruleResults.find((r) => r.ruleId === options.ruleId);
    if (!beforeRule || !afterRule) {
      return failure(`Rule "${options.ruleId}" is not present in both reports.`, ExitCode.InvalidInput, "RECOVERY-IMPORT-RULE-NOT-FOUND");
    }
    if (beforeRule.result !== "fail" && beforeRule.result !== "indeterminate") {
      return failure(`--before report's rule result must be fail or indeterminate (found "${beforeRule.result}").`, ExitCode.InvalidInput, "RECOVERY-IMPORT-BEFORE-NOT-DEFICIENT");
    }
    if (afterRule.result !== "pass") {
      return failure(`--after report's rule result must be pass (found "${afterRule.result}").`, ExitCode.InvalidInput, "RECOVERY-IMPORT-AFTER-NOT-PASS");
    }

    const existingProofs = getRecoveryProofs(state);
    if (existingProofs.length >= MAX_RECOVERY_PROOFS) {
      return failure(`State/proof cap reached (max_recovery_proofs=${MAX_RECOVERY_PROOFS}).`, ExitCode.WorkflowBlocked, "RECOVERY-IMPORT-CAP-REACHED");
    }

    const gate = gateParse.data;
    const proofId = nextId("RRP", existingProofs.map((p) => p.proofId));
    const proofContent = {
      protocolVersion: "aiqt-required-rule-recovery-proof@1" as const,
      profileRef: { profileId: options.profileId, version: options.version },
      gate,
      policyDigest: before.report.policy.digest,
      ruleId: options.ruleId,
      targetRef: { type: before.report.target.type, id: before.report.target.id },
      recoveryKind: recoveryKindParse.data,
      beforeSimulationDigest: before.report.simulationDigest,
      afterSimulationDigest: after.report.simulationDigest,
      beforeResult: beforeRule.result as "fail" | "indeterminate",
      afterResult: "pass" as const,
      verifiedAt: effectiveNow,
    };
    const proofDigest = computeCanonicalPayloadDigest(proofContent);
    const newProof: RequiredRuleRecoveryProof = { proofId, ...proofContent, proofDigest };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would import recovery proof for rule ${options.ruleId} (${gate}); no state written.`,
        exitCode: ExitCode.Success,
        data: { proof: newProof, outcome: "import" },
      });
    }

    const finalState: StateModel = { ...state, requiredRuleRecoveryProofs: [...existingProofs, newProof] };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildRecoveryProofImportedEvent({
          id: nextEventId(),
          timestamp: effectiveNow,
          relatedIds: [proofId],
          data: { proofId, gate, ruleId: options.ruleId, recoveryKind: recoveryKindParse.data, proofDigest },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this import is idempotent.`,
        ExitCode.InvalidInput,
        "RECOVERY-IMPORT-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Imported recovery proof ${proofId} for rule ${options.ruleId} (${gate}).`,
      completedActions: ["Validated before/after reports", "Computed bounded proof digest", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [proofId],
      exitCode: ExitCode.Success,
      data: { proof: newProof, outcome: "import" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "RECOVERY-IMPORT-UNEXPECTED-ERROR");
  }
}
