import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyValidationProfile } from "../../src/tooling/validation-profile.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const testsDir = join(repoRoot, "tests");

describe("IH-05: validation-profile classification is fail-closed", () => {
  it("classifies an all-docs change as docs-only", () => {
    const decision = classifyValidationProfile([
      "docs/archive/infrastructure/ci-test-portfolio-rationalization/ih01-baseline.md",
      "docs/governance/test-rationalization-policy.md",
    ]);
    expect(decision.profile).toBe("docs-only");
    expect(decision.disqualifyingPaths).toEqual([]);
  });

  it("falls back to full when the changed-path list is empty (an unresolved diff must never skip tests)", () => {
    expect(classifyValidationProfile([]).profile).toBe("full");
    expect(classifyValidationProfile(["", "  "]).profile).toBe("full");
  });

  it("a single non-docs path disqualifies the whole change, however many docs paths accompany it", () => {
    const decision = classifyValidationProfile([
      "docs/a.md",
      "docs/b.md",
      "src/cli/commands/status.command.ts",
      "docs/c.md",
    ]);
    expect(decision.profile).toBe("full");
    expect(decision.disqualifyingPaths).toEqual(["src/cli/commands/status.command.ts"]);
  });

  it("every governed non-docs surface forces full validation", () => {
    for (const path of [
      "src/index.ts",
      "src/schema/state.schema.ts",
      "tests/unit/versioning.test.ts",
      "tests/cli-runner.ts",
      "tests/global-setup.ts",
      "vitest.config.ts",
      ".github/workflows/validate.yml",
      "package.json",
      "pnpm-lock.yaml",
      "eslint.config.js",
      "tsconfig.json",
      "README.md",
      "AGENTS.md",
      "CLAUDE.md",
      ".gitignore",
      "some-new-top-level-thing",
    ]) {
      expect(classifyValidationProfile([path]).profile, path).toBe("full");
    }
  });

  it("a path that merely starts with the letters 'docs' is not a docs path", () => {
    expect(classifyValidationProfile(["docsite/index.md"]).profile).toBe("full");
    expect(classifyValidationProfile(["docs.md"]).profile).toBe("full");
  });

  it("normalizes Windows separators and ./ prefixes before deciding", () => {
    expect(classifyValidationProfile(["docs\\governance\\versioning.md"]).profile).toBe("docs-only");
    expect(classifyValidationProfile(["./docs/a.md"]).profile).toBe("docs-only");
    expect(classifyValidationProfile(["src\\index.ts"]).profile).toBe("full");
  });
});

/**
 * The docs-only profile is only sound while no test reads this
 * repository's own docs/ tree as an input. That is true today -- the
 * structural-review, owner-map, workflow and versioning suites all build
 * their fixtures in temp directories -- and this guard is what keeps it
 * true. A new test that reads tracked docs/ content fails here, forcing a
 * reviewed decision, instead of silently making a docs-only PR skip the
 * test that would have caught its own change.
 */
describe("IH-05: no test reads this repository's own docs/ tree", () => {
  const KNOWN_REPO_DOCS_REFERENCING_FILES = [
    // Both WRITE generated evidence into docs/engineering/; neither asserts
    // on tracked documentation content.
    "tests/integration/autonomous-controlled-pilot.test.ts",
    "tests/integration/autonomous-run-dogfood-pilot.test.ts",
  ].sort();

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith(".test.ts")) out.push(full);
    }
    return out;
  }

  it("matches the reviewed baseline exactly", () => {
    const offenders: string[] = [];
    for (const file of walk(testsDir)) {
      const text = readFileSync(file, "utf8");
      // A reference to the real repository's docs/ tree specifically --
      // fixture paths built from a temp dir are not repoRoot-anchored.
      if (/repoRoot,\s*["']docs["']/.test(text)) {
        offenders.push(relative(repoRoot, file).split("\\").join("/"));
      }
    }
    expect(
      offenders.sort(),
      "A test now references this repository's own docs/ tree. The docs-only " +
        "validation profile in src/tooling/validation-profile.ts skips the test " +
        "suite for changes confined to docs/; that is only safe while no test " +
        "reads tracked documentation as an input. Either keep the reference " +
        "write-only and add it to this baseline deliberately, or narrow the " +
        "docs-only allowlist.",
    ).toEqual(KNOWN_REPO_DOCS_REFERENCING_FILES);
  });
});
