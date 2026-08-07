import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runVersionCheck, type VersionCheckOptions } from "../../src/tooling/version-check.js";
import { makeTempDir, removeDir } from "../helpers.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

function git(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function writePackageJson(dir: string, version: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture-repo", version }, null, 2));
}

/** A fresh temp git repo with an initial commit at `initialVersion` on `main`. */
function initRepo(initialVersion: string): string {
  const dir = makeTempDir("aiqt-version-check-");
  git(["init", "--initial-branch=main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  writePackageJson(dir, initialVersion);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function commitChange(dir: string, relPath: string, content: string, message: string): void {
  const fullPath = join(dir, relPath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content);
  git(["add", relPath], dir);
  git(["commit", "-m", message], dir);
}

function withCurrentVersionReader(version: string): Pick<VersionCheckOptions, "devRuntimeVersionReader" | "builtRuntimeVersionReader"> {
  return {
    devRuntimeVersionReader: () => ({ version }),
    builtRuntimeVersionReader: () => null, // "dist/ does not exist" -- not applicable, not a failure.
  };
}

describe("runVersionCheck: local consistency mode (M19 §9/§22.2)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("passes when the version is valid SemVer and the runtime reader matches", () => {
    dir = initRepo("0.6.0");
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.checks.semverValid).toBe(true);
    expect(result.checks.runtimeMatchesPackage).toBe(true);
  });

  it("fails structurally (exit 3) for invalid SemVer", () => {
    dir = initRepo("not-a-version");
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("not-a-version") });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
    expect(result.checks.semverValid).toBe(false);
  });

  it("fails (exit 1) when the development runtime version diverges from package.json", () => {
    dir = initRepo("0.6.0");
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.5.9") });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.checks.runtimeMatchesPackage).toBe(false);
  });

  it("fails (exit 1) when the built runtime version diverges from package.json", () => {
    dir = initRepo("0.6.0");
    const result = runVersionCheck({
      cwd: dir,
      devRuntimeVersionReader: () => ({ version: "0.6.0" }),
      builtRuntimeVersionReader: () => ({ version: "0.5.0" }),
    });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.checks.builtRuntimeMatchesPackage).toBe(false);
  });

  it("does not require a clean working tree", () => {
    dir = initRepo("0.6.0");
    writeFileSync(join(dir, "untracked.txt"), "dirty");
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("passed");
  });

  it("does not require a remote or a base branch", () => {
    dir = initRepo("0.6.0");
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.mode).toBe("local");
    expect(result.baseRef).toBeNull();
  });

  it("fails structurally when package.json is missing", () => {
    dir = makeTempDir("aiqt-version-check-nopkg-");
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.exitCode).toBe(3);
  });
});

describe("runVersionCheck: comparison mode (M19 §10/§13/§22.3)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails when a relevant source change exists but the version is unchanged", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "add relevant source change");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.checks.requiredBumpPresent).toBe(false);
    expect(result.relevantChangesDetected).toBe(true);
  });

  it("passes when a relevant source change exists alongside a patch bump", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "add relevant source change");
    writePackageJson(dir, "0.6.1");
    git(["add", "package.json"], dir);
    git(["commit", "-m", "bump patch"], dir);
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("passed");
    expect(result.increment).toBe("patch");
  });

  it("passes when a relevant source change exists alongside a minor bump", () => {
    dir = initRepo("0.5.1");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "add relevant source change");
    writePackageJson(dir, "0.6.0");
    git(["add", "package.json"], dir);
    git(["commit", "-m", "bump minor"], dir);
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("passed");
    expect(result.increment).toBe("minor");
  });

  it("passes when a relevant source change exists alongside a major bump", () => {
    dir = initRepo("0.9.0");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "add relevant source change");
    writePackageJson(dir, "1.0.0");
    git(["add", "package.json"], dir);
    git(["commit", "-m", "bump major"], dir);
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("1.0.0") });
    expect(result.status).toBe("passed");
    expect(result.increment).toBe("major");
  });

  it("fails when the current version is lower than the base version", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "relevant change");
    writePackageJson(dir, "0.5.9");
    git(["add", "package.json"], dir);
    git(["commit", "-m", "accidental downgrade"], dir);
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("0.5.9") });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.checks.monotonic).toBe(false);
  });

  it("passes when there is no relevant change and the version is unchanged", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "tests/unit/x.test.ts", "// test only\n", "test-only change");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("passed");
    expect(result.relevantChangesDetected).toBe(false);
  });

  it("passes (informationally) when the bump is larger than the detected minimum", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "small relevant change");
    writePackageJson(dir, "1.0.0"); // a major bump for what could have been a patch.
    git(["add", "package.json"], dir);
    git(["commit", "-m", "bump major anyway"], dir);
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("1.0.0") });
    expect(result.status).toBe("passed");
    expect(result.increment).toBe("major");
  });

  it("fails structurally (exit 3) for an unresolved base ref", () => {
    dir = initRepo("0.6.0");
    const result = runVersionCheck({ cwd: dir, base: "does-not-exist-ref", ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
  });

  it("uses merge-base semantics: comparison is deterministic regardless of unrelated commits on the base branch after divergence", () => {
    dir = initRepo("0.6.0");
    // Diverge: create a feature branch, then advance main independently.
    git(["checkout", "-b", "feature"], dir);
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "feature work");
    writePackageJson(dir, "0.7.0");
    git(["add", "package.json"], dir);
    git(["commit", "-m", "bump minor on feature"], dir);

    git(["checkout", "main"], dir);
    commitChange(dir, "README.md", "# fixture\nunrelated main progress\n", "unrelated main commit");

    git(["checkout", "feature"], dir);
    const result = runVersionCheck({ cwd: dir, base: "main", ...withCurrentVersionReader("0.7.0") });
    expect(result.status).toBe("passed");
    // The merge-base (before either branch's own commits) is the correct
    // comparison point -- base version is still 0.6.0, not whatever main
    // has advanced to since divergence.
    expect(result.baseVersion).toBe("0.6.0");
  });

  it("classifies mixed relevant and ignored paths as requiring a bump", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "relevant");
    commitChange(dir, "tests/unit/x.test.ts", "// test\n", "ignored");
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("failed"); // version unchanged despite the relevant path.
    expect(result.relevantPaths).toContain("src/feature.ts");
    expect(result.ignoredPaths).toContain("tests/unit/x.test.ts");
  });
});

