import { describe, it, expect } from "vitest";
import { computeTriageDecision, sortByQueuePriority } from "../../src/workflow/defect-triage.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

const NOW = "2026-08-08T00:00:00.000Z";

function makeDefect(overrides: Partial<DefectRecord> = {}): DefectRecord {
  return {
    defectId: "DEF-001",
    title: "t",
    summary: "s",
    sourceKind: "failed_validation",
    evidenceRefs: [{ evidenceRefId: "E1", sourceKind: "failed_validation", locator: "x", capturedAt: NOW }],
    fingerprint: "sha256:" + "a".repeat(64),
    severity: "medium",
    confidence: "confirmed",
    status: "candidate",
    freshness: { state: "current", evaluatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("computeTriageDecision", () => {
  it("is deterministic for identical inputs", () => {
    const defect = makeDefect();
    const a = computeTriageDecision({ defect, isActiveWorkUnit: false, now: NOW });
    const b = computeTriageDecision({ defect, isActiveWorkUnit: false, now: NOW });
    expect(a).toEqual(b);
  });

  it("queues a confirmed medium-severity defect", () => {
    const decision = computeTriageDecision({ defect: makeDefect(), isActiveWorkUnit: false, now: NOW });
    expect(decision.queueDisposition).toBe("queue");
    expect(decision.approvalAuthority).toBe("automation");
  });

  it("routes insufficient_evidence confidence to needs_human", () => {
    const decision = computeTriageDecision({
      defect: makeDefect({ confidence: "insufficient_evidence" }),
      isActiveWorkUnit: false,
      now: NOW,
    });
    expect(decision.queueDisposition).toBe("needs_human");
    expect(decision.approvalAuthority).toBe("human_required");
    expect(decision.evidenceGaps.length).toBeGreaterThan(0);
  });

  it("routes a critical defect with only suspected confidence to needs_human (ambiguous, not fabricated certainty)", () => {
    const decision = computeTriageDecision({
      defect: makeDefect({ severity: "critical", confidence: "suspected" }),
      isActiveWorkUnit: false,
      now: NOW,
    });
    expect(decision.queueDisposition).toBe("needs_human");
  });

  it("defers a low-severity, non-confirmed defect", () => {
    const decision = computeTriageDecision({
      defect: makeDefect({ severity: "low", confidence: "probable" }),
      isActiveWorkUnit: false,
      now: NOW,
    });
    expect(decision.queueDisposition).toBe("defer");
  });

  it("gives a confirmed blocking/critical defect deterministically higher priority than a low-severity one", () => {
    const critical = computeTriageDecision({ defect: makeDefect({ severity: "critical" }), isActiveWorkUnit: false, now: NOW });
    const low = computeTriageDecision({ defect: makeDefect({ severity: "low" }), isActiveWorkUnit: false, now: NOW });
    expect(critical.priority).toBeGreaterThan(low.priority);
  });

  it("downgrades reproducibility exactly one level for stale evidence, never silently confirming it", () => {
    const decision = computeTriageDecision({
      defect: makeDefect({ freshness: { state: "stale", evaluatedAt: NOW, reason: "superseded" } }),
      isActiveWorkUnit: false,
      now: NOW,
    });
    expect(decision.reproducibility).toBe("probable");
    expect(decision.confidence).toBe("confirmed");
    expect(decision.reasonCodes).toContain("STALE_EVIDENCE_REPRODUCIBILITY_DOWNGRADED");
  });

  it("boosts priority for active-Work-Unit relevance, recorded via reason code", () => {
    const active = computeTriageDecision({ defect: makeDefect(), isActiveWorkUnit: true, now: NOW });
    const inactive = computeTriageDecision({ defect: makeDefect(), isActiveWorkUnit: false, now: NOW });
    expect(active.priority).toBeGreaterThan(inactive.priority);
    expect(active.reasonCodes).toContain("ACTIVE_WORK_UNIT_RELEVANCE");
  });

  it("never produces a negative priority", () => {
    const decision = computeTriageDecision({
      defect: makeDefect({ severity: "info", confidence: "insufficient_evidence" }),
      isActiveWorkUnit: false,
      now: NOW,
    });
    expect(decision.priority).toBeGreaterThanOrEqual(0);
  });
});

describe("sortByQueuePriority", () => {
  function withTriage(defect: DefectRecord, priority: number, createdAt = NOW): DefectRecord {
    return {
      ...defect,
      createdAt,
      triage: {
        severity: defect.severity,
        confidence: defect.confidence,
        reproducibility: defect.confidence,
        priority,
        queueDisposition: "queue",
        approvalAuthority: "automation",
        reasonCodes: [],
        evidenceGaps: [],
        recommendedNextAction: "x",
        decidedAt: NOW,
      },
    };
  }

  it("orders strictly by priority descending", () => {
    const low = withTriage(makeDefect({ defectId: "DEF-001" }), 10);
    const high = withTriage(makeDefect({ defectId: "DEF-002" }), 90);
    const mid = withTriage(makeDefect({ defectId: "DEF-003" }), 50);
    const sorted = sortByQueuePriority([low, high, mid]);
    expect(sorted.map((d) => d.defectId)).toEqual(["DEF-002", "DEF-003", "DEF-001"]);
  });

  it("breaks ties by age (older first), never by input array order", () => {
    const newer = withTriage(makeDefect({ defectId: "DEF-002" }), 50, "2026-08-08T00:00:00.000Z");
    const older = withTriage(makeDefect({ defectId: "DEF-001" }), 50, "2026-08-01T00:00:00.000Z");
    const sortedA = sortByQueuePriority([newer, older]);
    const sortedB = sortByQueuePriority([older, newer]);
    expect(sortedA.map((d) => d.defectId)).toEqual(["DEF-001", "DEF-002"]);
    expect(sortedB.map((d) => d.defectId)).toEqual(["DEF-001", "DEF-002"]);
  });

  it("is a pure function -- repeated calls on identical input produce identical order", () => {
    const a = withTriage(makeDefect({ defectId: "DEF-001" }), 50);
    const b = withTriage(makeDefect({ defectId: "DEF-002" }), 50);
    const first = sortByQueuePriority([a, b]).map((d) => d.defectId);
    const second = sortByQueuePriority([a, b]).map((d) => d.defectId);
    expect(first).toEqual(second);
  });
});
