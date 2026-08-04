import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

// M34-WU03: this file spawns the built CLI artifact directly; see
// docs/engineering/m34-validation-workload-policy.md Sec 6.6 for the
// representative-command set this suite is derived from.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const builtEntry = join(repoRoot, "dist", "index.js");
const sourceTsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const sourceEntry = join(repoRoot, "src", "index.ts");

/**
 * M34-WU03 (LOW-013, build spec Sec 5.6/6.6): direct smoke coverage of the
 * artifact `aiqt` actually ships (`dist/index.js`, referenced by
 * `package.json#bin`), distinct from every other integration suite in this
 * repository, which runs the CLI through tsx against `src/index.ts`. This
 * file requires `pnpm build` to have already produced `dist/`; it does not
 * invoke the build itself (matching every other integration test's
 * assumption that the environment is already prepared).
 */
function runBuilt(args: string[], cwd: string) {
  return spawnSync(process.execPath, [builtEntry, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function runSource(args: string[], cwd: string) {
  return spawnSync(process.execPath, [sourceTsxCli, sourceEntry, ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("built-binary smoke: dist/index.js", () => {
  it("dist/index.js exists (pnpm build has run)", () => {
    expect(
      existsSync(builtEntry),
      "dist/index.js not found -- run `pnpm build` before this suite (matches package.json#bin's shipped entry point).",
    ).toBe(true);
  });

  it("--version prints the package version and exits 0", () => {
    const res = runBuilt(["--version"], repoRoot);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help prints usage and exits 0", () => {
    const res = runBuilt(["--help"], repoRoot);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("aiqt");
    expect(res.stdout).toContain("init");
  });

  it("a parser-level error (bogus --json) exercises the M33 parser-JSON adaptation path and exits 3", () => {
    const res = runBuilt(["bogus", "--json"], repoRoot);
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe("failed");
    expect(parsed.exitCode).toBe(3);
    expect(parsed.blockingIssues[0].id).toBe("CLI-UNKNOWN-COMMAND");
  });

  it("plan --example (static-sample, no .aiqt/ required) emits valid JSON and exits 0", () => {
    const dir = makeTempDir();
    try {
      const res = runBuilt(["plan", "--example"], dir);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(Array.isArray(parsed.milestones)).toBe(true);
    } finally {
      removeDir(dir);
    }
  });

  describe("mutating and read-only commands against a disposable project", () => {
    let dir: string | null = null;
    afterEach(() => {
      if (dir) removeDir(dir);
      dir = null;
    });

    it("init --json (mutating) exits 0 and creates .aiqt/", () => {
      dir = makeTempDir();
      const res = runBuilt(["init", "--json"], dir);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.status).toBe("passed");
      expect(parsed.action).toBe("init");
      expect(existsSync(join(dir, ".aiqt", "project.json"))).toBe(true);
    });

    it("status --json (read-only) exits 0 and reflects the initialized project", () => {
      dir = makeTempDir();
      expect(runBuilt(["init"], dir).status).toBe(0);
      const res = runBuilt(["status", "--json"], dir);
      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.status).toBe("passed");
      expect(parsed.projectStatus).toBe("draft");
    });
  });
});

describe("source vs. built CLI: substantive output consistency", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("--version matches exactly between source (tsx) and built (dist) entry points", () => {
    dir = makeTempDir();
    const built = runBuilt(["--version"], dir);
    const source = runSource(["--version"], dir);
    expect(built.status).toBe(source.status);
    expect(built.stdout.trim()).toBe(source.stdout.trim());
  });

  it("init --json produces the same status/action/exitCode/nextRecommendedCommand shape from both entry points", () => {
    const builtDir = makeTempDir();
    const sourceDir = makeTempDir();
    try {
      const built = JSON.parse(runBuilt(["init", "--json"], builtDir).stdout);
      const source = JSON.parse(runSource(["init", "--json"], sourceDir).stdout);
      expect(built.status).toBe(source.status);
      expect(built.action).toBe(source.action);
      expect(built.exitCode).toBe(source.exitCode);
      expect(built.nextRecommendedCommand).toBe(source.nextRecommendedCommand);
    } finally {
      removeDir(builtDir);
      removeDir(sourceDir);
    }
  });

  it("a parser-level error (bogus --json) produces the same exitCode and blockingIssues[0].id from both entry points", () => {
    dir = makeTempDir();
    const built = JSON.parse(runBuilt(["bogus", "--json"], dir).stdout);
    const source = JSON.parse(runSource(["bogus", "--json"], dir).stdout);
    expect(built.exitCode).toBe(source.exitCode);
    expect(built.blockingIssues[0].id).toBe(source.blockingIssues[0].id);
  });
});
