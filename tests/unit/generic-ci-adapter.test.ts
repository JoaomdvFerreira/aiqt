import { describe, it, expect } from "vitest";
import {
  normalizeGenericCiV1,
  computeChecksAggregate,
  reconcileCiStatus,
  mapRunStatus,
  GENERIC_CI_V1_TRUST_LEVEL,
} from "../../src/evidence/adapters/generic-ci-v1.adapter.js";
import type { GenericCiV1, Check, CiStatus } from "../../src/schema/external-evidence/generic-ci-v1.schema.js";

const NOW = "2026-01-01T00:00:00.000Z";
const DIGEST = "sha256:" + "b".repeat(64);

function check(status: CiStatus, overrides: Partial<Check> = {}): Check {
  return { checkId: `c-${status}-${Math.random()}`, name: "n", status, summary: "s", ...overrides };
}

function payload(overrides: Partial<GenericCiV1> = {}): GenericCiV1 {
  return {
    format: "generic-ci-json@1",
    source: { providerId: "prov-ci" },
    binding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1", commitSha: "abc123" },
    run: { status: "passed", completedAt: NOW, summary: "run ok" },
    checks: [],
    ...overrides,
  } as GenericCiV1;
}

describe("mapRunStatus (M23 §10 Critical rule 2 mapping table)", () => {
  it("maps every documented status, folding cancelled into partial", () => {
    expect(mapRunStatus("passed")).toBe("passed");
    expect(mapRunStatus("failed")).toBe("failed");
    expect(mapRunStatus("partial")).toBe("partial");
    expect(mapRunStatus("cancelled")).toBe("partial");
    expect(mapRunStatus("not_run")).toBe("not_run");
    expect(mapRunStatus("unknown")).toBe("unknown");
  });
});

describe("computeChecksAggregate", () => {
  it("is 'unknown' for an empty checks array", () => {
    expect(computeChecksAggregate([])).toBe("unknown");
  });
  it("is 'failed' if any check failed, regardless of others", () => {
    expect(computeChecksAggregate([check("passed"), check("failed"), check("passed")])).toBe("failed");
  });
  it("is 'partial' if any check is partial or cancelled and none failed", () => {
    expect(computeChecksAggregate([check("passed"), check("partial")])).toBe("partial");
    expect(computeChecksAggregate([check("passed"), check("cancelled")])).toBe("partial");
  });
  it("is 'passed' only when non-empty and all passed", () => {
    expect(computeChecksAggregate([check("passed"), check("passed")])).toBe("passed");
  });
  it("is 'not_run' only when non-empty and all not_run", () => {
    expect(computeChecksAggregate([check("not_run"), check("not_run")])).toBe("not_run");
  });
  it("is 'unknown' for a mix that is neither uniformly passed nor uniformly not_run nor failed/partial", () => {
    expect(computeChecksAggregate([check("passed"), check("not_run")])).toBe("unknown");
  });
});

describe("reconcileCiStatus (worked examples, M23 §10 Critical rule 2)", () => {
  it.each<[CiStatus, CiStatus, CiStatus]>([
    ["passed", "passed", "passed"],
    ["failed", "passed", "failed"],
    ["passed", "failed", "failed"],
    ["partial", "passed", "partial"],
    ["passed", "partial", "partial"],
    ["not_run", "not_run", "not_run"],
    ["passed", "not_run", "unknown"],
    ["unknown", "unknown", "unknown"],
    ["not_run", "unknown", "unknown"],
  ])("reconcile(%s, %s) = %s", (mapped, aggregate, expected) => {
    expect(reconcileCiStatus(mapped, aggregate)).toBe(expected);
  });
});

describe("normalizeGenericCiV1 (WU23-04)", () => {
  it("fixes the trust ceiling to self_reported", () => {
    const { candidate } = normalizeGenericCiV1(payload(), DIGEST);
    expect(candidate.provider.trustLevel).toBe("self_reported");
    expect(candidate.provider.trustLevel).toBe(GENERIC_CI_V1_TRUST_LEVEL);
    expect(candidate.provider.trustLevel).not.toBe("repository_local");
    expect(candidate.provider.trustLevel).not.toBe("platform_verified");
  });

  it("produces no warning and no disagreement finding when signals agree", () => {
    const { candidate, warnings } = normalizeGenericCiV1(
      payload({ run: { status: "passed", completedAt: NOW, summary: "ok" }, checks: [check("passed")] }),
      DIGEST,
    );
    expect(warnings).toEqual([]);
    expect(candidate.sourceFindings.find((f) => f.sourceFindingId === "ci-reconciliation-disagreement")).toBeUndefined();
    expect(candidate.results.reviewResult).toBe("passed");
  });

  it("produces exactly one bounded warning and one deterministic disagreement finding when signals disagree", () => {
    const { candidate, warnings } = normalizeGenericCiV1(
      payload({ run: { status: "passed", completedAt: NOW, summary: "ok" }, checks: [check("failed")] }),
      DIGEST,
    );
    expect(warnings).toHaveLength(1);
    const disagreementFindings = candidate.sourceFindings.filter((f) => f.sourceFindingId === "ci-reconciliation-disagreement");
    expect(disagreementFindings).toHaveLength(1);
    expect(disagreementFindings[0].sourceSeverityClaim).toBe("unknown");
    expect(disagreementFindings[0].sourceFixabilityClaim).toBe("external_verification");
    expect(disagreementFindings[0].scopeClaim).toBe("execution_local");
    // never silently normalizes to "passed" on disagreement
    expect(candidate.results.reviewResult).toBe("failed");
  });

  it("never silently defaults the reconciled result to 'passed' when checks are absent and run.status is 'unknown'", () => {
    const { candidate } = normalizeGenericCiV1(
      payload({ run: { status: "unknown", completedAt: NOW, summary: "?" }, checks: [] }),
      DIGEST,
    );
    expect(candidate.results.reviewResult).toBe("unknown");
  });

  it("maps a reconciled not_run result to acceptanceCriteriaResult='not_checked' (AcceptanceOutcome has no not_run member)", () => {
    const { candidate } = normalizeGenericCiV1(
      payload({ run: { status: "not_run", completedAt: NOW, summary: "s" }, checks: [check("not_run")] }),
      DIGEST,
    );
    expect(candidate.results.acceptanceCriteriaResult).toBe("not_checked");
  });

  it("never creates decision escalation candidates (generic-ci-json@1 cannot create escalations)", () => {
    const { candidate } = normalizeGenericCiV1(payload(), DIGEST);
    expect(candidate.decisionEscalationCandidates).toEqual([]);
  });

  it("collects findings and artifacts from individual checks", () => {
    const { candidate } = normalizeGenericCiV1(
      payload({
        checks: [
          check("passed", { findings: [{ findingId: "F1", title: "t", summary: "s" }] }),
          check("passed", { artifacts: [{ artifactId: "A1", kind: "log", locator: "logs/a.txt" }] }),
        ],
      }),
      DIGEST,
    );
    expect(candidate.sourceFindings.some((f) => f.sourceFindingId === "F1")).toBe(true);
    expect(candidate.artifactReferences.some((a) => a.artifactId === "A1")).toBe(true);
  });
});
