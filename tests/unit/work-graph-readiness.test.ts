import { describe, it, expect } from "vitest";
import {
  computeWorkUnitStatus,
  computeMilestoneStatus,
} from "../../src/workflow/work-graph-readiness.js";

describe("computeWorkUnitStatus", () => {
  it("is ready when there is no incoming blocking dependency", () => {
    expect(computeWorkUnitStatus(false)).toBe("ready");
  });

  it("is planned when there is an incoming blocking dependency", () => {
    expect(computeWorkUnitStatus(true)).toBe("planned");
  });
});

describe("computeMilestoneStatus", () => {
  it("is ready when at least one child work unit is ready", () => {
    expect(computeMilestoneStatus(["planned", "ready"])).toBe("ready");
  });

  it("is planned when no child work unit is ready", () => {
    expect(computeMilestoneStatus(["planned", "planned"])).toBe("planned");
  });

  it("is ready for a single ready child", () => {
    expect(computeMilestoneStatus(["ready"])).toBe("ready");
  });
});
