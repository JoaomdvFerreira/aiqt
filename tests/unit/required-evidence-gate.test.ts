import { describe, it, expect } from "vitest";
import { evaluateRequiredEvidenceGate } from "../../src/workflow/required-evidence-gate.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { EvidenceGatePolicy } from "../../src/schema/evidence-gate-policy.schema.js";
import type { CheckpointGateProfile } from "../../src/schema/evidence-enforcement-profile.schema.js";
import type { RequiredEvidenceException } from "../../src/schema/required-evidence-exception.schema.js";
import type { EvidenceRecord } from "../../src/schema/evidence.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const PROJECT_ID = "PROJECT-001";

function project(): ProjectModel {
  return { project: { id: PROJECT_ID, name: "P", existingRepositoryPath: null } } as unknown as ProjectModel;
}

function state(records: EvidenceRecord[]): StateModel {
  return {
    version: "1",
    projectStatus: "in_progress",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: { milestones: [], workUnits: [], dependencies: [] },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: T1,
    evidence: { records, decisionEscalations: [] },
  } as unknown as StateModel;
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: "EVD-1",
    contractVersion: "1.0",
    provider: { providerId: "human", providerType: "human", trustLevel: "repository_local" },
    workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: "C001", implementationRootId: "ROOT-001" },
    codeBinding: { capturedAt: T1, commitSha: "abc123" },
    reviewer: { reviewerType: "human", independentContext: "unknown" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    sourceFindings: [],
    decisionEscalationIds: [],
    artifactReferences: [{ artifactId: "ART-1", kind: "test_result", locator: "https://example.test/1" }],
    recordedAt: T1,
    ...overrides,
  } as unknown as EvidenceRecord;
}

const POLICY_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000".slice(0, 71);

function policy(overrides: Partial<EvidenceGatePolicy> = {}): EvidenceGatePolicy {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "release-gate",
    version: 1,
    name: "Release Gate",
    targetScopes: ["checkpoint"],
    rules: [
      { ruleId: "test-results-present", title: "T", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "fail" },
    ],
    policyDigest: POLICY_DIGEST,
    createdAt: T1,
    ...overrides,
  } as unknown as EvidenceGatePolicy;
}

function gateProfile(overrides: Partial<CheckpointGateProfile> = {}): CheckpointGateProfile {
  return {
    policyRef: { policyId: "release-gate", version: 1, digest: POLICY_DIGEST },
    bindingRequirements: { workUnit: "required" },
    onFail: "needs_review",
    onIndeterminate: "needs_review",
    onUnavailable: "needs_review",
    exceptionEligibleRuleIds: [],
    ...overrides,
  } as unknown as CheckpointGateProfile;
}

function baseParams(overrides: Partial<Parameters<typeof evaluateRequiredEvidenceGate>[0]> = {}) {
  return {
    gate: "checkpoint" as const,
    state: state([]),
    project: project(),
    targets: [{ type: "checkpoint" as const, id: "C001", relatedProjectId: PROJECT_ID, relatedWorkUnitId: "WU001" }],
    policy: policy(),
    gateProfile: gateProfile(),
    asOf: T1,
    bindingContexts: new Map([["C001", { workUnitId: "WU001" }]]),
    activeExceptions: [] as RequiredEvidenceException[],
    onFailBehavior: "needs_review" as const,
    onIndeterminateBehavior: "needs_review" as const,
    onUnavailableBehavior: "needs_review" as const,
    ...overrides,
  };
}

