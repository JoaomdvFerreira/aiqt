import { describe, it, expect } from "vitest";
import { DefectRecordSchema, DefectStateSchema } from "../../src/schema/defect.schema.js";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { computeDefectFingerprint } from "../../src/workflow/defect-fingerprint.js";
import {
  DEFECT_TRANSITIONS,
  QUEUE_ELIGIBLE_STATUSES,
  isValidDefectTransition,
  validateDefectTransition,
} from "../../src/workflow/defect-transitions.js";

const NOW = "2026-08-08T00:00:00.000Z";

function buildDefect(overrides: Partial<Parameters<typeof DefectRecordSchema.parse>[0]> = {}) {
  return DefectRecordSchema.parse({
    defectId: "DEF-001",
    title: "Focused test failure",
    summary: "tests/unit/example.test.ts fails on assertion X",
    sourceKind: "failed_validation",
    evidenceRefs: [
      {
        evidenceRefId: "DEFEV-001",
        sourceKind: "failed_validation",
        locator: "tests/unit/example.test.ts::example fails",
        capturedAt: NOW,
      },
    ],
    fingerprint: computeDefectFingerprint({
      sourceKind: "failed_validation",
      evidenceSignature: "tests/unit/example.test.ts::example fails",
    }),
    severity: "medium",
    confidence: "confirmed",
    status: "candidate",
    freshness: { state: "current", evaluatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe("DefectRecordSchema", () => {
  it("round-trips a minimal valid defect record", () => {
    const defect = buildDefect();
    const parsed = DefectRecordSchema.safeParse(defect);
    expect(parsed.success).toBe(true);
  });

  it("rejects a record with no evidence refs", () => {
    const raw = { ...buildDefect(), evidenceRefs: [] };
    expect(DefectRecordSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const raw = { ...buildDefect(), extraField: "nope" };
    expect(DefectRecordSchema.safeParse(raw).success).toBe(false);
  });

  it("DefectStateSchema bounds the defect list to MAX_DEFECTS", () => {
    const parsed = DefectStateSchema.safeParse({ defects: [buildDefect()] });
    expect(parsed.success).toBe(true);
  });
});

describe("StateModel.defects (M42 additive canonical section)", () => {
  it("is absent on a freshly built initial state model and still validates", () => {
    const model = buildInitialStateModel(NOW);
    expect((model as Record<string, unknown>).defects).toBeUndefined();
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });

  it("validates when defects is present and populated", () => {
    const model = { ...buildInitialStateModel(NOW), defects: [buildDefect()] };
    const parsed = StateModelSchema.safeParse(model);
    expect(parsed.success).toBe(true);
  });

  it("pre-M42 state (no defects key at all) still parses -- compatibility", () => {
    const model = buildInitialStateModel(NOW) as Record<string, unknown>;
    delete model.defects;
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });
});

describe("computeDefectFingerprint", () => {
  it("is deterministic for identical structural identity", () => {
    const a = computeDefectFingerprint({ sourceKind: "failed_validation", evidenceSignature: "sig-a" });
    const b = computeDefectFingerprint({ sourceKind: "failed_validation", evidenceSignature: "sig-a" });
    expect(a).toBe(b);
  });

  it("differs for different evidence signatures", () => {
    const a = computeDefectFingerprint({ sourceKind: "failed_validation", evidenceSignature: "sig-a" });
    const b = computeDefectFingerprint({ sourceKind: "failed_validation", evidenceSignature: "sig-b" });
    expect(a).not.toBe(b);
  });

  it("differs by affected Work Unit even with identical evidence signature (no textual-only collapse)", () => {
    const a = computeDefectFingerprint({
      sourceKind: "failed_validation",
      affectedWorkUnitId: "WU42-01",
      evidenceSignature: "sig-a",
    });
    const b = computeDefectFingerprint({
      sourceKind: "failed_validation",
      affectedWorkUnitId: "WU42-02",
      evidenceSignature: "sig-a",
    });
    expect(a).not.toBe(b);
  });

  it("matches sha256: digest shape accepted by DefectRecordSchema.fingerprint", () => {
    const fp = computeDefectFingerprint({ sourceKind: "failed_validation", evidenceSignature: "sig-a" });
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("defect transitions", () => {
  it("allows every documented forward transition", () => {
    expect(isValidDefectTransition("candidate", "triaged")).toBe(true);
    expect(isValidDefectTransition("triaged", "queued")).toBe(true);
    expect(isValidDefectTransition("queued", "in_progress")).toBe(true);
    expect(isValidDefectTransition("in_progress", "resolved")).toBe(true);
    expect(isValidDefectTransition("resolved", "reopened")).toBe(true);
  });

  it("fails closed on an illegal transition", () => {
    const result = validateDefectTransition("candidate", "resolved");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Illegal defect status transition");
  });

  it("rejects a self-transition", () => {
    const result = validateDefectTransition("queued", "queued");
    expect(result.ok).toBe(false);
  });

  it("treats invalid as terminal", () => {
    expect(DEFECT_TRANSITIONS.invalid).toHaveLength(0);
  });

  it("every DefectStatus has a defined (possibly empty) transition entry", () => {
    const statuses = Object.keys(DEFECT_TRANSITIONS);
    expect(statuses.sort()).toEqual(
      [
        "candidate",
        "deferred",
        "duplicate",
        "in_progress",
        "invalid",
        "needs_human",
        "queued",
        "reopened",
        "resolved",
        "triaged",
      ].sort(),
    );
  });

  it("QUEUE_ELIGIBLE_STATUSES matches the remediation-queue-is-a-view invariant", () => {
    expect(QUEUE_ELIGIBLE_STATUSES).toEqual(["queued", "in_progress", "needs_human"]);
  });
});
