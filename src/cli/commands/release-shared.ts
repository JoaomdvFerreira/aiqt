import { existsSync } from "node:fs";
import { readBoundedTextFile } from "../../core/filesystem/bounded-file-input.js";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../core/filesystem/stdin.js";
import { familyFailureResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { Issue, IssueSeverity } from "../../core/output/issue.js";
import { ReleaseDecisionRequestSchema, type ReleaseDecisionRequestBody } from "../../schema/release-request.schema.js";
import type { ReleaseIntentRequest } from "../../services/release-governance-service.js";
import type {
  ReleaseBlockingFinding,
  ReleaseCandidateIntegrity,
  ReleaseWarning,
} from "../../schema/release-governance.schema.js";
import type { CommandStatus } from "../../core/output/result.js";

/**
 * M40-WU03: shared input-loading, validation, and translation helpers for
 * every `aiqt release *` command. Mirrors the M37 autonomous-classify
 * --from-file/--stdin/bounded-size pattern.
 */

const MAX_RELEASE_REQUEST_BYTES = 1048576;

export function releaseFailure(summary: string, exitCode: number, issueId: string, extra: Partial<Issue> = {}): CommandResult {
  return familyFailureResult({ action: "release", area: "release", summary, exitCode, issueId, extraIssueFields: extra });
}

export interface LoadReleaseRequestOptions {
  fromFile?: string;
  stdin?: boolean;
}

export type LoadReleaseRequestOutcome = { ok: true; body: ReleaseDecisionRequestBody } | { ok: false; result: CommandResult };

export async function loadReleaseRequestBody(
  options: LoadReleaseRequestOptions,
  deps: { stdin?: StdinLike } = {},
): Promise<LoadReleaseRequestOutcome> {
  if (options.fromFile && options.stdin) {
    return { ok: false, result: releaseFailure("Provide exactly one of --from-file or --stdin.", ExitCode.InvalidInput, "RELEASE-CONFLICTING-INPUT") };
  }
  if (!options.fromFile && !options.stdin) {
    return { ok: false, result: releaseFailure("Provide release candidate input via --from-file or --stdin.", ExitCode.InvalidInput, "RELEASE-MISSING-INPUT") };
  }

  let text: string;
  if (options.fromFile) {
    if (!existsSync(options.fromFile)) {
      return { ok: false, result: releaseFailure(`Release input file not found: ${options.fromFile}`, ExitCode.InvalidInput, "RELEASE-FILE-NOT-FOUND") };
    }
    const read = readBoundedTextFile(options.fromFile, MAX_RELEASE_REQUEST_BYTES);
    if (!read.ok) {
      return { ok: false, result: releaseFailure(read.error, ExitCode.InvalidInput, "RELEASE-FILE-READ-ERROR") };
    }
    text = read.text;
  } else {
    if (isStdinInteractiveTty(deps.stdin)) {
      return { ok: false, result: releaseFailure("--stdin requires piped or redirected input.", ExitCode.InvalidInput, "RELEASE-STDIN-TTY") };
    }
    text = await readStdinText(deps.stdin);
    if (Buffer.byteLength(text, "utf8") > MAX_RELEASE_REQUEST_BYTES) {
      return { ok: false, result: releaseFailure(`stdin payload exceeds max bytes (${MAX_RELEASE_REQUEST_BYTES}).`, ExitCode.InvalidInput, "RELEASE-STDIN-TOO-LARGE") };
    }
  }

  if (text.trim() === "") {
    return { ok: false, result: releaseFailure("Received empty release input.", ExitCode.InvalidInput, "RELEASE-INPUT-EMPTY") };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, result: releaseFailure("Release input is not valid JSON.", ExitCode.InvalidInput, "RELEASE-INPUT-INVALID-JSON") };
  }

  const zresult = ReleaseDecisionRequestSchema.safeParse(parsed);
  if (!zresult.success) {
    const message = zresult.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, result: releaseFailure(`Release input failed schema validation: ${message}`, ExitCode.InvalidInput, "RELEASE-INPUT-SCHEMA-INVALID") };
  }

  return { ok: true, body: zresult.data };
}

export function toReleaseIntentRequest(cwd: string, body: ReleaseDecisionRequestBody): ReleaseIntentRequest {
  return {
    cwd,
    repositoryIdentity: body.repositoryIdentity,
    packageVersion: body.packageVersion,
    schemaVersion: body.schemaVersion ?? null,
    intendedReleaseTag: body.intendedReleaseTag,
    candidateRef: body.candidateRef,
    baseRelease: body.baseRelease ?? null,
    milestones: body.milestones.map((m) => ({ milestoneId: m.milestoneId, tag: m.tag ?? null, closureCommit: m.closureCommit ?? null })),
    ciCommit: body.ciCommit ?? null,
    ciRunIdentity: body.ciRunIdentity ?? null,
    ciStatus: body.ciStatus,
    validationEvidenceDigest: body.validationEvidenceDigest ?? null,
    securityEvidenceStatus: body.securityEvidenceStatus,
    releaseNotesDigest: body.releaseNotesDigest ?? null,
    declaredNotApplicable: body.declaredNotApplicable,
    declaredPresent: body.declaredPresent,
    riskSignals: body.riskSignals,
  };
}

export function blockingFindingToIssue(f: ReleaseBlockingFinding): Issue {
  return { id: f.id, severity: "high", area: f.area, message: f.message, agentCanFix: false };
}

export function warningToIssue(w: ReleaseWarning): Issue {
  return { id: w.id, severity: "medium" as IssueSeverity, area: w.area, message: w.message, agentCanFix: false };
}

export interface ReadinessStatusMapping {
  status: CommandStatus;
  exitCode: number;
}

/** Candidate integrity -> CommandResult status/exitCode, kept in one place so assess/validate/notes/prepare/status never disagree. */
export function mapReadinessIntegrity(integrity: ReleaseCandidateIntegrity): ReadinessStatusMapping {
  switch (integrity) {
    case "ready":
      return { status: "passed", exitCode: ExitCode.Success };
    case "ready_with_warnings":
      return { status: "warning", exitCode: ExitCode.Success };
    case "insufficient_evidence":
      return { status: "failed", exitCode: ExitCode.ValidationFailed };
    case "blocked":
      return { status: "blocked", exitCode: ExitCode.WorkflowBlocked };
  }
}
