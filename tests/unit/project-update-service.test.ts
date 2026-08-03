import { describe, it, expect } from "vitest";
import {
  applyUpdatePatch,
  mergeFileAndFlagPatches,
} from "../../src/services/project-update-service.js";
import { buildInitialProjectModel } from "../../src/state/project-store.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function freshProject(): ProjectModel {
  return buildInitialProjectModel({
    id: "PROJECT-001",
    name: "demo",
    objective: "",
    targetUsers: [],
    preferredAgent: null,
    createdAt: T1,
  });
}

function freshState(): StateModel {
  return buildInitialStateModel(T1);
}

describe("mergeFileAndFlagPatches", () => {
  it("lets direct flags override scalar file values", () => {
    const filePatch = { project: { objective: "From file", targetUsers: ["file-user"] } };
    const merged = mergeFileAndFlagPatches(filePatch, { objective: "From flag" });
    expect(merged.project?.objective).toBe("From flag");
    expect(merged.project?.targetUsers).toEqual(["file-user"]);
  });

  it("appends and dedupes targetUsers from flags onto file values", () => {
    const filePatch = { project: { targetUsers: ["a", "b"] } };
    const merged = mergeFileAndFlagPatches(filePatch, { targetUsers: ["b", "c"] });
    expect(merged.project?.targetUsers).toEqual(["a", "b", "c"]);
  });

  it("ignores empty-string flags", () => {
    const merged = mergeFileAndFlagPatches(undefined, { objective: "" });
    expect(merged.project?.objective).toBeUndefined();
  });

  it("preserves non-overlapping file sections untouched by flags", () => {
    const filePatch = { context: { constraints: ["local only"] } };
    const merged = mergeFileAndFlagPatches(filePatch, { objective: "New" });
    expect(merged.context?.constraints).toEqual(["local only"]);
    expect(merged.project?.objective).toBe("New");
  });
});

describe("applyUpdatePatch: scalar/context/quality merges", () => {
  it("sets objective and appends targetUsers", () => {
    const result = applyUpdatePatch(
      freshProject(),
      freshState(),
      { project: { objective: "Ship it", targetUsers: ["devs"] } },
      T2,
    );
    expect(result.projectChanged).toBe(true);
    expect(result.project.project.objective).toBe("Ship it");
    expect(result.project.project.targetUsers).toEqual(["devs"]);
    expect(result.project.project.updatedAt).toBe(T2);
    expect(result.changedFields).toContain("project.objective");
    expect(result.changedSections).toContain("project");
  });

  it("ignores empty string objective and does not mutate", () => {
    const project = freshProject();
    project.project.objective = "Existing";
    const result = applyUpdatePatch(project, freshState(), { project: { objective: undefined } }, T2);
    expect(result.projectChanged).toBe(false);
    expect(result.project.project.objective).toBe("Existing");
  });

  it("sets preferredAgent to null when explicitly requested (nullable field)", () => {
    const project = freshProject();
    project.project.preferredAgent = "claude-code";
    const result = applyUpdatePatch(project, freshState(), { project: { preferredAgent: null } }, T2);
    expect(result.projectChanged).toBe(true);
    expect(result.project.project.preferredAgent).toBeNull();
  });

  it("appends and dedupes context constraints", () => {
    const project = freshProject();
    project.context.constraints = ["existing"];
    const result = applyUpdatePatch(
      project,
      freshState(),
      { context: { constraints: ["existing", "new one"] } },
      T2,
    );
    expect(result.project.context.constraints).toEqual(["existing", "new one"]);
    expect(result.changedFields).toContain("context.constraints");
  });

  it("appends and dedupes quality.preferredValidationCommands", () => {
    const result = applyUpdatePatch(
      freshProject(),
      freshState(),
      { quality: { preferredValidationCommands: ["pnpm validate"] } },
      T2,
    );
    expect(result.project.quality.preferredValidationCommands).toEqual(["pnpm validate"]);
  });
});