describe("evaluateRequiredEvidenceGate", () => {
  it("all required rules pass -> allow", () => {
    const result = evaluateRequiredEvidenceGate(baseParams({ state: state([evidence()]) }));
    expect(result.outcome).toBe("allow");
    expect(result.deficiency).toBe("none");
    expect(result.blockingRuleRefs).toHaveLength(0);
  });

  it("missing evidence with no eligible exception -> blocked", () => {
    const result = evaluateRequiredEvidenceGate(baseParams({ state: state([]) }));
    expect(result.outcome).toBe("blocked");
    expect(result.deficiency).toBe("missing");
    expect(result.blockingRuleRefs).toEqual(["checkpoint:C001:test-results-present"]);
  });

  it("missing evidence WITH a valid eligible exception -> allow, exception consumed", () => {
    const exception: RequiredEvidenceException = {
      protocolVersion: "aiqt-required-evidence-exception@1",
      exceptionId: "EXC-1",
      activationId: "ACT-1",
      gate: "checkpoint",
      scope: { projectId: PROJECT_ID, workUnitId: "WU001" },
      policyDigest: POLICY_DIGEST,
      ruleIds: ["test-results-present"],
      authorizedBy: "alice",
      reason: "known gap",
      createdAt: T1,
      expiresAt: "2026-02-01T00:00:00.000Z",
      usage: { mode: "single_use" },
      status: "active",
    };
    const result = evaluateRequiredEvidenceGate(
      baseParams({
        state: state([]),
        gateProfile: gateProfile({ exceptionEligibleRuleIds: ["test-results-present"] }),
        activeExceptions: [exception],
      }),
    );
    expect(result.outcome).toBe("allow");
    expect(result.consumedExceptionIds).toEqual(["EXC-1"]);
  });

  it("indeterminate rule with onIndeterminate=needs_review -> needs_review", () => {
    const indetPolicy = policy({
      rules: [
        { ruleId: "ci-run-present", title: "T", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "indeterminate" },
      ],
    } as never);
    const result = evaluateRequiredEvidenceGate(baseParams({ policy: indetPolicy, state: state([]) }));
    expect(result.outcome).toBe("needs_review");
    expect(result.deficiency).toBe("indeterminate");
  });

  it("indeterminate rule with onIndeterminate=block -> blocked", () => {
    const indetPolicy = policy({
      rules: [
        { ruleId: "ci-run-present", title: "T", appliesTo: ["checkpoint"], evidenceSelector: { artifactKinds: ["ci_run"], minimumTrust: "repository_local", scopeMatch: "exact_target" }, requirement: { minimumCount: 1 }, missingDisposition: "indeterminate" },
      ],
    } as never);
    const result = evaluateRequiredEvidenceGate(baseParams({ policy: indetPolicy, state: state([]), onIndeterminateBehavior: "block" }));
    expect(result.outcome).toBe("blocked");
  });

  it("a passing rule whose matched evidence uses an unaccepted provider is downgraded (provider_not_accepted, needs_review)", () => {
    const result = evaluateRequiredEvidenceGate(
      baseParams({
        state: state([evidence({ provider: { providerId: "untrusted-ci", providerType: "ci", trustLevel: "repository_local" } })]),
        gateProfile: gateProfile({ acceptedProviders: ["human", "trusted-ci"] }),
      }),
    );
    expect(result.outcome).toBe("needs_review");
    expect(result.deficiency).toBe("provider_not_accepted");
  });

  it("a passing rule whose matched evidence fails binding requirements is downgraded to invalid, bypassing any exception", () => {
    const exception: RequiredEvidenceException = {
      protocolVersion: "aiqt-required-evidence-exception@1",
      exceptionId: "EXC-1",
      activationId: "ACT-1",
      gate: "checkpoint",
      scope: { projectId: PROJECT_ID },
      policyDigest: POLICY_DIGEST,
      ruleIds: ["test-results-present"],
      authorizedBy: "alice",
      reason: "n/a",
      createdAt: T1,
      expiresAt: "2026-02-01T00:00:00.000Z",
      usage: { mode: "until_expiry" },
      status: "active",
    };
    const result = evaluateRequiredEvidenceGate(
      baseParams({
        state: state([evidence({ workflowBinding: { workUnitId: "WU999", packetId: "PKT-001", checkpointId: "C001", implementationRootId: "ROOT-001" } })]),
        gateProfile: gateProfile({ exceptionEligibleRuleIds: ["test-results-present"] }),
        activeExceptions: [exception],
      }),
    );
    expect(result.outcome).toBe("invalid");
    expect(result.deficiency).toBe("binding_mismatch");
    expect(result.consumedExceptionIds).toHaveLength(0);
  });

  it("evaluation-level unavailable (corrupted evidence data) maps through onUnavailableBehavior", () => {
    const duplicate = [evidence(), evidence()]; // duplicate evidenceId -> buildEvidenceSnapshotEntries throws
    const result = evaluateRequiredEvidenceGate(baseParams({ state: state(duplicate), onUnavailableBehavior: "block" }));
    expect(result.outcome).toBe("blocked");
    expect(result.deficiency).toBe("unavailable");
  });

  it("aggregates worst-case across multiple targets", () => {
    const result = evaluateRequiredEvidenceGate(
      baseParams({
        state: state([evidence({ workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", checkpointId: "C001", implementationRootId: "ROOT-001" } })]),
        targets: [
          { type: "checkpoint", id: "C001", relatedProjectId: PROJECT_ID, relatedWorkUnitId: "WU001" },
          { type: "checkpoint", id: "C002", relatedProjectId: PROJECT_ID, relatedWorkUnitId: "WU002" },
        ],
        bindingContexts: new Map([
          ["C001", { workUnitId: "WU001" }],
          ["C002", { workUnitId: "WU002" }],
        ]),
      }),
    );
    // C001 passes (has evidence), C002 has none -> blocked overall.
    expect(result.outcome).toBe("blocked");
  });
});
