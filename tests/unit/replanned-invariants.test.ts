import { describe, it, expect } from "vitest";
import { collectIntegrityFindings } from "../../src/workflow/review-rules.js";
import type { ProjectModel } from "../../src/schema/project.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Dependency } from "../../src/schema/dependency.schema.js";

const TS = "2026-01-01T00:00:00.000Z";

function baseProject(overrides: Partial<ProjectModel> = {}): ProjectModel {
  return {
    version: "1.0.0",
    project: {
      id: "PROJECT-001",
      name: "Test",
      objective: "Ship it",
      targetUsers: ["devs"],
      preferredAgent: null,
      existingRepositoryPath: null,
      createdAt: TS,
      updatedAt: TS,
    },
    context: {
      constraints: ["Local files are the source of truth"],
      nonGoals: [],
      technologyPreferences: [],
      businessRules: [],
      architectureNotes: [],
    },
    requirements: [],
    decisions: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    quality: {
      acceptanceCriteriaRequired: true,
      validationRequiredBeforeDone: true,
      preferredValidationCommands: [],
    },
    ...overrides,
  };
}

function baseState(overrides: Partial<StateModel> = {}): StateModel {
  return {
    version: "1.0.0",
    projectStatus: "in_progress",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: { milestones: [], workUnits: [], dependencies: [] },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: null,
    lastUpdatedAt: TS,
    ...overrides,
  };
}

function workUnit(overrides: Partial<WorkUnit> & { id: string }): WorkUnit {
  return {
    milestoneId: "M001",
    title: `Title ${overrides.id}`,
    objective: "o",
    scope: ["s"],
    outOfScope: ["oos"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "planned",
    dependencies: [],
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function dependency(overrides: Partial<Dependency> & { id: string; fromId: string; toId: string }): Dependency {
  return { type: "blocks", reason: null, ...overrides };
}

/**
 * A minimal graph with a replanned work unit ("WU-TARGET", replaced by
 * "WU-REPL"), an upstream unit with an incoming blocking dependency into the
 * target, and a downstream unit with an outgoing blocking dependency from the
 * target -- exercising the full boundary-rewiring invariant.
 */
function stateWithReplannedTarget(overrides: {
  replacedByWorkUnitIds?: string[];
  includeReplacementBoundary?: boolean;
} = {}): StateModel {
  const {
    replacedByWorkUnitIds = ["WU-REPL"],
    includeReplacementBoundary = true,
  } = overrides;
  const workUnits: WorkUnit[] = [
    workUnit({ id: "WU-UP", status: "done", dependencies: [] }),
    workUnit({
      id: "WU-TARGET",
      status: "replanned",
      replanReason: "Detail this further.",
      replacedByWorkUnitIds,
      dependencies: ["DEP-IN"],
    }),
    workUnit({ id: "WU-REPL", status: "ready", dependencies: includeReplacementBoundary ? ["DEP-IN-REPL"] : [] }),
    workUnit({ id: "WU-DOWN", status: "planned", dependencies: ["DEP-OUT"] }),
  ];
  const dependencies: Dependency[] = [
    dependency({ id: "DEP-IN", fromId: "WU-UP", toId: "WU-TARGET", type: "blocks" }),
    dependency({ id: "DEP-OUT", fromId: "WU-TARGET", toId: "WU-DOWN", type: "blocks" }),
  ];
  if (includeReplacementBoundary) {
    dependencies.push(dependency({ id: "DEP-IN-REPL", fromId: "WU-UP", toId: "WU-REPL", type: "blocks" }));
    dependencies.push(dependency({ id: "DEP-OUT-REPL", fromId: "WU-REPL", toId: "WU-DOWN", type: "blocks" }));
    workUnits[3] = { ...workUnits[3], dependencies: ["DEP-OUT", "DEP-OUT-REPL"] };
  }
  return baseState({
    workGraph: { milestones: [], workUnits, dependencies },
  });
}

describe("replanned structural invariants (M17-RC1 §10)", () => {
  it("reports no integrity findings for a well-formed replanned work unit with full boundary rewiring", () => {
    const state = stateWithReplannedTarget();
    const findings = collectIntegrityFindings(baseProject(), state, []);
    expect(findings.filter((f) => f.findingKey.includes("replanned"))).toHaveLength(0);
  });

  it("flags a replanned work unit with missing replacedByWorkUnitIds", () => {
    const state = stateWithReplannedTarget({ replacedByWorkUnitIds: [] });
    const findings = collectIntegrityFindings(baseProject(), state, []);
    const finding = findings.find((f) => f.findingKey === "workunit:WU-TARGET:replanned-missing-replacement-ids");
    expect(finding).toBeDefined();
    expect(finding?.blocking).toBe(true);
    expect(finding?.category).toBe("integrity");
  });

  it("flags a replanned work unit that references itself as its own replacement", () => {
    const state = stateWithReplannedTarget({ replacedByWorkUnitIds: ["WU-TARGET"] });
    const findings = collectIntegrityFindings(baseProject(), state, []);
    expect(findings.some((f) => f.findingKey === "workunit:WU-TARGET:replanned-self-reference")).toBe(true);
  });

  it("flags a replanned work unit with a duplicate replacement id", () => {
    const state = stateWithReplannedTarget({ replacedByWorkUnitIds: ["WU-REPL", "WU-REPL"] });
    const findings = collectIntegrityFindings(baseProject(), state, []);
    expect(findings.some((f) => f.findingKey === "workunit:WU-TARGET:replanned-duplicate-replacement-id")).toBe(
      true,
    );
  });

  it("flags a replanned work unit that references an unknown replacement id", () => {
    const state = stateWithReplannedTarget({ replacedByWorkUnitIds: ["WU-DOES-NOT-EXIST"] });
    const findings = collectIntegrityFindings(baseProject(), state, []);
    expect(findings.some((f) => f.findingKey === "workunit:WU-TARGET:replanned-unknown-replacement-id")).toBe(
      true,
    );
  });

  it("flags a missing boundary dependency: downstream depended on the target, but no replacement rewires to it", () => {
    const state = stateWithReplannedTarget({ includeReplacementBoundary: false });
    const findings = collectIntegrityFindings(baseProject(), state, []);
    expect(
      findings.some((f) => f.findingKey === "workunit:WU-TARGET:replanned-missing-boundary-dependency:WU-DOWN"),
    ).toBe(true);
  });

  it("does not let a malformed replanned record silently satisfy downstream readiness elsewhere", () => {
    // The readiness engine treats "replanned" (like "done") as satisfying a
    // blocking dependency -- structural findings above are the only thing
    // that catches an unrewired boundary; readiness itself won't complain.
    const state = stateWithReplannedTarget({ includeReplacementBoundary: false });
    const down = state.workGraph.workUnits.find((wu) => wu.id === "WU-DOWN")!;
    expect(down.status).toBe("planned");
    // But the integrity findings correctly flag the gap as blocking.
    const findings = collectIntegrityFindings(baseProject(), state, []);
    expect(findings.some((f) => f.blocking && f.findingKey.includes("WU-TARGET"))).toBe(true);
  });
});
