import type { StructuralReviewDomain } from "../schema/structural-review.schema.js";

/**
 * Section 4: the bounded domain registry. WU43-01 defines the registry
 * and which domains are implemented; WU43-02 adds the real rule engines.
 * A domain absent from `IMPLEMENTED_DOMAINS` is always reported as
 * explicitly unsupported (never silently skipped) by the review command.
 */
export interface StructuralDomainDescriptor {
  domain: StructuralReviewDomain;
  title: string;
  description: string;
}

export const STRUCTURAL_DOMAIN_REGISTRY: readonly StructuralDomainDescriptor[] = [
  {
    domain: "ownership_divergence",
    title: "Ownership and decision divergence",
    description: "Duplicate decision-owner implementations, stale/missing/invalid owner-map entries, ungoverned new domains.",
  },
  {
    domain: "dependency_coupling",
    title: "Dependency and coupling structure",
    description: "Dependency cycles, prohibited layer direction, provider-specific leakage into provider-neutral boundaries.",
  },
  {
    domain: "responsibility_concentration",
    title: "Responsibility concentration and module hotspots",
    description: "Measurable, repository-relative module-size/export-concentration hotspots.",
  },
  {
    domain: "dead_structural_paths",
    title: "Orphaned / stale / dead structural paths",
    description: "Tracked paths with no reachable reference, provably obsolete per current supported compatibility range.",
  },
  {
    domain: "public_contract_drift",
    title: "Public contract and documentation drift",
    description: "Drift between durable governance/public contracts (CLI machine contract, versioning invariants, owner map) and live implementation.",
  },
  {
    domain: "test_infrastructure",
    title: "Validation and test-infrastructure architecture",
    description: "Process-heavy suite concentration, repeated load/timeout failure classes, test-inventory ownership drift.",
  },
  {
    domain: "execution_safety_boundary",
    title: "Execution and safety-boundary drift",
    description: "Duplicate execution-authority paths or bypasses around established sandbox/command/network/budget owners.",
  },
];

export function isKnownStructuralDomain(value: string): value is StructuralReviewDomain {
  return STRUCTURAL_DOMAIN_REGISTRY.some((d) => d.domain === value);
}

export function allStructuralDomains(): StructuralReviewDomain[] {
  return STRUCTURAL_DOMAIN_REGISTRY.map((d) => d.domain);
}
