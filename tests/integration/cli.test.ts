import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("aiqt CLI entrypoint", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("prints help and exits 0", () => {
    dir = makeTempDir();
    const res = runCli(["--help"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("aiqt");
    expect(res.stdout).toContain("init");
  });

  it("exits with code 3 for an unknown command", () => {
    dir = makeTempDir();
    const res = runCli(["frobnicate"], dir);
    expect(res.status).toBe(3);
  });

  it("emits valid JSON for init --json", () => {
    dir = makeTempDir();
    const res = runCli(["init", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("init");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.nextRecommendedCommand).toBe("aiqt update");
  });

  it("exits 0 and writes files for init, then status", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const statusRes = runCli(["status", "--json"], dir);
    expect(statusRes.status).toBe(0);
    expect(JSON.parse(statusRes.stdout).projectStatus).toBe("draft");
  });

  it("aiqt plan --example prints sample JSON, exits 0, without requiring .aiqt/", () => {
    dir = makeTempDir();
    const res = runCli(["plan", "--example"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed.milestones)).toBe(true);
    expect(Array.isArray(parsed.workUnits)).toBe(true);
    expect(Array.isArray(parsed.dependencies)).toBe(true);
  });

  it("aiqt plan --example --json is rejected with exit code 3", () => {
    dir = makeTempDir();
    const res = runCli(["plan", "--example", "--json"], dir);
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.exitCode).toBe(3);
  });

  it("aiqt next human mode prints the raw packet text on success, paste-ready", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    expect(
      runCli(["update", "--objective", "Ship it", "--target-user", "devs"], dir).status,
    ).toBe(0);
    const patchPath = join(dir, "patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    expect(runCli(["update", "--from-file", patchPath], dir).status).toBe(0);
    const planRes = runCli(["plan", "--example"], dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, planRes.stdout);
    expect(runCli(["plan", "--from-file", planPath], dir).status).toBe(0);

    const res = runCli(["next"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout.startsWith("# AGENT EXECUTION PACKET")).toBe(true);
    expect(res.stdout).not.toContain("AIQT next:");
    expect(res.stdout).not.toContain("Next recommended command:");
  });

  it("aiqt checkpoint --example prints sample JSON, exits 0, without requiring .aiqt/", () => {
    dir = makeTempDir();
    const res = runCli(["checkpoint", "--example"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(typeof parsed.summary).toBe("string");
    expect(parsed.validationResult).toBe("passed");
    expect(parsed.acceptanceCriteriaResult).toBe("passed");
  });

  it("aiqt checkpoint --example --json is rejected with exit code 3", () => {
    dir = makeTempDir();
    const res = runCli(["checkpoint", "--example", "--json"], dir);
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.exitCode).toBe(3);
  });

  it("M8: aiqt import update --stdin reads real piped stdin end-to-end", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payload = JSON.stringify({ project: { objective: "Ship it", targetUsers: ["devs"] } });
    const res = spawnSync(process.execPath, [tsxCli, entry, "import", "update", "--stdin", "--json"], {
      cwd: dir,
      encoding: "utf8",
      input: payload,
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.import.source).toBe("stdin");
    expect(parsed.data.import.sourcePath).toBeNull();
  });

  it("M8: aiqt import update --stdin exits 3 without hanging when stdin is empty", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = spawnSync(process.execPath, [tsxCli, entry, "import", "update", "--stdin", "--json"], {
      cwd: dir,
      encoding: "utf8",
      input: "",
    });
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout || res.stderr);
    expect(parsed.exitCode).toBe(3);
  });

  it("M8: aiqt prompt driver --json works before aiqt init", () => {
    dir = makeTempDir();
    const res = runCli(["prompt", "driver", "--idea", "Build a marketplace", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.promptType).toBe("driver");
    expect(parsed.data.idea).toBe("Build a marketplace");
    expect(parsed.nextRecommendedCommand).toBe("aiqt init");
  });

  it("M8: aiqt prompt interview --json detects full-stack signals from --idea", () => {
    dir = makeTempDir();
    const res = runCli(["prompt", "interview", "--idea", "Build a marketplace", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.promptType).toBe("interview");
    expect(parsed.data.detectedProjectType).toBe("full-stack web application");
  });

  it("M9: aiqt manage --json is valid JSON", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["manage", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("manage");
    expect(parsed.data.developmentComplete).toBe(false);
  });

  it("M9: --json on a nested subcommand (next cancel) parses correctly, not swallowed by the parent's own --json option", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["next", "cancel", "--json"], dir);
    // No current packet to cancel -> exit 2, but critically the output must
    // actually be JSON (Commander's positional-options handling regression:
    // a same-named --json declared on both "next" and its "cancel"
    // subcommand can otherwise silently reset to the parent's default).
    expect(res.status).toBe(2);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.action).toBe("next");
  });

  it("M9: --json on review acknowledge (nested subcommand with its own --reason) parses correctly", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(
      ["review", "acknowledge", "checkpoint:WU001:acceptanceCriteriaResult:partial", "--reason", "x", "--json"],
      dir,
    );
    // Unknown finding key -> exit 3, but the output must be JSON.
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stderr);
    expect(parsed.action).toBe("review");
  });
});
