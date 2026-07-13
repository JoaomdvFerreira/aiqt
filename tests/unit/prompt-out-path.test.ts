import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { validateOutPath } from "../../src/services/prompt-service.js";
import { resolveAiqtPaths } from "../../src/core/filesystem/paths.js";

const root = process.platform === "win32" ? "C:\\project" : "/project";
const paths = resolveAiqtPaths(root);

describe("validateOutPath", () => {
  it("accepts a relative path under .aiqt/inputs/", () => {
    const result = validateOutPath(paths, ".aiqt/inputs/plan.prompt.md");
    expect(result).toBe(join(paths.inputsDir, "plan.prompt.md"));
  });

  it("accepts a nested relative path under .aiqt/inputs/", () => {
    const result = validateOutPath(paths, ".aiqt/inputs/sub/plan.prompt.md");
    expect(result).toBe(join(paths.inputsDir, "sub", "plan.prompt.md"));
  });

  it("rejects a path outside .aiqt/inputs/", () => {
    expect(validateOutPath(paths, ".aiqt/exports/plan.md")).toBeNull();
    expect(validateOutPath(paths, "plan.prompt.md")).toBeNull();
  });

  it("rejects the inputs directory itself (must be a file, not the dir)", () => {
    expect(validateOutPath(paths, ".aiqt/inputs")).toBeNull();
    expect(validateOutPath(paths, ".aiqt/inputs/")).toBeNull();
  });

  it("rejects a sibling directory that merely shares the inputs dir as a string prefix", () => {
    expect(validateOutPath(paths, ".aiqt/inputs-evil/plan.prompt.md")).toBeNull();
  });

  it("rejects path traversal that escapes .aiqt/inputs/", () => {
    expect(validateOutPath(paths, ".aiqt/inputs/../exports/plan.md")).toBeNull();
  });
});
