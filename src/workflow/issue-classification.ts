import type { CheckpointIssue } from "../schema/checkpoint.schema.js";

/**
 * M10 §8.2/§8.3: deterministic text heuristics that fill classification gaps
 * left by `CheckpointIssue.agentCanFix`. Heuristics never override
 * `agentCanFix === false` (an issue explicitly marked not agent-fixable is
 * NEVER classified as agent-fixable, regardless of keyword matches).
 */

/** Explicit user-action / live-setup / credentials / dashboard / deployment / legal wording (§8.3). */
const USER_ACTION_KEYWORDS: readonly string[] = [
  "user action",
  "user-owned",
  "user owned",
  "requires user",
  "user must",
  "manual setup",
  "manually configure",
  "credential",
  "api key",
  "dashboard",
  "branch protection",
  "legal review",
  "privacy review",
  "gdpr",
  "compliance review",
  "smoke test",
  "deployment",
  "deploy to production",
  "docker",
  "environment variable",
  "env var",
  "production environment",
  "live verification",
  "live smoke",
];

/** Live/external-service verification wording (§8.3). */
const EXTERNAL_VERIFICATION_KEYWORDS: readonly string[] = [
  "supabase",
  "clerk",
  "resend",
  "sentry",
  "vercel",
  "storage",
  "live",
  "smoke test",
  "deployment",
  "webhook delivery",
  "email delivery",
  "production verification",
  "runtime verification",
  "third-party",
  "external service",
];

/** Explicit release-blocking wording, independent of severity (§8.3). */
const RELEASE_CRITICAL_KEYWORDS: readonly string[] = [
  "branch protection",
  "ci enforcement",
  "legal review",
  "privacy review",
  "gdpr",
  "compliance",
  "deployment blocker",
  "release blocker",
  "must be resolved before release",
  "production readiness",
];

/**
 * §8.4: must NOT count as user-action-required by default. An issue
 * matching one of these is only user-action-required if it ALSO matches an
 * explicit user-action keyword (the exclusion is overridden by an explicit
 * signal, never the other way around).
 */
const NON_USER_ACTION_KEYWORDS: readonly string[] = [
  "scope note",
  "out of scope",
  "trade-off",
  "tradeoff",
  "i18n",
  "internationalization",
  "fixed-dictionary",
  "fixed dictionary",
  "audit scope",
  "audit-scope",
  "internal optimization",
  "optimization note",
  "nice to have",
  "nice-to-have",
  "future enhancement",
];

function textOf(issue: CheckpointIssue): string {
  return `${issue.title} ${issue.description ?? ""}`.toLowerCase();
}

function matchesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

export interface IssueClassification {
  userActionRequired: boolean;
  externalVerificationGap: boolean;
  agentFixable: boolean;
  releaseBlocking: boolean;
  backlogCandidate: boolean;
}

/**
 * Classify a single open-or-resolved checkpoint issue into the M10 §8.3
 * buckets. Buckets are not mutually exclusive -- the same issue can be both
 * user-action-required and a release blocker, for example.
 */
export function classifyCheckpointIssue(issue: CheckpointIssue): IssueClassification {
  const text = textOf(issue);

  const matchesExplicitUserAction = matchesAny(text, USER_ACTION_KEYWORDS);
  const matchesExternalVerification = matchesAny(text, EXTERNAL_VERIFICATION_KEYWORDS);
  const matchesReleaseCritical = matchesAny(text, RELEASE_CRITICAL_KEYWORDS);
  const matchesExclusion = matchesAny(text, NON_USER_ACTION_KEYWORDS);

  // §8.2 precedence: agentCanFix === false is itself sufficient signal that
  // an issue needs a human, UNLESS the text is a known non-user-action
  // pattern (scope note, trade-off, i18n limitation, audit-scope note,
  // internal optimization) with no explicit user-action wording overriding it.
  const userActionRequired = matchesExclusion
    ? matchesExplicitUserAction
    : issue.agentCanFix === false || matchesExplicitUserAction;

  const externalVerificationGap = matchesExternalVerification;

  // agentCanFix === false is authoritative and final: never agent-fixable.
  // agentCanFix === true may still be overridden by a strong external
  // verification / explicit user-action signal.
  const agentFixable =
    issue.agentCanFix === true && !matchesExplicitUserAction && !matchesExternalVerification;

  const isOpen = issue.status === "open";
  const releaseBlocking =
    isOpen &&
    (matchesReleaseCritical ||
      (issue.severity !== "low" && (userActionRequired || externalVerificationGap)));

  const backlogCandidate =
    isOpen && !releaseBlocking && (issue.severity === "low" || issue.severity === "medium");

  return {
    userActionRequired,
    externalVerificationGap,
    agentFixable,
    releaseBlocking,
    backlogCandidate,
  };
}
