import type { CommandContext } from "../command-context.js";
import { makeResult, errorToResult, type CommandResult } from "../../core/output/result.js";
import type { Issue } from "../../core/output/issue.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, readRunlogEventIds } from "../../state/runlog-store.js";
import { nextId } from "../../state/ids.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { readExternalEvidenceFile } from "../../evidence/external-evidence-file-input.js";
import { parseAndValidateExternalJson, EXTERNAL_INPUT_MAX_PAYLOAD_BYTES } from "../../schema/external-evidence/limits.js";
import {
  isSupportedExternalEvidenceFormat,
  getExternalEvidenceSchema,
} from "../../evidence/adapter-registry.js";
import { computeCanonicalPayloadDigest } from "../../schema/external-evidence/canonical-json.js";
import { deriveImportIdentityKey } from "../../schema/external-evidence/import-identity.js";
import { normalizeGenericEvidenceV1, UnsafeArtifactLocatorError } from "../../evidence/adapters/generic-evidence-v1.adapter.js";
import { normalizeGenericCiV1 } from "../../evidence/adapters/generic-ci-v1.adapter.js";
import { normalizeManualEvidenceV1 } from "../../evidence/adapters/manual-evidence-v1.adapter.js";
import type { NormalizedEvidenceCandidate, AdapterNormalizationResult } from "../../schema/external-evidence/normalized-evidence-candidate.js";
import { evaluateEvidenceBinding, type EvidenceBindingCurrentFacts } from "../../services/evidence-binding-service.js";
import type { EvidenceRecord } from "../../schema/evidence.schema.js";
import { getEvidenceRecords, getDecisionEscalations } from "../../services/evidence-service.js";
import { getProjectIssues, getProjectIssueTransitions } from "../../services/project-issue-service.js";
import { getIssueOverrides, getIssuePromotions } from "../../services/issue-service.js";
import { buildEvidenceImportCandidate } from "../../evidence/import-orchestrator.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunEvidenceImportOptions {
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
}

/** Test-only dependency injection point; defaults to the real process.stdin. */
export interface RunEvidenceImportDeps {
  stdin?: StdinLike;
}

function failure(summary: string, exitCode: number, issueId: string, extra?: Partial<Issue>): CommandResult {
  return makeResult({
    status: "failed",
    action: "evidence",
    summary,
    exitCode,
    blockingIssues: [{ id: issueId, severity: "high", area: "input", message: summary, agentCanFix: false, ...extra }],
  });
}

/**
 * M23 §14: `evaluateEvidenceBinding` reads only `.workflowBinding`/
 * `.codeBinding` off its `EvidenceRecord` parameter -- a full EvidenceRecord
 * does not exist yet at this point in the pipeline (identity/conflict
 * resolution hasn't run), so a minimal probe carrying just those two
 * sections is passed instead of constructing one prematurely.
 */
function evaluateCandidateBinding(
  candidate: NormalizedEvidenceCandidate,
  current: EvidenceBindingCurrentFacts,
): ReturnType<typeof evaluateEvidenceBinding> {
  const probe = {
    workflowBinding: {
      workUnitId: candidate.workflowBinding.workUnitId,
      packetId: candidate.workflowBinding.packetId,
      checkpointId: candidate.workflowBinding.checkpointId ?? undefined,
      implementationRootId: candidate.workflowBinding.implementationRootId,
    },
    codeBinding: candidate.codeBinding,
  } as Pick<EvidenceRecord, "workflowBinding" | "codeBinding"> as EvidenceRecord;
  return evaluateEvidenceBinding(probe, current);
}

function normalizeByFormat(
  format: string,
  payload: unknown,
  sourcePayloadDigest: string,
): AdapterNormalizationResult {
  switch (format) {
    case "generic-evidence-json@1":
      return { candidate: normalizeGenericEvidenceV1(payload as never, sourcePayloadDigest), warnings: [] };
    case "generic-ci-json@1":
      return normalizeGenericCiV1(payload as never, sourcePayloadDigest);
    case "manual-evidence-json@1":
      return { candidate: normalizeManualEvidenceV1(payload as never, sourcePayloadDigest), warnings: [] };
    default:
      throw new Error(`Unreachable: unsupported format '${format}'`);
  }
}

/**
 * aiqt evidence import --from-file <path> | --stdin [--preview] [--json]
 * (M23): the sole external-evidence-import boundary. Reads exactly one
 * bounded JSON document, validates it against one of the three static
 * formats, normalizes it into the M22-owned canonical contracts via
 * `buildEvidenceImportCandidate`, and either reports the resulting plan
 * (--preview, zero mutation) or persists it atomically (default) using the
 * repository's established write-then-append-runlog sequence. Never
 * executes a shell command, spawns a process, or performs network I/O.
 */
