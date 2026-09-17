import { describe, expect, it } from "vitest";
import { computeEffectiveReviewState } from "../../src/services/effective-review-state-service.js";
import { evaluateEffectiveReviewCompletion } from "../../src/workflow/checkpoint-completion-gate.js";
import { applyCheckpointAmendment } from "../../src/services/checkpoint-amendment-service.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";

const checkpoint = (overrides: Partial<Checkpoint> = {}): Checkpoint => ({ id: "C012", workUnitId: "WU012", packetId: null, summary: "handoff", completed: ["implementation"], notCompleted: [], filesChanged: [], issues: [], validationResult: "passed", acceptanceCriteriaResult: "passed", validationCommands: [{ command: "pnpm test", result: "passed", summary: null }], acceptanceCriteria: [{ criterion: "AC", result: "passed", evidence: null }], finalWorkUnitStatus: "needs_review", nextRecommendation: "aiqt checkpoint amend", createdAt: "2026-09-17T00:00:00.000Z", ...overrides });
const workUnit = { id: "WU012", milestoneId: "M001", title: "Rumo WU012", objective: "x", scope: [], outOfScope: [], acceptanceCriteria: ["AC"], validationCommands: ["pnpm test"], dependencies: [], status: "needs_review" as const, createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z", agentContextRefs: [] };
const state = (cp = checkpoint()): StateModel => ({ version: "0.1.0", projectStatus: "review", currentMilestoneId: "M001", currentWorkUnitId: null, workGraph: { milestones: [{ id: "M001", title: "M", objective: "x", status: "in_progress", createdAt: "x", updatedAt: "x" }], workUnits: [workUnit], dependencies: [] }, checkpoints: [cp], lastAgentPacket: null, nextRecommendedCommand: null, lastUpdatedAt: "x" } as unknown as StateModel);
const complete = (cp: Checkpoint, s: StateModel) => evaluateEffectiveReviewCompletion(workUnit, computeEffectiveReviewState(cp, s));

describe("EffectiveReviewState", () => {
  it("keeps immutable handoff history while a later acceptance closes the Rumo WU012 shape", () => {
    const cp = checkpoint(); const s = state(cp); const before = JSON.stringify(cp);
    const result = applyCheckpointAmendment({ state: s, checkpoint: cp, workUnit, decision: "accepted", amendmentId: "R001", reason: "Overseer accepted.", timestamp: "2026-09-17T01:00:00.000Z" });
    expect(result.workUnitStatusAfter).toBe("done"); expect(JSON.stringify(cp)).toBe(before); expect(result.reviewRecord?.decision).toBe("accepted");
  });
  it("projects partial to passed and resolves post-handoff review requirements", () => {
    const cp = checkpoint({ acceptanceCriteriaResult: "partial", reviewRequirements: ["PR CI"] }); const s = state(cp);
    s.reviewRecords = [{ reviewId: "R1", checkpointId: cp.id, workUnitId: cp.workUnitId, acceptanceCriteriaResult: "passed", validationResult: "passed", decision: "accepted", resolvedReviewRequirements: ["PR CI"], acceptanceCriteria: [], validationCommands: [], issues: [], evidenceReferences: ["pr:7"], reason: "CI passed", recordedAt: "x", sourceCommand: "aiqt checkpoint amend" }];
    expect(complete(cp, s)).toEqual({ complete: true, reasons: [] }); expect(cp.reviewRequirements).toEqual(["PR CI"]);
  });
  it("handles supplementary validation, resolved issues, and conflicting records deterministically", () => {
    const cp = checkpoint({ issues: [{ title: "blocker", description: null, severity: "high", status: "open", agentCanFix: true }], validationCommands: [{ command: "pnpm test", result: "failed", summary: null }] }); const s = state(cp);
    s.reviewRecords = [
      { reviewId: "R1", checkpointId: cp.id, workUnitId: cp.workUnitId, decision: "partial", acceptanceCriteriaResult: "passed", validationResult: "passed", resolvedReviewRequirements: [], acceptanceCriteria: [], validationCommands: [{ command: "pnpm test", result: "passed", summary: "external CI" }], issues: [{ title: "blocker", status: "resolved" }], evidenceReferences: [], reason: "evidence", recordedAt: "x", sourceCommand: "aiqt checkpoint amend" },
      { reviewId: "R2", checkpointId: cp.id, workUnitId: cp.workUnitId, decision: "accepted", resolvedReviewRequirements: [], acceptanceCriteria: [], validationCommands: [], issues: [], evidenceReferences: [], reason: "accept", recordedAt: "y", sourceCommand: "aiqt checkpoint amend" },
    ];
    const effective = computeEffectiveReviewState(cp, s); expect(effective.validationCommands[0].result).toBe("passed"); expect(effective.issues[0].status).toBe("resolved"); expect(effective.decision).toBe("accepted"); expect(complete(cp, s).complete).toBe(true);
  });
  it("keeps genuine unfinished implementation blocking and deterministically projects legacy amendments", () => {
    const cp = checkpoint({ notCompleted: ["implement migration"] }); const s = state(cp);
    s.checkpointAmendments = [{ amendmentId: "AMEND-1", checkpointId: cp.id, workUnitId: cp.workUnitId, acceptanceCriteriaResult: "passed", validationResult: "passed", reason: "legacy", amendedAt: "x", sourceCommand: "aiqt checkpoint amend" }];
    expect(computeEffectiveReviewState(cp, s).decision).toBe("accepted"); expect(complete(cp, s).reasons).toContain("unfinished work is recorded");
  });
});