describe("applyUpdatePatch: record identity, merge, and idempotency", () => {
  it("creates a new requirement with a stable generated ID and defaults", () => {
    const result = applyUpdatePatch(
      freshProject(),
      freshState(),
      { requirements: [{ title: "T", description: "D" }] },
      T2,
    );
    expect(result.createdRecordIds).toEqual(["REQ-001"]);
    const req = result.project.requirements[0];
    expect(req.priority).toBe("medium");
    expect(req.type).toBe("functional");
    expect(req.status).toBe("draft");
    expect(req.createdAt).toBe(T2);
    expect(req.updatedAt).toBe(T2);
  });

  it("updates an existing record by clientKey match without creating a duplicate", () => {
    const first = applyUpdatePatch(
      freshProject(),
      freshState(),
      { decisions: [{ clientKey: "dec-1", decision: "Use TS" }] },
      T1,
    );
    expect(first.createdRecordIds).toEqual(["D001"]);

    const second = applyUpdatePatch(
      first.project,
      first.state,
      { decisions: [{ clientKey: "dec-1", decision: "Use TS v2" }] },
      T2,
    );
    expect(second.project.decisions).toHaveLength(1);
    expect(second.updatedRecordIds).toEqual(["D001"]);
    expect(second.project.decisions[0].decision).toBe("Use TS v2");
    expect(second.project.decisions[0].createdAt).toBe(T1);
    expect(second.project.decisions[0].updatedAt).toBe(T2);
  });

  it("updates an existing record by id match", () => {
    const first = applyUpdatePatch(
      freshProject(),
      freshState(),
      { risks: [{ title: "R", description: "D" }] },
      T1,
    );
    const riskId = first.createdRecordIds[0];
    const second = applyUpdatePatch(
      first.project,
      first.state,
      { risks: [{ id: riskId, status: "mitigated" }] },
      T2,
    );
    expect(second.project.risks[0].status).toBe("mitigated");
    expect(second.updatedRecordIds).toEqual([riskId]);
  });

  it("rejects an update that references an unknown id, with no mutation", () => {
    const project = freshProject();
    expect(() =>
      applyUpdatePatch(project, freshState(), { requirements: [{ id: "REQ-999", status: "accepted" }] }, T2),
    ).toThrow(AiqtError);
    // original project object is untouched (pure function, throws before returning)
    expect(project.requirements).toHaveLength(0);
  });

  it("is idempotent: re-applying an identical clientKey patch is a no-op", () => {
    const first = applyUpdatePatch(
      freshProject(),
      freshState(),
      { assumptions: [{ clientKey: "a1", statement: "Same statement" }] },
      T1,
    );
    const second = applyUpdatePatch(
      first.project,
      first.state,
      { assumptions: [{ clientKey: "a1", statement: "Same statement" }] },
      T2,
    );
    expect(second.projectChanged).toBe(false);
    expect(second.project).toBe(first.project);
    expect(second.project.assumptions[0].updatedAt).toBe(T1);
  });

  it("is idempotent: re-applying identical records without id or clientKey matches by content fingerprint", () => {
    const patch = {
      requirements: [
        {
          title: "Capture context",
          description: "Durable project context is recorded.",
          priority: "critical" as const,
          type: "functional" as const,
          acceptanceCriteria: ["context stored"],
          status: "accepted" as const,
        },
      ],
      decisions: [{ decision: "Use one update command", reason: "Small surface", impact: "Simple" }],
      assumptions: [{ statement: "Agents run externally", source: "human" as const }],
      risks: [{ title: "Overbuild", description: "Planning arrives too early" }],
      openQuestions: [{ question: "Which heuristic first?", impact: "medium" as const }],
    };

    const first = applyUpdatePatch(freshProject(), freshState(), patch, T1);
    const second = applyUpdatePatch(first.project, first.state, patch, T2);

    expect(first.createdRecordIds).toEqual(["REQ-001", "D001", "ASM-001", "RISK-001", "Q001"]);
    expect(second.projectChanged).toBe(false);
    expect(second.project).toBe(first.project);
    expect(second.createdRecordIds).toEqual([]);
    expect(second.updatedRecordIds).toEqual([]);
  });

  it("uses explicit id, then clientKey, then fingerprint for mixed replay identity", () => {
    const first = applyUpdatePatch(
      freshProject(),
      freshState(),
      {
        requirements: [{ title: "Fingerprint req", description: "Same content" }],
        decisions: [{ clientKey: "decision-key", decision: "Original decision" }],
      },
      T1,
    );

    const second = applyUpdatePatch(
      first.project,
      first.state,
      {
        requirements: [
          { id: "REQ-001", status: "accepted" },
          { title: "Fingerprint req", description: "Same content", status: "accepted" },
          { title: "Fingerprint req", description: "Changed content" },
        ],
        decisions: [{ clientKey: "decision-key", decision: "Updated decision" }],
      },
      T2,
    );

    expect(second.project.requirements).toHaveLength(2);
    expect(second.project.requirements[0].status).toBe("accepted");
    expect(second.project.requirements[1].id).toBe("REQ-002");
    expect(second.project.decisions).toHaveLength(1);
    expect(second.project.decisions[0].decision).toBe("Updated decision");
    expect(second.createdRecordIds).toEqual(["REQ-002"]);
    expect(second.updatedRecordIds).toEqual(["REQ-001", "D001"]);
  });

  it("does not emit decision.recorded candidates for updated (only newly created) decisions", () => {
    const first = applyUpdatePatch(
      freshProject(),
      freshState(),
      { decisions: [{ clientKey: "dec-1", decision: "Use TS" }] },
      T1,
    );
    expect(first.createdDecisionIds).toEqual(["D001"]);

    const second = applyUpdatePatch(
      first.project,
      first.state,
      { decisions: [{ clientKey: "dec-1", decision: "Use TS updated" }] },
      T2,
    );
    expect(second.createdDecisionIds).toEqual([]);
    expect(second.updatedRecordIds).toEqual(["D001"]);
  });

  it("defaults decision.date to the command timestamp date when omitted", () => {
    const result = applyUpdatePatch(
      freshProject(),
      freshState(),
      { decisions: [{ decision: "Use TS" }] },
      "2026-03-15T12:00:00.000Z",
    );
    expect(result.project.decisions[0].date).toBe("2026-03-15");
  });
});

describe("applyUpdatePatch: state.nextRecommendedCommand", () => {
  it("recommends aiqt plan once planning context becomes ready", () => {
    const result = applyUpdatePatch(
      freshProject(),
      freshState(),
      {
        project: { objective: "Ship it", targetUsers: ["devs"] },
        context: { constraints: ["local only"] },
      },
      T2,
    );
    expect(result.stateChanged).toBe(true);
    expect(result.state.nextRecommendedCommand).toBe("aiqt plan");
    expect(result.planningContextReady).toBe(true);
  });

  it("does not touch workGraph", () => {
    const result = applyUpdatePatch(
      freshProject(),
      freshState(),
      { project: { objective: "Ship it", targetUsers: ["devs"] } },
      T2,
    );
    expect(result.state.workGraph).toEqual(freshState().workGraph);
  });
});