describe("version-check CLI process (M19 §22.5/§17)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("real CLI process: local mode on this repository passes and reports exit 0", () => {
    const here = process.cwd();
    const result = spawnSync(
      process.execPath,
      [join(here, "node_modules", "tsx", "dist", "cli.mjs"), join(here, "src", "tooling", "version-check-cli.ts")],
      { cwd: here, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASSED");
  });

  it("real CLI process: --json produces valid JSON output", () => {
    const here = process.cwd();
    const result = spawnSync(
      process.execPath,
      [
        join(here, "node_modules", "tsx", "dist", "cli.mjs"),
        join(here, "src", "tooling", "version-check-cli.ts"),
        "--json",
      ],
      { cwd: here, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("passed");
    expect(parsed.mode).toBe("local");
  });

  it("real CLI process: invalid arguments exit 3", () => {
    const here = process.cwd();
    const result = spawnSync(
      process.execPath,
      [
        join(here, "node_modules", "tsx", "dist", "cli.mjs"),
        join(here, "src", "tooling", "version-check-cli.ts"),
        "--not-a-real-flag",
      ],
      { cwd: here, encoding: "utf8" },
    );
    expect(result.status).toBe(3);
  });

  it("real CLI process: --base without a value exits 3", () => {
    const here = process.cwd();
    const result = spawnSync(
      process.execPath,
      [join(here, "node_modules", "tsx", "dist", "cli.mjs"), join(here, "src", "tooling", "version-check-cli.ts"), "--base"],
      { cwd: here, encoding: "utf8" },
    );
    expect(result.status).toBe(3);
  });
});

describe("runVersionCheck: lockfile and hardcoded-drift checks (M19 §22.2)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails when pnpm-lock.yaml's root version field diverges from package.json", () => {
    dir = initRepo("0.6.0");
    writeFileSync(
      join(dir, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    version: 0.5.0",
        "    dependencies: {}",
        "",
      ].join("\n"),
    );
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("failed");
    expect(result.checks.lockfileMatchesPackage).toBe(false);
  });

  it("passes when pnpm-lock.yaml has no root version field at all (this repo's actual lockfile shape)", () => {
    dir = initRepo("0.6.0");
    writeFileSync(
      join(dir, "pnpm-lock.yaml"),
      ["lockfileVersion: 5.4", "", "dependencies:", "  zod: 3.25.76", ""].join("\n"),
    );
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("passed");
    expect(result.checks.lockfileMatchesPackage).toBe(true);
  });

  it("does not mistake a nested dependency's version for the root package version", () => {
    dir = initRepo("0.6.0");
    writeFileSync(
      join(dir, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      zod:",
        "        specifier: ^3.23.8",
        "        version: 3.25.76",
        "",
      ].join("\n"),
    );
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("passed");
    expect(result.checks.lockfileMatchesPackage).toBe(true);
  });

  it("fails when register-commands.ts hard-codes a diverging .version(\"...\") literal", () => {
    dir = initRepo("0.6.0");
    mkdirSync(join(dir, "src", "cli"), { recursive: true });
    writeFileSync(
      join(dir, "src", "cli", "register-commands.ts"),
      'program.name("aiqt").version("0.5.0");\n',
    );
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.includes("hard-coded"))).toBe(true);
  });

  it("passes when register-commands.ts derives its version from a variable, not a literal", () => {
    dir = initRepo("0.6.0");
    mkdirSync(join(dir, "src", "cli"), { recursive: true });
    writeFileSync(
      join(dir, "src", "cli", "register-commands.ts"),
      'program.name("aiqt").version(AIQT_PACKAGE_VERSION);\n',
    );
    const result = runVersionCheck({ cwd: dir, ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("passed");
  });
});

