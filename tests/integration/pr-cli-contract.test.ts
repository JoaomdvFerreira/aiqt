import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { BUILT_CLI_ENTRY } from "../cli-runner.js";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";

vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M47-WU06 (build spec Sec 6/13/15 scenarios 24, 29, 33): the `aiqt pr`
 * surface as it actually ships -- spawned from `dist/index.js`, the
 * artifact `package.json#bin` points at, with real argv, real exit codes,
 * and real stdout/stderr.
 *
 * These assert the contract an external consumer depends on: the command
 * surface, human/JSON parity, the exit-code mapping, and that no command
 * offers a merge, approval, force, delete, or tag capability anywhere in
 * its own help text.
 */

let workRoot: string;
let repoDir: string;

function runPr(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [BUILT_CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_TOKEN: "", AIQT_PR_INTEGRATION_HOME: join(workRoot, "integrations"), ...env },
  });
}

function git(args: string[], cwd = repoDir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(() => {
  workRoot = makeTempDir("aiqt-pr-cli-");
  repoDir = join(workRoot, "repo");
  mkdirSync(repoDir, { recursive: true });
  initGitFixtureRepo(repoDir);
  git(["checkout", "--quiet", "-b", "feature/x"]);
  writeFileSync(join(repoDir, "feature.txt"), "work\n");
  git(["add", "feature.txt"]);
  git(["commit", "--quiet", "-m", "feature work"]);
});

afterEach(() => {
  removeDir(workRoot);
});

describe("M47-WU06: the shipped `aiqt pr` command surface", () => {
  it("registers exactly the six documented subcommands and nothing else", () => {
    const res = runPr(["pr", "--help"], workRoot);
    expect(res.status).toBe(0);
    const names = res.stdout
      .split("\n")
      .map((line) => /^\s{2}(\w[\w-]*)/.exec(line)?.[1])
      .filter((n): n is string => n !== undefined && n !== "help")
      .sort();
    expect(names).toEqual(["create", "inspect", "prepare", "push", "status", "validate"]);
  });

  it("offers no merge, approve, force, delete, tag, deploy, or release capability anywhere in its help", () => {
    const top = runPr(["pr", "--help"], workRoot).stdout;
    const perCommand = ["prepare", "push", "create", "status", "validate", "inspect"].map((c) => runPr(["pr", c, "--help"], workRoot).stdout).join("\n");
    const help = `${top}\n${perCommand}`;
    for (const forbidden of ["--force", "--merge", "--approve", "--delete", "--tag", "--deploy", "--release", "--auto-merge"]) {
      expect(help.includes(forbidden), `\`aiqt pr\` help must not offer ${forbidden}`).toBe(false);
    }
    expect(top).toMatch(/never approves, merges, deploys, or releases/i);
  });

  it("never offers a flag that takes a token value directly", () => {
    const help = ["prepare", "push", "create", "status", "validate"].map((c) => runPr(["pr", c, "--help"], workRoot).stdout).join("\n");
    expect(help).toMatch(/--token-env <name>/);
    expect(help.includes("--token <"), "a token must never be a CLI argument").toBe(false);
  });
});

describe("M47-WU06: human/JSON parity and exit-code contract", () => {
  it("reports missing credentials as exit 4 in both modes, with the same issue id and no secret", () => {
    const human = runPr(["pr", "prepare", "--repository", repoDir, "--base", "main", "--title", "T"], workRoot);
    const json = runPr(["pr", "prepare", "--repository", repoDir, "--base", "main", "--title", "T", "--json"], workRoot);

    expect(human.status).toBe(4);
    expect(json.status).toBe(4);

    const parsed = JSON.parse(json.stdout) as { status: string; action: string; exitCode: number; blockingIssues: { id: string; suggestedAction?: string }[] };
    expect(parsed).toMatchObject({ status: "failed", action: "pr", exitCode: 4 });
    expect(parsed.blockingIssues[0]!.id).toBe("PR-PREPARE-MISSING-CREDENTIALS");
    // The human rendering carries the same identity and action text.
    expect(human.stdout + human.stderr).toContain("PR-PREPARE-MISSING-CREDENTIALS");
    expect(json.stdout).not.toMatch(/gh[pousr]_[A-Za-z0-9]/);
  });

  it("emits parseable JSON on stdout for a plan that does not exist (exit 3)", () => {
    const res = runPr(["pr", "inspect", "pri-1754784000000-0123abcd", "--json"], workRoot);
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout) as { action: string; exitCode: number; blockingIssues: { id: string }[] };
    expect(parsed.action).toBe("pr");
    expect(parsed.exitCode).toBe(3);
    expect(parsed.blockingIssues[0]!.id).toBe("PR-PLAN-NOT-FOUND");
  });

  it("emits parseable JSON for a parser-level error (unknown pr subcommand)", () => {
    const res = runPr(["pr", "merge", "--json"], workRoot);
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout) as { action: string; blockingIssues: { id: string }[] };
    expect(parsed.blockingIssues[0]!.id).toBe("CLI-UNKNOWN-COMMAND");
  });

  it("requires --title or --from-run, and reports it deterministically", () => {
    const res = runPr(["pr", "prepare", "--repository", repoDir, "--base", "main", "--json"], workRoot, { GITHUB_TOKEN: "x" });
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout) as { blockingIssues: { id: string }[] };
    expect(parsed.blockingIssues[0]!.id).toBe("PR-PREPARE-MISSING-TITLE");
  });

  it("is deterministic: the same invocation twice produces byte-identical JSON", () => {
    const a = runPr(["pr", "inspect", "pri-1754784000000-0123abcd", "--json"], workRoot);
    const b = runPr(["pr", "inspect", "pri-1754784000000-0123abcd", "--json"], workRoot);
    expect(b.stdout).toBe(a.stdout);
  });
});

describe("M47-WU06: the shipped binary refuses to target the AIQT repository itself", () => {
  it("blocks when --repository is this repository", () => {
    // The AIQT product repository is this repository; the self-management
    // guard identifies it by package.json name.
    const res = runPr(["pr", "prepare", "--repository", ".", "--base", "main", "--title", "T", "--json"], join(BUILT_CLI_ENTRY, "..", ".."), { GITHUB_TOKEN: "x" });
    expect(res.status).toBe(2);
    const parsed = JSON.parse(res.stdout) as { blockingIssues: { id: string }[] };
    expect(parsed.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-SELF-MANAGEMENT");
  });
});
