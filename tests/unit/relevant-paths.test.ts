import { describe, it, expect } from "vitest";
import { isRelevantPath, classifyChangedPaths, normalizeRepoPath } from "../../src/tooling/relevant-paths.js";

describe("isRelevantPath (M19 §11/§12/§22.4)", () => {
  it("classifies src/** as relevant", () => {
    expect(isRelevantPath("src/workflow/effective-readiness.ts")).toBe(true);
  });

  it("classifies a CLI command definition as relevant", () => {
    expect(isRelevantPath("src/cli/register-commands.ts")).toBe(true);
  });

  it("classifies package.json as relevant", () => {
    expect(isRelevantPath("package.json")).toBe(true);
  });

  it("classifies pnpm-lock.yaml as relevant", () => {
    expect(isRelevantPath("pnpm-lock.yaml")).toBe(true);
  });

  it("classifies a CI workflow file as relevant", () => {
    expect(isRelevantPath(".github/workflows/validate.yml")).toBe(true);
  });

  it("classifies docs/governance/versioning.md as relevant (public release policy documentation)", () => {
    expect(isRelevantPath("docs/governance/versioning.md")).toBe(true);
  });

  it("classifies a pure test-only file as not relevant", () => {
    expect(isRelevantPath("tests/unit/semver.test.ts")).toBe(false);
  });

  it("classifies coverage output as not relevant", () => {
    expect(isRelevantPath("coverage/lcov.info")).toBe(false);
  });

  it("classifies an unrelated docs file as not relevant", () => {
    expect(isRelevantPath("docs/some-other-note.md")).toBe(false);
  });

  it("classifies editor configuration as not relevant", () => {
    expect(isRelevantPath(".vscode/settings.json")).toBe(false);
  });

  it("classifies README.md as relevant (M19-RC1: universal public entry point)", () => {
    expect(isRelevantPath("README.md")).toBe(true);
  });
});

describe("normalizeRepoPath (M19 §21: cross-platform path handling)", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizeRepoPath("src\\workflow\\effective-readiness.ts")).toBe("src/workflow/effective-readiness.ts");
  });

  it("strips a leading ./", () => {
    expect(normalizeRepoPath("./src/index.ts")).toBe("src/index.ts");
  });

  it("leaves an already-normalized path unchanged", () => {
    expect(normalizeRepoPath("src/index.ts")).toBe("src/index.ts");
  });
});

describe("classifyChangedPaths (M19 §22.4)", () => {
  it("splits mixed relevant and ignored paths and still detects relevance", () => {
    const result = classifyChangedPaths([
      "src/workflow/effective-readiness.ts",
      "tests/unit/effective-readiness.test.ts",
      "coverage/lcov.info",
    ]);
    expect(result.relevantChangesDetected).toBe(true);
    expect(result.relevantPaths).toEqual(["src/workflow/effective-readiness.ts"]);
    expect(result.ignoredPaths).toEqual(["coverage/lcov.info", "tests/unit/effective-readiness.test.ts"]);
  });

  it("reports relevantChangesDetected: false for a pure test-only change", () => {
    const result = classifyChangedPaths(["tests/unit/a.test.ts", "tests/integration/b.test.ts"]);
    expect(result.relevantChangesDetected).toBe(false);
    expect(result.relevantPaths).toEqual([]);
  });

  it("normalizes Windows-style path separators before classifying", () => {
    const result = classifyChangedPaths(["src\\workflow\\effective-readiness.ts"]);
    expect(result.relevantChangesDetected).toBe(true);
    expect(result.relevantPaths).toEqual(["src/workflow/effective-readiness.ts"]);
  });

  it("produces deterministic sorted output regardless of input order", () => {
    const a = classifyChangedPaths(["src/b.ts", "src/a.ts", "package.json"]);
    const b = classifyChangedPaths(["package.json", "src/a.ts", "src/b.ts"]);
    expect(a.relevantPaths).toEqual(b.relevantPaths);
    expect(a.relevantPaths).toEqual(["package.json", "src/a.ts", "src/b.ts"]);
  });

  it("excludes empty path entries", () => {
    const result = classifyChangedPaths(["", "src/a.ts", ""]);
    expect(result.relevantPaths).toEqual(["src/a.ts"]);
  });
});