describe("runVersionCheck: cross-platform path handling (M19 §21/§23)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("handles a changed path containing spaces", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "src/a file with spaces.ts", "export const x = 1;\n", "path with spaces");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.0") });
    expect(result.status).toBe("failed"); // relevant change, version unchanged.
    expect(result.relevantPaths).toContain("src/a file with spaces.ts");
  });
});

describe("runVersionCheck: shallow-history structural failure (M19 §22.6)", () => {
  let dir: string | null = null;
  let shallowDir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    if (shallowDir) removeDir(shallowDir);
    dir = null;
    shallowDir = null;
  });

  it("gives a clear structural error (exit 3) when history is too shallow to resolve the base ref", () => {
    dir = initRepo("0.6.0");
    commitChange(dir, "src/feature.ts", "export const x = 1;\n", "second commit");
    commitChange(dir, "src/feature2.ts", "export const y = 2;\n", "third commit");

    shallowDir = makeTempDir("aiqt-version-check-shallow-");
    git(["clone", "--depth=1", `file://${dir.replace(/\\/g, "/")}`, shallowDir], process.cwd());

    const result = runVersionCheck({
      cwd: shallowDir,
      base: "does-not-exist-in-shallow-clone",
      ...withCurrentVersionReader("0.6.0"),
    });
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("runVersionCheck: public documentation classification (M19-RC1 §7/§10/§17.1/§17.2)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails when README.md (public entry point) changes but the version is unchanged", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "README.md", "# fixture\ninstall/usage docs\n", "README public docs change");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("failed");
    expect(result.checks.requiredBumpPresent).toBe(false);
    expect(result.relevantPaths).toContain("README.md");
  });

  it("passes when README.md changes alongside a patch bump", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "README.md", "# fixture\ninstall/usage docs\n", "README public docs change");
    writePackageJson(dir, "0.6.2");
    git(["add", "package.json"], dir);
    git(["commit", "-m", "bump patch"], dir);
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("0.6.2") });
    expect(result.status).toBe("passed");
    expect(result.increment).toBe("patch");
  });

  it("fails when docs/governance/versioning.md (release policy) changes but the version is unchanged", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "docs/governance/versioning.md", "updated release policy\n", "versioning policy change");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("failed");
    expect(result.relevantPaths).toContain("docs/governance/versioning.md");
  });

  it("fails when a CI workflow file (release-validation tooling) changes but the version is unchanged", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, ".github/workflows/validate.yml", "name: Validate\n", "workflow change");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("failed");
    expect(result.relevantPaths).toContain(".github/workflows/validate.yml");
  });

  it("fails when a public CLI/JSON-contract source file changes but the version is unchanged (behavior unchanged from before M19-RC1)", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "src/cli/register-commands.ts", "// CLI command surface\n", "CLI command change");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("failed");
    expect(result.relevantPaths).toContain("src/cli/register-commands.ts");
  });

  it("keeps an internal-note-only documentation change exempt (not README.md, not docs/governance/versioning.md)", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "docs/internal-scratch-notes.md", "private planning notes\n", "internal note only");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("passed");
    expect(result.relevantChangesDetected).toBe(false);
    expect(result.ignoredPaths).toContain("docs/internal-scratch-notes.md");
  });

  it("keeps a generated-report-only change exempt", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "coverage/lcov-report/index.html", "<html></html>\n", "generated coverage report");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("passed");
    expect(result.relevantChangesDetected).toBe(false);
  });

  it("requires a bump for a mix of public documentation and exempt test files", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "README.md", "install docs\n", "README change");
    commitChange(dir, "tests/unit/x.test.ts", "// test only\n", "test-only change");
    const result = runVersionCheck({ cwd: dir, base: "main~2", ...withCurrentVersionReader("0.6.1") });
    expect(result.status).toBe("failed");
    expect(result.relevantPaths).toContain("README.md");
    expect(result.ignoredPaths).toContain("tests/unit/x.test.ts");
  });

  it("classifies a Windows-style changed path for README.md correctly (git itself always reports forward slashes, but the classifier still normalizes defensively)", () => {
    dir = initRepo("0.6.1");
    commitChange(dir, "README.md", "install docs\n", "README change");
    const result = runVersionCheck({ cwd: dir, base: "main~1", ...withCurrentVersionReader("0.6.1") });
    expect(result.relevantPaths).toEqual(["README.md"]);
  });
});

describe("version-check CLI process: literal '--' separator tolerance (M19-RC1-fix)", () => {
  it("real CLI process: `-- --base <ref> --json` (pnpm's own forwarding, observed to not always strip '--') still parses correctly", () => {
    const here = process.cwd();
    const result = spawnSync(
      process.execPath,
      [
        join(here, "node_modules", "tsx", "dist", "cli.mjs"),
        join(here, "src", "tooling", "version-check-cli.ts"),
        "--",
        "--base",
        "HEAD",
        "--json",
      ],
      { cwd: here, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.mode).toBe("comparison");
    expect(parsed.baseRef).toBe("HEAD");
  });
});