export async function runEvidenceImport(
  ctx: CommandContext,
  options: RunEvidenceImportOptions,
  deps: RunEvidenceImportDeps = {},
): Promise<CommandResult> {
  try {
    if (options.fromFile && options.stdin) {
      return failure(
        "aiqt evidence import accepts exactly one of --from-file or --stdin, not both.",
        ExitCode.InvalidInput,
        "EVIDENCE-IMPORT-CONFLICTING-INPUT",
      );
    }
    if (!options.fromFile && !options.stdin) {
      return failure(
        "aiqt evidence import requires --from-file <path> or --stdin.",
        ExitCode.HumanInputRequired,
        "EVIDENCE-IMPORT-NO-INPUT",
      );
    }

    let rawText: string;
    if (options.fromFile) {
      const read = readExternalEvidenceFile(options.fromFile);
      if (!read.ok) {
        return failure(read.error, ExitCode.InvalidInput, "EVIDENCE-IMPORT-FILE-INVALID");
      }
      rawText = read.text;
    } else {
      if (isStdinInteractiveTty(deps.stdin)) {
        return failure(
          "--stdin requires piped or redirected input.",
          ExitCode.InvalidInput,
          "EVIDENCE-IMPORT-STDIN-TTY",
        );
      }
      rawText = await readStdinText(deps.stdin);
      if (rawText.trim() === "") {
        return failure("Received empty input on stdin.", ExitCode.InvalidInput, "EVIDENCE-IMPORT-STDIN-EMPTY");
      }
      if (Buffer.byteLength(rawText, "utf8") > EXTERNAL_INPUT_MAX_PAYLOAD_BYTES) {
        return failure(
          `stdin payload exceeds max_payload_bytes (${EXTERNAL_INPUT_MAX_PAYLOAD_BYTES}).`,
          ExitCode.InvalidInput,
          "EVIDENCE-IMPORT-PAYLOAD-TOO-LARGE",
        );
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseAndValidateExternalJson(rawText);
    } catch (err) {
      return failure(
        `Malformed or unsafe JSON payload: ${(err as Error).message}`,
        ExitCode.InvalidInput,
        "EVIDENCE-IMPORT-MALFORMED",
      );
    }

    const format = parsed.format;
    if (!isSupportedExternalEvidenceFormat(format)) {
      return failure(
        `Unsupported or missing "format" ("${String(format)}"). Supported formats: generic-evidence-json@1, generic-ci-json@1, manual-evidence-json@1.`,
        ExitCode.InvalidInput,
        "EVIDENCE-IMPORT-UNSUPPORTED-FORMAT",
      );
    }

    const schema = getExternalEvidenceSchema(format);
    const schemaResult = schema.safeParse(parsed);
    if (!schemaResult.success) {
      const firstIssue = schemaResult.error.issues[0];
      return failure(
        `Payload failed ${format} schema validation${firstIssue ? ` at ${firstIssue.path.join(".") || "$"}: ${firstIssue.message}` : ""}.`,
        ExitCode.InvalidInput,
        "EVIDENCE-IMPORT-SCHEMA-INVALID",
      );
    }

    const sourcePayloadDigest = computeCanonicalPayloadDigest(parsed);

    let adapterResult: AdapterNormalizationResult;
    try {
      adapterResult = normalizeByFormat(format, schemaResult.data, sourcePayloadDigest);
    } catch (err) {
      if (err instanceof UnsafeArtifactLocatorError) {
        return failure(err.message, ExitCode.InvalidInput, "EVIDENCE-IMPORT-UNSAFE-ARTIFACT");
      }
      throw err;
    }

    const { candidate, warnings: adapterWarnings } = adapterResult;
    const identity = deriveImportIdentityKey({
      adapterId: format,
      providerId: candidate.provider.providerId,
      externalId: candidate.externalEvidenceId,
      sourcePayloadDigest,
    });

    if (!aiqtDirExists(ctx)) {
      return failure(
        "No AIQT project found. Run aiqt init to create the canonical state files.",
        ExitCode.InvalidInput,
        "EVIDENCE-IMPORT-NO-PROJECT",
      );
    }
    const { paths, state } = loadProject(ctx);

    // M23 performs no shell/git/filesystem inspection of the actual current
    // repository state (execution boundary: none) -- it cannot independently
    // confirm binding currency, so it always reports "unavailable" rather
    // than fabricating a comparison basis that could wrongly reject valid
    // evidence.
    const currentFacts: EvidenceBindingCurrentFacts = {
      workUnitId: "",
      packetId: "",
      implementationRootId: "",
      inspectable: false,
    };
    const bindingStatus = evaluateCandidateBinding(candidate, currentFacts);

    const existingEventIds = readRunlogEventIds(paths.runlogFile);
    let allocatedEventIds = [...existingEventIds];
    const nextEventId = (): string => {
      const id = nextId("EVT", allocatedEventIds);
      allocatedEventIds = [...allocatedEventIds, id];
      return id;
    };

    const timestamp = new Date().toISOString();
    const candidateResult = buildEvidenceImportCandidate({
      state,
      candidate,
      importIdentityKey: identity.importIdentityKey,
      bindingStatus,
      timestamp,
      adapterWarnings,
      nextEventId,
    });

    if (!candidateResult.ok) {
      return failure(candidateResult.error, ExitCode.InvalidInput, "EVIDENCE-IMPORT-REJECTED");
    }

    const warningIssues: Issue[] = candidateResult.warnings.map((message, i) => ({
      id: `EVIDENCE-IMPORT-WARNING-${i + 1}`,
      severity: "low",
      area: "evidence",
      message,
      agentCanFix: false,
    }));

    const planData = {
      adapterId: candidate.adapterId,
      format,
      sourcePayloadDigest,
      importIdentityKey: identity.importIdentityKey,
      importIdentityMode: identity.mode,
      bindingStatus,
      outcome: candidateResult.outcome,
      evidenceId: candidateResult.evidenceRecord.evidenceId,
      createdProjectIssueCount: candidateResult.createdProjectIssues.length,
      linkedProjectIssueCount: candidateResult.linkedProjectIssueKeys.length,
      projectIssueTransitionCount: candidateResult.projectIssueTransitions.length,
      createdDecisionEscalationCount: candidateResult.createdDecisionEscalations.length,
      linkedDecisionEscalationCount: candidateResult.linkedDecisionEscalationIds.length,
      warnings: candidateResult.warnings,
      wouldChangeState: candidateResult.changed,
      expectedRunlogEventCount: candidateResult.runlogEvents.length,
    };

    if (options.preview) {
      return makeResult({
        status: warningIssues.length > 0 ? "warning" : "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: candidateResult.changed
          ? `Preview: importing this payload would ${candidateResult.outcome === "created" ? "create" : "link"} evidence ${candidateResult.evidenceRecord.evidenceId} (${candidateResult.createdProjectIssues.length} new issue(s), ${candidateResult.createdDecisionEscalations.length} new escalation(s)).`
          : `Preview: this payload resolves to an existing import (evidence ${candidateResult.evidenceRecord.evidenceId}) -- no state change.`,
        warnings: warningIssues,
        nextRecommendedCommand: "aiqt evidence import",
        exitCode: ExitCode.Success,
        data: planData,
      });
    }

    if (!candidateResult.changed) {
      return makeResult({
        status: warningIssues.length > 0 ? "warning" : "passed",
        action: "evidence",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Evidence already imported as ${candidateResult.evidenceRecord.evidenceId} (idempotent no-op) -- no new state written.`,
        warnings: warningIssues,
        nextRecommendedCommand: null,
        exitCode: ExitCode.Success,
        data: planData,
      });
    }

    const finalState: StateModel = {
      ...state,
      evidence: {
        records: [...getEvidenceRecords(state), candidateResult.evidenceRecord],
        decisionEscalations: [...getDecisionEscalations(state), ...candidateResult.createdDecisionEscalations],
      },
      issues: {
        overrides: getIssueOverrides(state),
        promotions: getIssuePromotions(state),
        projectIssues: [...getProjectIssues(state), ...candidateResult.createdProjectIssues],
        projectIssueTransitions: [...getProjectIssueTransitions(state), ...candidateResult.projectIssueTransitions],
      },
    };

    writeStateModel(paths.stateFile, finalState);
    for (const event of candidateResult.runlogEvents) {
      appendRunlogEvent(paths.runlogFile, event);
    }

    return makeResult({
      status: warningIssues.length > 0 ? "warning" : "passed",
      action: "evidence",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Imported evidence ${candidateResult.evidenceRecord.evidenceId} (${candidateResult.createdProjectIssues.length} new issue(s), ${candidateResult.projectIssueTransitions.length} transition(s), ${candidateResult.createdDecisionEscalations.length} new escalation(s)).`,
      completedActions: [
        "Read state.json",
        `Validated payload against ${format}`,
        "Normalized into NormalizedEvidenceCandidate",
        "Resolved import identity and binding",
        "Built candidate state via M22 owners",
        "Wrote state.json",
        `Appended ${candidateResult.runlogEvents.length} runlog event(s)`,
      ],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [candidateResult.evidenceRecord.evidenceId],
      warnings: warningIssues,
      nextRecommendedCommand: null,
      exitCode: ExitCode.Success,
      data: planData,
    });
  } catch (err) {
    return errorToResult("evidence", err);
  }
}
