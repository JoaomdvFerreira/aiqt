import { existsSync } from "node:fs";
import { familyFailureResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { Issue } from "../../core/output/issue.js";
import { readBoundedTextFile } from "../../core/filesystem/bounded-file-input.js";
import { MAX_PR_BODY_CHARS, MAX_PR_TITLE_CHARS, type PullRequestIntegrationPlan } from "../../schema/pull-request-integration.schema.js";
import { resolvePrIntegrationHome } from "../../state/pr-integration-home.js";
import { readPrIntegrationPlan } from "../../state/pr-integration-store.js";
import type { PrPreflightFinding } from "../../workflow/pr-preflight.js";

/**
 * M47-WU02: shared helpers for every `aiqt pr *` command -- failure shape,
 * bounded PR-body input, credential resolution, plan loading, and the
 * rendering of preflight findings into the existing Issue contract.
 *
 * `action: "pr"` is a new WorkflowAction; everything else here reuses the
 * repository's established owners verbatim (familyFailureResult for the
 * M33 exit/status invariant, readBoundedTextFile for external input).
 */

export function prFailure(summary: string, exitCode: number, issueId: string, extra: Partial<Issue> = {}): CommandResult {
  return familyFailureResult({ action: "pr", area: "pr", summary, exitCode, issueId, extraIssueFields: extra });
}

export function preflightFindingsToIssues(findings: readonly PrPreflightFinding[], severity: Issue["severity"]): Issue[] {
  return findings.map((f) => ({
    id: f.id,
    severity,
    area: "pr",
    message: f.message,
    suggestedAction: f.suggestedAction,
    agentCanFix: false,
  }));
}

export type LoadPrBodyOutcome = { ok: true; body: string } | { ok: false; result: CommandResult };

/** PR body text comes from a file, bounded before it is read (never an unbounded CLI argument). */
export function loadPrBody(bodyFile: string | undefined): LoadPrBodyOutcome {
  if (bodyFile === undefined) return { ok: true, body: "" };
  if (!existsSync(bodyFile)) {
    return { ok: false, result: prFailure(`Pull Request body file not found: ${bodyFile}`, ExitCode.InvalidInput, "PR-BODY-FILE-NOT-FOUND") };
  }
  const read = readBoundedTextFile(bodyFile, MAX_PR_BODY_CHARS);
  if (!read.ok) {
    return { ok: false, result: prFailure(read.error, ExitCode.InvalidInput, "PR-BODY-FILE-READ-ERROR") };
  }
  return { ok: true, body: read.text };
}

export function validateTitle(title: string): CommandResult | null {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return prFailure("Provide a non-empty --title for the Pull Request.", ExitCode.InvalidInput, "PR-TITLE-EMPTY");
  }
  if (trimmed.length > MAX_PR_TITLE_CHARS) {
    return prFailure(`--title exceeds the ${MAX_PR_TITLE_CHARS}-character limit.`, ExitCode.InvalidInput, "PR-TITLE-TOO-LONG");
  }
  return null;
}

export interface ResolvedToken {
  /** The token value. Never placed in a CommandResult, a plan, or a log. */
  token: string | null;
  envName: string;
}

/**
 * Credentials come from an operator-named environment variable only --
 * never a CLI flag (which would land in shell history and process
 * listings), never discovered, never persisted. Mirrors M40's
 * `--token-env` convention exactly.
 */
export function resolveToken(tokenEnv: string | undefined, env: NodeJS.ProcessEnv = process.env): ResolvedToken {
  const envName = tokenEnv ?? "GITHUB_TOKEN";
  const value = env[envName];
  return { token: value && value.length > 0 ? value : null, envName };
}

/** Build spec Sec 9: a clear, non-secret-leaking operator action list -- never a fabricated credential. */
export function missingPrCredentialActions(envName: string): string[] {
  return [
    `Set the "${envName}" environment variable to a GitHub token with "pull requests: write" and "contents: read" permission on the target repository.`,
    "Use a fine-grained, repository-scoped token wherever possible -- M47 needs no organization-wide access.",
    "Never pass the token as a CLI flag or commit it to any file -- environment variable only.",
    "Re-run the command once the variable is set; nothing was written.",
  ];
}

export type LoadPlanOutcome = { ok: true; plan: PullRequestIntegrationPlan; home: string } | { ok: false; result: CommandResult };

export function loadPlan(integrationId: string): LoadPlanOutcome {
  const home = resolvePrIntegrationHome();
  const result = readPrIntegrationPlan(home, integrationId);
  if (!result.ok) {
    return { ok: false, result: prFailure(result.reason, ExitCode.InvalidInput, "PR-PLAN-NOT-FOUND") };
  }
  return { ok: true, plan: result.plan, home };
}
