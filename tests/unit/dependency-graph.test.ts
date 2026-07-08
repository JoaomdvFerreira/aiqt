import { describe, it, expect } from "vitest";
import { findCycle } from "../../src/workflow/dependency-graph.js";

describe("findCycle", () => {
  it("returns null for an acyclic graph", () => {
    const cycle = findCycle(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );
    expect(cycle).toBeNull();
  });

  it("detects a direct two-node cycle", () => {
    const cycle = findCycle(
      ["a", "b"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("a");
    expect(cycle).toContain("b");
  });

  it("detects a longer transitive cycle", () => {
    const cycle = findCycle(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    );
    expect(cycle).not.toBeNull();
  });

  it("returns null when there are no edges", () => {
    expect(findCycle(["a", "b"], [])).toBeNull();
  });

  it("handles disconnected components without false positives", () => {
    const cycle = findCycle(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "c", to: "d" },
      ],
    );
    expect(cycle).toBeNull();
  });
});
