import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildEvidenceGatePolicyImportedEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { readBoundedTextFile } from "../../core/filesystem/bounded-file-input.js";
import { assertSafeParsedJson } from "../../schema/external-evidence/limits.js";
import { EvidenceGatePolicyInputSchema, MAX_POLICY_BYTES, MAX_POLICIES, MAX_VERSIONS_PER_POLICY } from "../../schema/evidence-gate-policy.schema.js";
import type { EvidenceGatePolicy } from "../../schema/evidence-gate-policy.schema.js";
import { getEvidenceGatePolicies, findPolicy, findPolicyVersions, maxPolicyVersion } from "../../services/evidence-gate-policy-service.js";
import { computePolicyDigest } from "../../workflow/evidence-gate-policy-identity.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceGatePolicyImportOptions {
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RunEvidenceGatePolicyImportDeps {
  stdin?: StdinLike;
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

/**
 * aiqt evidence gate policy import --from-file <path> | --stdin [--preview]
 * [--json] (M28 §4.2): the sole boundary for importing a bounded evidence
 * gate policy version. Enforces size/depth/prohibited-key/unknown-field
 * limits, validates artifact kinds and trust values against the canonical
 * M22 evidence owners, computes the canonical digest via the M23
 * canonical-JSON/SHA-256 owner, validates version history, and persists
 * through one candidate-state write. Never activates, evaluates, or
 * enforces anything.
 */
export async function runEvidenceGatePolicyImport(
  ctx: CommandContext,
  options: RunEvidenceGatePolicyImportOptions,
  deps: RunEvidenceGatePolicyImportDeps = {},
): Promise<CommandResult> {
  try {
    if (options.fromFile && options.stdin) {
      return failure("aiqt evidence gate policy import accepts exactly one of --from-file or --stdin, not both.", ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-CONFLICTING-INPUT");
    }
    if (!options.fromFile && !options.stdin) {
      return failure("aiqt evidence gate policy import requires --from-file <path> or --stdin.", ExitCode.HumanInputRequired, "EVIDENCE-GATE-POLICY-IMPORT-NO-INPUT");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-INVALID-AS-OF");
    }
    const effectiveNow = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    let rawText: string;
    if (options.fromFile) {
      const read = readBoundedTextFile(options.fromFile, MAX_POLICY_BYTES);
      if (!read.ok) return failure(read.error, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-FILE-INVALID");
      rawText = read.text;
    } else {
      if (isStdinInteractiveTty(deps.stdin)) {
        return failure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-STDIN-TTY");
      }
      rawText = await readStdinText(deps.stdin);
      if (rawText.trim() === "") {
        return failure("Received empty input on stdin.", ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-STDIN-EMPTY");
      }
      if (Buffer.byteLength(rawText, "utf8") > MAX_POLICY_BYTES) {
        return failure(`Input exceeds max_policy_bytes (${MAX_POLICY_BYTES}).`, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-STDIN-TOO-LARGE");
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
      assertSafeParsedJson(parsed);
    } catch (err) {
      return failure(`Malformed or unsafe JSON payload: ${(err as Error).message}`, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-MALFORMED");
    }

    const inputParse = EvidenceGatePolicyInputSchema.safeParse(parsed);
    if (!inputParse.success) {
      const firstIssue = inputParse.error.issues[0];
      return failure(
        `Policy failed schema validation${firstIssue ? ` at ${firstIssue.path.join(".") || "$"}: ${firstIssue.message}` : ""}.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-POLICY-IMPORT-SCHEMA-INVALID",
      );
    }
    const input = inputParse.data;

    const policies = getEvidenceGatePolicies(state);
    if (findPolicyVersions(input.policyId, policies).length === 0 && policies.length > 0) {
      const distinctPolicyIds = new Set(policies.map((p) => p.policyId));
      if (distinctPolicyIds.size >= MAX_POLICIES) {
        return failure(`State/policy cap reached (max_policies=${MAX_POLICIES}).`, ExitCode.WorkflowBlocked, "EVIDENCE-GATE-POLICY-IMPORT-CAP-REACHED");
      }
    }
    const existingVersions = findPolicyVersions(input.policyId, policies);
    if (existingVersions.length >= MAX_VERSIONS_PER_POLICY && !existingVersions.some((p) => p.version === input.version)) {
      return failure(`State/policy cap reached (max_versions_per_policy=${MAX_VERSIONS_PER_POLICY}).`, ExitCode.WorkflowBlocked, "EVIDENCE-GATE-POLICY-IMPORT-VERSION-CAP-REACHED");
    }

    const digest = computePolicyDigest(input);
    const existingSameVersion = findPolicy(input.policyId, input.version, policies);

    if (existingSameVersion) {
      if (existingSameVersion.policyDigest === digest) {
        return makeResult({
          status: "passed",
          action: "evidence",
          projectStatus: state.projectStatus,
          currentMilestoneId: state.currentMilestoneId,
          currentWorkUnitId: state.currentWorkUnitId,
          summary: `Policy ${input.policyId} v${input.version} was already imported with this exact content (idempotent no-op).`,
          exitCode: ExitCode.Success,
          data: { policyId: input.policyId, version: input.version, outcome: "no_op" },
        });
      }
      return failure(
        `Policy ${input.policyId} v${input.version} already exists with different content (digest conflict).`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-POLICY-IMPORT-DIGEST-CONFLICT",
      );
    }

    const currentMax = maxPolicyVersion(input.policyId, policies);
    if (input.version <= currentMax) {
      return failure(
        `Policy ${input.policyId} v${input.version} must exceed all prior versions (current max: v${currentMax}).`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-POLICY-IMPORT-VERSION-NOT-MONOTONIC",
      );
    }

    const newPolicy: EvidenceGatePolicy = {
      ...input,
      policyDigest: digest,
      createdAt: effectiveNow,
    };

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would import policy ${newPolicy.policyId} v${newPolicy.version} (${newPolicy.rules.length} rule(s)); no state written.`,
        exitCode: ExitCode.Success,
        data: { policy: newPolicy, outcome: "import" },
      });
    }

    const finalState: StateModel = {
      ...state,
      evidenceGate: { policies: [...policies, newPolicy], activePolicyRef: state.evidenceGate?.activePolicyRef },
    };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      appendRunlogEvent(
        paths.runlogFile,
        buildEvidenceGatePolicyImportedEvent({
          id: nextEventId(),
          timestamp: effectiveNow,
          relatedIds: [newPolicy.policyId],
          data: { policyId: newPolicy.policyId, version: newPolicy.version, policyDigest: newPolicy.policyDigest, ruleCount: newPolicy.rules.length },
        }),
      );
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative; retrying this import is idempotent.`,
        ExitCode.InvalidInput,
        "EVIDENCE-GATE-POLICY-IMPORT-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Imported evidence gate policy ${newPolicy.policyId} v${newPolicy.version} (${newPolicy.rules.length} rule(s)).`,
      completedActions: ["Validated policy", "Computed canonical digest", "Wrote state.json", "Appended runlog event"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [newPolicy.policyId],
      exitCode: ExitCode.Success,
      data: { policy: newPolicy, outcome: "import" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-IMPORT-UNEXPECTED-ERROR");
  }
}
