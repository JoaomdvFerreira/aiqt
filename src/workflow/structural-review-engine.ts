import type {
  StructuralDomainUnsupported,
  StructuralFinding,
  StructuralReviewDomain,
} from "../schema/structural-review.schema.js";
import { allStructuralDomains, isKnownStructuralDomain } from "./structural-review-domains.js";
import { resolveReviewCommit } from "./structural-review-evidence.js";
import { runOwnerMapPathValidationRule } from "./structural-rules/ownership-divergence-rules.js";
import { runDependencyCycleRule } from "./structural-rules/dependency-coupling-rules.js";
import { runResponsibilityConcentrationRule } from "./structural-rules/responsibility-concentration-rules.js";
import { runUnreferencedCommandFileRule } from "./structural-rules/dead-structural-paths-rules.js";
import { runNodeVersionConsistencyRule } from "./structural-rules/public-contract-drift-rules.js";
import { runProcessHeavyTestTimeoutRule } from "./structural-rules/test-infrastructure-rules.js";
import { runDuplicateExecutionAuthorityRule } from "./structural-rules/execution-safety-boundary-rules.js";

type DomainRule = (repoRoot: string, reviewCommit: string) => StructuralFinding[];

/**
 * Section 4/10 WU43-02: the domain -> rule-set registry. Every domain in
 * `structural-review-domains.ts` is implemented here; a domain requested
 * that is not a member of `STRUCTURAL_DOMAIN_REGISTRY` at all is reported
 * unsupported by `runStructuralReview`, never silently skipped.
 */
const DOMAIN_RULES: Readonly<Record<StructuralReviewDomain, readonly DomainRule[]>> = {
  ownership_divergence: [runOwnerMapPathValidationRule],
  dependency_coupling: [runDependencyCycleRule],
  responsibility_concentration: [runResponsibilityConcentrationRule],
  dead_structural_paths: [runUnreferencedCommandFileRule],
  public_contract_drift: [runNodeVersionConsistencyRule],
  test_infrastructure: [runProcessHeavyTestTimeoutRule],
  execution_safety_boundary: [runDuplicateExecutionAuthorityRule],
};

export interface RunStructuralReviewOptions {
  repoRoot: string;
  domains?: string[];
}

export interface RawStructuralReviewResult {
  reviewCommit: string;
  domainsRequested: StructuralReviewDomain[];
  domainsSupported: StructuralReviewDomain[];
  domainsUnsupported: StructuralDomainUnsupported[];
  findings: StructuralFinding[];
}

/**
 * Section 3.1/5.3: pure read-only orchestration -- no mutation, no
 * runlog append, no network. Offline-capable: every rule reads only
 * repository-local files. Identical repository state (same reviewCommit,
 * same tracked file contents) always produces identical raw findings,
 * since every rule is a deterministic function of that state.
 */
export function runStructuralReview(options: RunStructuralReviewOptions): RawStructuralReviewResult {
  const requested = options.domains && options.domains.length > 0 ? options.domains : allStructuralDomains();
  const domainsRequested: StructuralReviewDomain[] = [];
  const domainsSupported: StructuralReviewDomain[] = [];
  const domainsUnsupported: StructuralDomainUnsupported[] = [];

  for (const d of requested) {
    if (!isKnownStructuralDomain(d)) {
      domainsUnsupported.push({ domain: d, reason: `"${d}" is not a recognized structural review domain.` });
      continue;
    }
    domainsRequested.push(d);
    if (DOMAIN_RULES[d].length > 0) {
      domainsSupported.push(d);
    } else {
      domainsUnsupported.push({ domain: d, reason: `Domain "${d}" has no implemented rules yet.` });
    }
  }

  const reviewCommit = resolveReviewCommit(options.repoRoot);
  const findings: StructuralFinding[] = [];
  for (const domain of domainsSupported) {
    for (const rule of DOMAIN_RULES[domain]) {
      findings.push(...rule(options.repoRoot, reviewCommit));
    }
  }

  return { reviewCommit, domainsRequested, domainsSupported, domainsUnsupported, findings };
}
