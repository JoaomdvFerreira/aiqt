import { describe, it, expect } from "vitest";
import { evaluateDependencyRelation, type DependencyRelationEdge } from "../../src/workflow/dependency-graph.js";

function edge(overrides: Partial<DependencyRelationEdge> = {}): DependencyRelationEdge {
  return { id: "DEP-001", fromId: "WU001", toId: "WU002", type: "blocks", ...overrides };
}

describe("evaluateDependencyRelation (M24 §8.3, Gate D new owner)", () => {
  it("detects a direct dependency in the forward direction", () => {
    const result = evaluateDependencyRelation("WU001", "WU002", [edge()]);
    expect(result.direct).toBe(true);
    expect(result.transitive).toBe(false);
    expect(result.relatedDependencyIds).toEqual(["DEP-001"]);
  });

  it("detects a direct dependency regardless of query order (direction-agnostic for conflict purposes)", () => {
    const result = evaluateDependencyRelation("WU002", "WU001", [edge()]);
    expect(result.direct).toBe(true);
  });

  it("detects a transitive dependency across two hops", () => {
    const deps = [
      edge({ id: "DEP-001", fromId: "WU001", toId: "WU002" }),
      edge({ id: "DEP-002", fromId: "WU002", toId: "WU003" }),
    ];
    const result = evaluateDependencyRelation("WU001", "WU003", deps);
    expect(result.direct).toBe(false);
    expect(result.transitive).toBe(true);
  });

  it("reports neither direct nor transitive for unrelated work units", () => {
    const deps = [edge({ id: "DEP-001", fromId: "WU001", toId: "WU002" })];
    const result = evaluateDependencyRelation("WU001", "WU099", deps);
    expect(result.direct).toBe(false);
    expect(result.transitive).toBe(false);
  });

  it("ignores relates_to edges entirely", () => {
    const deps = [edge({ type: "relates_to" })];
    const result = evaluateDependencyRelation("WU001", "WU002", deps);
    expect(result.direct).toBe(false);
    expect(result.transitive).toBe(false);
  });

  it("treats 'requires' the same as 'blocks'", () => {
    const deps = [edge({ type: "requires" })];
    expect(evaluateDependencyRelation("WU001", "WU002", deps).direct).toBe(true);
  });

  it("prefers 'direct' over 'transitive' when both a direct edge and a longer path exist", () => {
    const deps = [
      edge({ id: "DEP-001", fromId: "WU001", toId: "WU002" }),
      edge({ id: "DEP-002", fromId: "WU001", toId: "WU003" }),
      edge({ id: "DEP-003", fromId: "WU003", toId: "WU002" }),
    ];
    const result = evaluateDependencyRelation("WU001", "WU002", deps);
    expect(result.direct).toBe(true);
  });
});
