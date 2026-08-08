import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { makeTempDir, removeDir } from "../helpers.js";
import { runOwnerMapPathValidationRule, runDuplicateDecisionOwnerRule } from "../../src/workflow/structural-rules/ownership-divergence-rules.js";
import { runDependencyCycleRule } from "../../src/workflow/structural-rules/dependency-coupling-rules.js";
import { runResponsibilityConcentrationRule } from "../../src/workflow/structural-rules/responsibility-concentration-rules.js";
import { runUnreferencedCommandFileRule } from "../../src/workflow/structural-rules/dead-structural-paths-rules.js";
import { runNodeVersionConsistencyRule } from "../../src/workflow/structural-rules/public-contract-drift-rules.js";
import { runDuplicateExecutionAuthorityRule } from "../../src/workflow/structural-rules/execution-safety-boundary-rules.js";
import { runProcessHeavyTestTimeoutRule } from "../../src/workflow/structural-rules/test-infrastructure-rules.js";

const COMMIT = "c".repeat(40);

function writeFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

describe("structural review rules (fixture-based, no live-repo dependency)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) removeDir(dir);
  });

  describe("runOwnerMapPathValidationRule", () => {
    it("flags a missing primary path", () => {
      dir = makeTempDir();
      writeFile(
        dir,
        "docs/governance/repository-owner-map.json",
        JSON.stringify({ protocolVersion: "x@1", entries: { fooOwner: { primary: "src/does-not-exist.ts", supporting: [] } } }),
      );
      const findings = runOwnerMapPathValidationRule(dir, COMMIT);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe("owner-map-path-missing");
      expect(findings[0].confidence).toBe("proven");
    });

    it("reports nothing when all paths exist", () => {
      dir = makeTempDir();
      writeFile(dir, "src/real.ts", "export const x = 1;");
      writeFile(
        dir,
        "docs/governance/repository-owner-map.json",
        JSON.stringify({ protocolVersion: "x@1", entries: { fooOwner: { primary: "src/real.ts", supporting: [] } } }),
      );
      expect(runOwnerMapPathValidationRule(dir, COMMIT)).toHaveLength(0);
    });
  });

  describe("runDuplicateDecisionOwnerRule", () => {
    it("flags a file outside the owner's primary+supporting set that re-exports the same governed symbol name", () => {
      dir = makeTempDir();
      writeFile(dir, "src/owner.ts", "export function decide() { return 1; }");
      writeFile(dir, "src/rogue.ts", "export function decide() { return 2; }");
      writeFile(
        dir,
        "docs/governance/repository-owner-map.json",
        JSON.stringify({ protocolVersion: "x@1", entries: { decisionOwner: { primary: "src/owner.ts", supporting: [] } } }),
      );
      const findings = runDuplicateDecisionOwnerRule(dir, COMMIT);
      expect(findings).toHaveLength(1);
      expect(findings[0].confidence).toBe("strong_signal");
      expect(findings[0].affectedPaths.sort()).toEqual(["src/owner.ts", "src/rogue.ts"]);
    });

    it("does not flag the owner's own declared supporting file", () => {
      dir = makeTempDir();
      writeFile(dir, "src/owner.ts", "export function decide() { return 1; }");
      writeFile(dir, "src/support.ts", "export function decide() { return 1; }");
      writeFile(
        dir,
        "docs/governance/repository-owner-map.json",
        JSON.stringify({ protocolVersion: "x@1", entries: { decisionOwner: { primary: "src/owner.ts", supporting: ["src/support.ts"] } } }),
      );
      expect(runDuplicateDecisionOwnerRule(dir, COMMIT)).toHaveLength(0);
    });

    it("does not flag when no other file shares a governed symbol name", () => {
      dir = makeTempDir();
      writeFile(dir, "src/owner.ts", "export function decide() { return 1; }");
      writeFile(dir, "src/unrelated.ts", "export function somethingElse() { return 1; }");
      writeFile(
        dir,
        "docs/governance/repository-owner-map.json",
        JSON.stringify({ protocolVersion: "x@1", entries: { decisionOwner: { primary: "src/owner.ts", supporting: [] } } }),
      );
      expect(runDuplicateDecisionOwnerRule(dir, COMMIT)).toHaveLength(0);
    });
  });

  describe("runDependencyCycleRule", () => {
    it("detects a real two-file cycle", () => {
      dir = makeTempDir();
      writeFile(dir, "src/a.ts", `import { b } from "./b.js";\nexport const a = 1;`);
      writeFile(dir, "src/b.ts", `import { a } from "./a.js";\nexport const b = 1;`);
      const findings = runDependencyCycleRule(dir, COMMIT);
      expect(findings).toHaveLength(1);
      expect(findings[0].confidence).toBe("proven");
      expect(findings[0].affectedPaths.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("reports nothing for an acyclic graph", () => {
      dir = makeTempDir();
      writeFile(dir, "src/a.ts", `import { b } from "./b.js";\nexport const a = 1;`);
      writeFile(dir, "src/b.ts", `export const b = 1;`);
      expect(runDependencyCycleRule(dir, COMMIT)).toHaveLength(0);
    });

    it("does not falsely collapse two unrelated finding identities", () => {
      dir = makeTempDir();
      writeFile(dir, "src/a.ts", `import { b } from "./b.js";\nexport const a = 1;`);
      writeFile(dir, "src/b.ts", `import { a } from "./a.js";\nexport const b = 1;`);
      writeFile(dir, "src/c.ts", `import { d } from "./d.js";\nexport const c = 1;`);
      writeFile(dir, "src/d.ts", `import { c } from "./c.js";\nexport const d = 1;`);
      const findings = runDependencyCycleRule(dir, COMMIT);
      expect(findings).toHaveLength(2);
      expect(new Set(findings.map((f) => f.findingKey)).size).toBe(2);
    });
  });

  describe("runResponsibilityConcentrationRule", () => {
    it("flags a repository-relative outlier as weak_signal, non-actionable-by-default", () => {
      dir = makeTempDir();
      for (let i = 0; i < 15; i++) {
        writeFile(dir, `src/normal${i}.ts`, Array.from({ length: 50 }, () => "// line").join("\n"));
      }
      writeFile(dir, "src/huge.ts", Array.from({ length: 5000 }, () => "// line").join("\n"));
      const findings = runResponsibilityConcentrationRule(dir, COMMIT);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.confidence === "weak_signal")).toBe(true);
      expect(findings.every((f) => f.eligibleForIntake === false)).toBe(true);
    });

    it("does not flag a uniform, unremarkable codebase", () => {
      dir = makeTempDir();
      for (let i = 0; i < 15; i++) {
        writeFile(dir, `src/normal${i}.ts`, Array.from({ length: 50 }, () => "// line").join("\n"));
      }
      expect(runResponsibilityConcentrationRule(dir, COMMIT)).toHaveLength(0);
    });
  });

  describe("runUnreferencedCommandFileRule", () => {
    it("flags a command file never imported by register-commands.ts", () => {
      dir = makeTempDir();
      writeFile(dir, "src/cli/register-commands.ts", `import { runFoo } from "./commands/foo.command.js";`);
      writeFile(dir, "src/cli/commands/foo.command.ts", "export function runFoo() {}");
      writeFile(dir, "src/cli/commands/orphan.command.ts", "export function runOrphan() {}");
      const findings = runUnreferencedCommandFileRule(dir, COMMIT);
      expect(findings).toHaveLength(1);
      expect(findings[0].affectedPaths).toEqual(["src/cli/commands/orphan.command.ts"]);
    });

    it("does not flag a registered command", () => {
      dir = makeTempDir();
      writeFile(dir, "src/cli/register-commands.ts", `import { runFoo } from "./commands/foo.command.js";`);
      writeFile(dir, "src/cli/commands/foo.command.ts", "export function runFoo() {}");
      expect(runUnreferencedCommandFileRule(dir, COMMIT)).toHaveLength(0);
    });
  });

  describe("runNodeVersionConsistencyRule", () => {
    it("flags CI declaring an older Node than package.json requires", () => {
      dir = makeTempDir();
      writeFile(dir, "package.json", JSON.stringify({ engines: { node: ">=24.0.0" } }));
      writeFile(dir, ".github/workflows/validate.yml", "jobs:\n  quality:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 22\n");
      const findings = runNodeVersionConsistencyRule(dir, COMMIT);
      expect(findings).toHaveLength(1);
      expect(findings[0].confidence).toBe("proven");
    });

    it("does not flag matching declarations", () => {
      dir = makeTempDir();
      writeFile(dir, "package.json", JSON.stringify({ engines: { node: ">=24.0.0" } }));
      writeFile(dir, ".github/workflows/validate.yml", "jobs:\n  quality:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 24\n");
      expect(runNodeVersionConsistencyRule(dir, COMMIT)).toHaveLength(0);
    });
  });

  describe("runProcessHeavyTestTimeoutRule", () => {
    it("degrades to no findings (never throws) when the target has no tests/ directory", () => {
      dir = makeTempDir();
      writeFile(dir, "src/a.ts", "export const a = 1;");
      expect(runProcessHeavyTestTimeoutRule(dir, COMMIT)).toEqual([]);
    });
  });

  describe("runDuplicateExecutionAuthorityRule", () => {
    it("flags a new, unreviewed child_process call site", () => {
      dir = makeTempDir();
      writeFile(dir, "src/some-service.ts", `import { execFileSync } from "node:child_process";\nexecFileSync("ls");`);
      const findings = runDuplicateExecutionAuthorityRule(dir, COMMIT);
      expect(findings).toHaveLength(1);
      expect(findings[0].significance).toBe("high");
    });

    it("does not flag the reviewed allowlisted owner", () => {
      dir = makeTempDir();
      // Uses a backtick-quoted argument deliberately -- this repository's
      // own M35 test-inventory classifier textually matches a straight-
      // quoted git spawn call as evidence a TEST FILE itself spawns git
      // (see hasGitSpawn in src/tooling/test-inventory-classifier.ts),
      // which would misclassify this fixture literal as this unit test
      // file spawning a real process. It does not -- this string is
      // fixture content written to a temp file, never executed.
      writeFile(dir, "src/workspaces/git-command-runner.ts", "import { execFileSync } from \"node:child_process\";\nexecFileSync(`git`);");
      expect(runDuplicateExecutionAuthorityRule(dir, COMMIT)).toHaveLength(0);
    });

    it("does not flag a file that only imports child_process without calling it", () => {
      dir = makeTempDir();
      writeFile(dir, "src/typedefs.ts", `import type { ChildProcess } from "node:child_process";\nexport type X = ChildProcess;`);
      expect(runDuplicateExecutionAuthorityRule(dir, COMMIT)).toHaveLength(0);
    });

    it("does not flag repository governance/release tooling (isolated-by-design false-positive control)", () => {
      dir = makeTempDir();
      writeFile(dir, "src/tooling/some-release-script.ts", "import { spawnSync } from \"node:child_process\";\nspawnSync(`git`, [\"status\"]);");
      expect(runDuplicateExecutionAuthorityRule(dir, COMMIT)).toHaveLength(0);
    });
  });
});
