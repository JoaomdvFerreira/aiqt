import { describe, it, expect } from "vitest";
import { classifyValidationCommand, classifyValidationCommands } from "../../src/workflow/execution-validation-classifier.js";

describe("execution-validation-classifier (M39-WU04)", () => {
  it("classifies static structural commands", () => {
    expect(classifyValidationCommand("pnpm typecheck")).toBe("static");
    expect(classifyValidationCommand("pnpm lint")).toBe("static");
    expect(classifyValidationCommand("pnpm build")).toBe("static");
    expect(classifyValidationCommand("tsc --noEmit")).toBe("static");
    expect(classifyValidationCommand("eslint .")).toBe("static");
  });

  it("classifies bare/whole-suite commands as full (conservatively, repository-wide)", () => {
    expect(classifyValidationCommand("pnpm test")).toBe("full");
    expect(classifyValidationCommand("pnpm validate")).toBe("full");
    expect(classifyValidationCommand("vitest run")).toBe("full");
    expect(classifyValidationCommand("vitest")).toBe("full");
  });

  it("classifies a scoped vitest invocation as focused, never as the whole suite", () => {
    expect(classifyValidationCommand("vitest run tests/unit/execution-guidance.test.ts")).toBe("focused");
  });

  it("classifies explicit impacted/milestone keywords", () => {
    expect(classifyValidationCommand("run impacted tests for this change")).toBe("impacted");
    expect(classifyValidationCommand("run milestone regression suite")).toBe("milestone");
  });

  it("never guesses an unknown command into a lenient tier -- defaults to unclassified", () => {
    expect(classifyValidationCommand("make check")).toBe("unclassified");
    expect(classifyValidationCommand("./scripts/custom-check.sh")).toBe("unclassified");
    expect(classifyValidationCommand("")).toBe("unclassified");
  });

  it("classifyValidationCommands maps a list preserving order and pairing each command with its tier", () => {
    const result = classifyValidationCommands(["pnpm test", "pnpm build"]);
    expect(result).toEqual([
      { command: "pnpm test", tier: "full" },
      { command: "pnpm build", tier: "static" },
    ]);
  });
});
