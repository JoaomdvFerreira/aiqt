import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runIssuePromote } from "../../src/cli/commands/issue-promote.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildM11FixtureState, M11_AGENT_FIXABLE_ISSUE_KEY } from "../m11-fixture.js";
import { applyCheckpointToProjectIssueTransition } from "../../src/workflow/finding-routing.js";
import { resolveEffectiveProjectIssueLifecycle } from "../../src/services/project-issue-service.js";
import { getIssueOverrides, getIssuePromotions } from "../../src/services/issue-service.js";
import type { StateModel } from "../../src/schema/state.schema.js";

function readState(dir: string): StateModel {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

describe("M22-WU09: classification, promotion, and compatibility integration", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("promotion remains deduplicated by issueKey across a CheckpointIssue -> ProjectIssue transition (no duplicate repair work unit)", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);

    const first = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
      validationCommands: ["pnpm test"],
    });
    expect(first.exitCode).toBe(ExitCode.Success);
    const firstWorkUnitId = (first.data as { workUnitId: string }).workUnitId;
    const workUnitCountAfterFirstPromotion = readState(dir).workGraph.workUnits.length;

    // Compute a transition for the SAME canonical issueKey (in-memory only
    // -- M22 adds no command that persists this yet). The transition must
    // preserve the issueKey unchanged, which is the exact mechanism that
    // keeps the existing, untouched promotion pipeline deduplicated.
    const state = readState(dir);
    const transitionResult = applyCheckpointToProjectIssueTransition({
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      checkpointId: "C002",
      checkpointIssueRef: M11_AGENT_FIXABLE_ISSUE_KEY,
      reason: "scope_expanded",
      evidenceIds: [],
      existingProjectIssues: state.issues?.projectIssues ?? [],
      existingTransitions: state.issues?.projectIssueTransitions ?? [],
      timestamp: "2026-01-02T00:00:00.000Z",
      nextProjectIssueId: "PI-001",
      nextTransitionId: "PIT-001",
      projectIssueSeedFields: {
        title: "Form error wrappers",
        description: "Escalated to project scope",
        severity: "medium",
        sourceType: "checkpoint",
        sourceRefs: [],
        affectedWorkUnitIds: ["WU002"],
        affectedMilestoneIds: [],
        evidenceIds: [],
        checkpointRefs: ["C002"],
        ownerRef: null,
        promotionRefs: [],
      },
    });
    expect(transitionResult.projectIssue.issueKey).toBe(M11_AGENT_FIXABLE_ISSUE_KEY);
    expect(transitionResult.transition?.issueKey).toBe(M11_AGENT_FIXABLE_ISSUE_KEY);

    // Re-promoting the same issueKey after the transition still finds the
    // SAME existing promotion/work unit -- the transition never touched
    // state.issues.promotions, and promotion lookup is purely a function
    // of issueKey.
    const second = runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "A different title, ignored on idempotent replay",
      reason: "Different reason too.",
      validationCommands: ["pnpm test"],
    });
    expect(second.exitCode).toBe(ExitCode.Success);
    const secondData = second.data as { alreadyPromoted: boolean; workUnitId: string };
    expect(secondData.alreadyPromoted).toBe(true);
    expect(secondData.workUnitId).toBe(firstWorkUnitId);

    // No new work unit was created by the second (idempotent) promotion
    // call, whether or not a ProjectIssue transition happened in between --
    // the transition never touches state.issues.promotions or
    // workGraph.workUnits.
    const finalState = readState(dir);
    expect(finalState.workGraph.workUnits.length).toBe(workUnitCountAfterFirstPromotion);
    expect(finalState.workGraph.workUnits.filter((wu) => wu.id === firstWorkUnitId)).toHaveLength(1);
  });

  it("resolveEffectiveProjectIssueLifecycle produces identical results for a CheckpointIssue-origin key whether queried before or after promotion", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);
    const before = readState(dir);
    expect(
      resolveEffectiveProjectIssueLifecycle(
        M11_AGENT_FIXABLE_ISSUE_KEY,
        getIssueOverrides(before),
        getIssuePromotions(before),
      ),
    ).toBe("active");

    runIssuePromote(contextFor(dir), {
      issueKey: M11_AGENT_FIXABLE_ISSUE_KEY,
      title: "Repair form error wrappers",
      reason: "Cleanup remaining wrappers.",
      validationCommands: ["pnpm test"],
    });

    const after = readState(dir);
    expect(
      resolveEffectiveProjectIssueLifecycle(
        M11_AGENT_FIXABLE_ISSUE_KEY,
        getIssueOverrides(after),
        getIssuePromotions(after),
      ),
    ).toBe("promoted");
  });

  it("aiqt status behavior (exit code, projectStatus, nextRecommendedCommand) is unchanged whether or not M22 evidence/ProjectIssue state is present", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);

    const withoutM22State = runStatus(contextFor(dir, true));

    // Inject valid-but-unused M22 state directly (no AIQT command writes
    // it yet, per M22 §4 -- no required new public command).
    const state = readState(dir);
    const withM22 = {
      ...state,
      evidence: { records: [], decisionEscalations: [] },
      issues: { overrides: state.issues?.overrides ?? [], promotions: state.issues?.promotions ?? [], projectIssues: [], projectIssueTransitions: [] },
    };
    const statePath = join(dir, ".aiqt", "state.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(statePath, JSON.stringify(withM22, null, 2));

    const withM22State = runStatus(contextFor(dir, true));

    expect(withM22State.exitCode).toBe(withoutM22State.exitCode);
    expect(withM22State.projectStatus).toBe(withoutM22State.projectStatus);
    expect(withM22State.nextRecommendedCommand).toBe(withoutM22State.nextRecommendedCommand);
  });

  it("aiqt manage behavior is unchanged whether or not M22 evidence/ProjectIssue state is present", async () => {
    dir = makeTempDir();
    await buildM11FixtureState(dir);

    const withoutM22State = runManage(contextFor(dir, true));

    const state = readState(dir);
    const withM22 = {
      ...state,
      evidence: { records: [], decisionEscalations: [] },
      issues: { overrides: state.issues?.overrides ?? [], promotions: state.issues?.promotions ?? [], projectIssues: [], projectIssueTransitions: [] },
    };
    const statePath = join(dir, ".aiqt", "state.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(statePath, JSON.stringify(withM22, null, 2));

    const withM22State = runManage(contextFor(dir, true));

    expect(withM22State.exitCode).toBe(withoutM22State.exitCode);
    expect(withM22State.nextRecommendedCommand).toBe(withoutM22State.nextRecommendedCommand);
  });

  it("a SourceFinding's severity/fixability claims never set ProjectIssue.severity -- it is always caller-controlled and independent", () => {
    // Two ProjectIssues are seeded from findings that would carry
    // IDENTICAL source claims (both "critical"/"agent_fixable"), yet the
    // caller assigns different canonical severities -- proving nothing in
    // this milestone auto-copies a claim field into canonical severity.
    const seedA = {
      title: "A",
      description: "d",
      severity: "low" as const,
      sourceType: "evidence" as const,
      sourceRefs: [],
      affectedWorkUnitIds: [],
      affectedMilestoneIds: [],
      evidenceIds: [],
      checkpointRefs: [],
      ownerRef: null,
      promotionRefs: [],
    };
    const resultA = applyCheckpointToProjectIssueTransition({
      issueKey: "checkpoint:WU010:issue:a",
      checkpointId: "C010",
      checkpointIssueRef: "checkpoint:WU010:issue:a",
      reason: "manual_escalation",
      evidenceIds: [],
      existingProjectIssues: [],
      existingTransitions: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      nextProjectIssueId: "PI-010",
      nextTransitionId: "PIT-010",
      projectIssueSeedFields: seedA,
    });
    const resultB = applyCheckpointToProjectIssueTransition({
      issueKey: "checkpoint:WU011:issue:b",
      checkpointId: "C011",
      checkpointIssueRef: "checkpoint:WU011:issue:b",
      reason: "manual_escalation",
      evidenceIds: [],
      existingProjectIssues: [],
      existingTransitions: [],
      timestamp: "2026-01-01T00:00:00.000Z",
      nextProjectIssueId: "PI-011",
      nextTransitionId: "PIT-011",
      projectIssueSeedFields: { ...seedA, title: "B", severity: "critical" },
    });
    // Same "source claim" scenario, caller-chosen severities differ and
    // are respected exactly as given -- there is no derivation path.
    expect(resultA.projectIssue.severity).toBe("low");
    expect(resultB.projectIssue.severity).toBe("critical");
  });
});
