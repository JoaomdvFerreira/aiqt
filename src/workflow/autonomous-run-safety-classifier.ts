import type {
  AutonomousCandidate,
  AutonomousRiskClass,
  AutonomousSafetyAssessment,
  ProhibitedAreaTag,
} from "../schema/autonomous-run.schema.js";
import { RISK_CLASSES_ALWAYS_BLOCKED, RISK_CLASSES_REQUIRING_APPROVAL } from "../schema/autonomous-run.schema.js";

/**
 * M36-WU01: pure, deterministic candidate risk classification (build
 * spec Sec 6.3). This function makes a decision from data it is given
 * -- it never inspects a real repository, never runs `git status`,
 * never calls a model. WU36-02 is where a real repository-preflight
 * caller supplies the `repositoryDirty`/`baseRefResolvable` inputs this
 * function only consumes.
 *
 * Fail-closed (build spec Sec 3, "Fail-closed principle"): every branch
 * below that represents ambiguity, missing context, or an unsupported
 * shape returns a blocking risk class. There is no default/fallthrough
 * branch that returns `low_risk_autonomous` -- that risk class is only
 * ever returned by the one explicit branch where every precondition
 * holds.
 */
export interface ClassifyCandidateInput {
  candidate: AutonomousCandidate;
  repositoryDirty: boolean;
  baseRefResolvable: boolean;
  validationCommandsAvailable: boolean;
  prohibitedAreaTags: readonly ProhibitedAreaTag[];
}

const PROHIBITED_TAG_SET = new Set<string>([
  "authentication",
  "authorization",
  "cryptography",
  "secrets",
  "billing",
  "destructive_migration",
  "production_infrastructure",
  "branch_protection",
  "dependency_chain_upgrade",
  "generated_lockfile_rewrite",
]);

function hasProhibitedTag(tags: readonly ProhibitedAreaTag[]): boolean {
  return tags.some((t) => PROHIBITED_TAG_SET.has(t));
}

/**
 * Order matters: each check is evaluated independently against the same
 * input, but the FIRST matching reason below is what the assessment
 * reports -- repository/context problems are checked before prohibited-
 * area content, since "the repository can't even be inspected" is a
 * more fundamental blocker than "this specific content is prohibited."
 */
export function classifyCandidate(input: ClassifyCandidateInput): AutonomousSafetyAssessment {
  const { candidate, repositoryDirty, baseRefResolvable, validationCommandsAvailable, prohibitedAreaTags } = input;

  if (repositoryDirty) {
    return assessment("repository_dirty", prohibitedAreaTags, "Repository working tree is not clean; base state cannot be trusted.");
  }
  if (!baseRefResolvable) {
    return assessment("insufficient_context", prohibitedAreaTags, `Base ref "${candidate.baseRef}" could not be resolved.`);
  }
  if (candidate.objective.trim().length === 0 || candidate.acceptanceCriteria.length === 0) {
    return assessment("insufficient_context", prohibitedAreaTags, "Candidate is missing an objective or acceptance criteria.");
  }
  if (!validationCommandsAvailable) {
    return assessment("validation_unavailable", prohibitedAreaTags, "No validation command is available to confirm the repair.");
  }
  if (hasProhibitedTag(prohibitedAreaTags)) {
    return assessment(
      "high_risk_prohibited",
      prohibitedAreaTags,
      `Candidate touches a prohibited-by-default area: ${prohibitedAreaTags.filter((t) => PROHIBITED_TAG_SET.has(t)).join(", ")}.`,
    );
  }
  if (candidate.requestedPermissions.length > 0) {
    return assessment(
      "medium_risk_requires_approval",
      prohibitedAreaTags,
      `Candidate requests elevated permissions: ${candidate.requestedPermissions.join(", ")}.`,
    );
  }

  return assessment("low_risk_autonomous", prohibitedAreaTags, "No prohibited area, no elevated permission request, repository clean, validation available.");
}

function assessment(
  riskClass: AutonomousRiskClass,
  prohibitedAreas: readonly ProhibitedAreaTag[],
  reason: string,
): AutonomousSafetyAssessment {
  return {
    riskClass,
    prohibitedAreas: [...prohibitedAreas],
    requiredApprovals: RISK_CLASSES_REQUIRING_APPROVAL.has(riskClass) ? ["human_operator"] : [],
    commandPolicyProfile: riskClass === "low_risk_autonomous" ? "standard" : "none",
    networkPolicy: "denied",
    reason,
  };
}

/** True when this risk class must stop the run before any workspace is prepared, with no path forward regardless of approval. */
export function isAlwaysBlocked(riskClass: AutonomousRiskClass): boolean {
  return RISK_CLASSES_ALWAYS_BLOCKED.has(riskClass);
}

/** True when this risk class may proceed only after an explicit, recorded human approval event. */
export function requiresApproval(riskClass: AutonomousRiskClass): boolean {
  return RISK_CLASSES_REQUIRING_APPROVAL.has(riskClass);
}

/** True when this risk class may proceed directly to workspace preparation with no approval step. */
export function canProceedWithoutApproval(riskClass: AutonomousRiskClass): boolean {
  return !isAlwaysBlocked(riskClass) && !requiresApproval(riskClass);
}
