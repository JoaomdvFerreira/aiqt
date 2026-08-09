import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

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
    const parsed = JSON.parse(res.stdout);
    expect(parsed.exitCode).toBe(3);
  });

  it(
    "aiqt next human mode prints the raw packet text on success, paste-ready",
    () => {
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
      // M33-WU04 Sec 5.8: the packet text stays raw/paste-ready and is not
      // wrapped in the generic "AIQT next: <status>" summary, but it now
      // trails the shared status/warnings/blockers/next-command footer
      // (this fixture's plan --example carries an unresolvable
      // agentContextRefs entry, so a real warning is expected here).
      expect(res.stdout).toContain("Next recommended command:");
      // M39-WU-HF01: the compact Execution Guidance block now trails the
      // packet, ahead of the shared footer -- additive text only.
      const packetEnd = res.stdout.indexOf("Execution Guidance");
      const footerStart = res.stdout.indexOf("Next recommended command:");
      expect(packetEnd).toBeGreaterThan(-1);
      expect(packetEnd).toBeLessThan(footerStart);
      expect(res.stdout).toMatch(/Complexity: \w+/);
      expect(res.stdout).toContain("Subagents: none");
    },
    // M21 vitest-3 upgrade: this test chains 5 real spawnSync CLI child
    // processes (init/update/update/plan/next). The default 5000ms
    // testTimeout was already tight for that under plain `vitest run` and
    // is exceeded under `vitest run --coverage`'s added instrumentation
    // overhead -- a timing budget issue, not a functional regression.
    20000,
  );

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
    const parsed = JSON.parse(res.stdout);
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
    const parsed = JSON.parse(res.stdout);
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
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("review");
  });

  it("M10: aiqt skills plan exits 0 in human mode", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["skills", "plan"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("# AIQT Skills Plan");
  });

  it("M10: aiqt skills plan --json exits 0 and matches the deterministic contract shape", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["skills", "plan", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("skills");
    expect(parsed.data.detectedIntegrations).toEqual([]);
    expect(parsed.data.notDetectedIntegrations).toEqual(["supabase", "clerk", "shadcn-ui"]);
    expect(parsed.data.safetyNotes).toHaveLength(3);
  });

  it("M10: aiqt skills plan does not mutate state.json or runlog.jsonl", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runCli(["skills", "plan"], dir);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("M10: aiqt export final-review is rejected -- aiqt export all remains the only way to generate final-review.md", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["export", "final-review", "--json"], dir);
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe("failed");
  });

  it("M11: aiqt issue list --json exits 0 on an initialized project with no issues", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["issue", "list", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.issues).toEqual([]);
    expect(parsed.data.counts.active).toBe(0);
  });

  it("M11: --json on issue update (nested subcommand with its own --status/--reason) parses correctly, not swallowed by the parent's own --json option", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(
      ["issue", "update", "checkpoint:WU001:issue:does-not-exist", "--status", "deferred", "--reason", "x", "--json"],
      dir,
    );
    // Unknown issue key -> exit 3, but the output must be JSON.
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("issue");
  });

  it("M11: --json on issue promote (nested subcommand with its own --title/--reason/--validation-command) parses correctly", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(
      [
        "issue",
        "promote",
        "checkpoint:WU001:issue:does-not-exist",
        "--title",
        "t",
        "--reason",
        "r",
        "--validation-command",
        "pnpm test",
        "--json",
      ],
      dir,
    );
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("issue");
  });

  it("M11: aiqt repair plan exits 0 in human mode", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["repair", "plan"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("# AIQT Repair Plan");
  });

  it("M11: aiqt issue update requires a status and reason, exit code 3 not 10", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["issue", "update", "some-key", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("M12: --json on checkpoint amend (nested subcommand with its own --checkpoint/--acceptance/--reason) parses correctly", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(
      ["checkpoint", "amend", "--checkpoint", "C999", "--acceptance", "passed", "--reason", "x", "--json"],
      dir,
    );
    // Unknown checkpoint -> exit 3, but the output must actually be JSON
    // (guards the same Commander positional-options regression class as M9).
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("checkpoint");
  });

  it("M12: aiqt checkpoint amend missing --reason returns exit 3", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["checkpoint", "amend", "--checkpoint", "C001", "--acceptance", "passed", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("M12: --json on dependency update (nested subcommand with its own --type/--reason) parses correctly", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(
      ["dependency", "update", "DEP-999", "--type", "blocks", "--reason", "x", "--json"],
      dir,
    );
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("dependency");
  });

  it("M12: aiqt graph validate --json exits 0 on a bare project", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["graph", "validate", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("graph");
    expect(parsed.data.blockingErrors).toEqual([]);
  });

  it("M12: aiqt graph repair missing --dry-run returns exit 3", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["graph", "repair", "--json"], dir);
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.action).toBe("graph");
  });

  it("M12/M18: aiqt graph repair --dry-run parses through the nested subcommand in human mode", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["graph", "repair", "--dry-run"], dir);
    // M18: dry-run always succeeds (exit 0), with or without proposed
    // changes -- a bare project simply has zero deterministic proposals.
    expect(res.status).toBe(0);
  });

  /**
   * IH-03 (CI & Test Portfolio Rationalization) consolidation of the
   * six per-milestone "no new public commands are registered" snapshots
   * (M14, M15, M15-RC1, M16, M17, M18) that previously lived in this file.
   *
   * Why they merged: every one of them ran against the *current* binary,
   * and every one asserted the *same* positive command list via
   * `expect(stdout).toContain(command)` (M18 asserted a 16-entry subset of
   * the same 18). Six separate `--help` spawns therefore re-detected one
   * regression -- "a command disappeared from --help" -- six times. The
   * only content unique to each was its milestone-specific *negative*
   * assertion, and every one of those is preserved verbatim below, still
   * labelled with the milestone that introduced it. Nothing this file used
   * to assert about the command surface stopped being asserted; it is
   * asserted once, from one `--help` invocation, instead of six.
   *
   * The positive assertion is also **strengthened**, not merely merged.
   * All six originals asserted `expect(stdout).toContain(command)`, which
   * cannot actually detect a missing command: renaming `dependency` to
   * `depz` and re-running left every one of them green, because the word
   * "dependency" still appears in `next`'s own description prose. The
   * merged test parses the `Commands:` section and asserts the **exact**
   * top-level command set, which is what all six titles always claimed to
   * be checking. Verified by re-injecting the same `dependency` -> `depz`
   * rename: this test now fails, and fails naming the missing command.
   */
  function topLevelCommandNames(helpStdout: string): string[] {
    const commandsSection = helpStdout.slice(helpStdout.indexOf("\nCommands:"));
    return [...commandsSection.matchAll(/^ {2}([a-z][a-z-]*)/gm)]
      .map((m) => m[1])
      .filter((name) => name !== "help")
      .sort();
  }

  it("no new public command is registered: --help lists exactly the historical command set, and no milestone's hypothetical command surface leaked into it", () => {
    dir = makeTempDir();
    const res = runCli(["--help"], dir);
    expect(res.status).toBe(0);
    // The exact, reviewed top-level command surface. A command added or
    // removed without review fails here, naming the difference.
    expect(topLevelCommandNames(res.stdout)).toEqual(
      [
        // pre-M14 surface, asserted by every one of the six merged snapshots
        "init",
        "status",
        "next",
        "update",
        "plan",
        "checkpoint",
        "review",
        "export",
        "start",
        "continue",
        "prompt",
        "manage",
        "skills",
        "import",
        "issue",
        "repair",
        "dependency",
        "graph",
        // added by later milestones, each with its own dedicated suite
        "evidence",
        "defects",
        "workspace",
        "execution",
        "autonomous",
        "maintenance",
        "release",
        "validation",
      ].sort(),
    );
    // A hypothetical M14 command surface (e.g. "design") must not appear.
    expect(res.stdout).not.toMatch(/^\s*design\s/m);
    // A hypothetical M15 command surface (e.g. "git" or "source-control") must not appear.
    expect(res.stdout).not.toMatch(/^\s*git\s/m);
    expect(res.stdout).not.toMatch(/^\s*source-control\s/m);
    // A hypothetical M15-RC1 command surface (e.g. "boundary") must not appear.
    expect(res.stdout).not.toMatch(/^\s*boundary\s/m);
    // M16: --implementation-root is an option on existing commands, not a new command.
    expect(res.stdout).not.toMatch(/^\s*implementation-root\s/m);
    expect(res.stdout).not.toMatch(/^\s*root\s/m);
    // M17: --extend/--replace-placeholder are options on existing commands, not new commands.
    expect(res.stdout).not.toMatch(/^\s*extend\s/m);
    expect(res.stdout).not.toMatch(/^\s*replace-placeholder\s/m);
  });

  it("M18: graph repair exposes --dry-run and --apply as options, not as new public commands", () => {
    dir = makeTempDir();
    const repairHelp = runCli(["graph", "repair", "--help"], dir);
    expect(repairHelp.stdout).toContain("--dry-run");
    expect(repairHelp.stdout).toContain("--apply");
  });

  /**
   * IH-03 consolidation of the five per-milestone "representative exit-code
   * contracts remain unchanged" snapshots (M14, M15, M15-RC1, M16, M17).
   * The M15, M15-RC1, M16 and M17 tests were byte-identical to each other
   * -- same five invocations, same five expected statuses -- and M14's was
   * a strict two-assertion subset of them. Five tests and 23 real CLI
   * spawns detected exactly one class of regression: "a long-standing
   * exit-code contract changed". The union of all five assertions is kept
   * here, from one project setup.
   */
  it("representative long-standing exit-code contracts remain unchanged (M14/M15/M15-RC1/M16/M17)", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    // Missing target for export still returns exit 10 (needs_input), unchanged since M6.
    expect(runCli(["export"], dir).status).toBe(10);
    // Unsupported prompt kind still returns exit 3, unchanged since M7.
    expect(runCli(["prompt", "bogus"], dir).status).toBe(3);
    // Unknown command still returns exit 3.
    expect(runCli(["frobnicate"], dir).status).toBe(3);
    // aiqt next with no work graph still blocks with exit 2, unchanged since M4.
    expect(runCli(["next"], dir).status).toBe(2);
  });

  it("M15: aiqt next --json still succeeds and no new runlog event types appear alongside the M15 Source Control Expectations packet section", () => {
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

    const res = runCli(["next", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.packet).toContain("## Source Control Expectations");

    const runlogRaw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
    const eventTypes = new Set(runlogRaw.split(/\r?\n/).map((line) => JSON.parse(line).type));
    for (const type of eventTypes) {
      expect([
        "project.initialized",
        "project.updated",
        "work_graph.generated",
        "agent_packet.created",
        "work_unit.status_changed",
      ]).toContain(type);
    }
  }, 15000);

  it("M15-RC1: aiqt next --json still succeeds and no new runlog event types appear alongside the Repository Boundary Rule", () => {
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

    const res = runCli(["next", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.packet).toContain("Repository Boundary Rule:");

    const runlogRaw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
    const eventTypes = new Set(runlogRaw.split(/\r?\n/).map((line) => JSON.parse(line).type));
    for (const type of eventTypes) {
      expect([
        "project.initialized",
        "project.updated",
        "work_graph.generated",
        "agent_packet.created",
        "work_unit.status_changed",
      ]).toContain(type);
    }
  }, 15000);

  it("M16: aiqt init --implementation-root writes existingRepositoryPath and no new runlog event types appear", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "..", "split-app");
    const res = runCli(["init", "--implementation-root", implRoot, "--json"], dir);
    expect(res.status).toBe(0);
    const project = JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
    expect(project.project.existingRepositoryPath).toBe(implRoot);

    const runlogRaw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
    const eventTypes = new Set(runlogRaw.split(/\r?\n/).map((line) => JSON.parse(line).type));
    for (const type of eventTypes) {
      expect(["project.initialized"]).toContain(type);
    }
  });

  it("M16: aiqt update --implementation-root and --repository-path conflict returns exit 3", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(
      ["update", "--implementation-root", "../app-a", "--repository-path", "../app-b", "--json"],
      dir,
    );
    expect(res.status).toBe(3);
    const parsed = JSON.parse(res.stdout || res.stderr);
    expect(parsed.exitCode).toBe(3);
  });

  it("M17: ordinary aiqt plan on a non-empty graph still returns PLAN-GRAPH-NOT-EMPTY with exit 2", () => {
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

    const res = runCli(["plan", "--from-file", planPath, "--json"], dir);
    expect(res.status).toBe(2);
    const parsed = JSON.parse(res.stdout || res.stderr);
    expect(parsed.blockingIssues[0].id).toBe("PLAN-GRAPH-NOT-EMPTY");
  }, 15000);

  it("M31-WU01: aiqt plan --preview --json emits JSON on stdout and changes no canonical files", () => {
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
    const filesBefore = {
      project: readFileSync(join(dir, ".aiqt", "project.json"), "utf8"),
      state: readFileSync(join(dir, ".aiqt", "state.json"), "utf8"),
      runlog: readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8"),
    };

    const res = runCli(["plan", "--from-file", planPath, "--preview", "--json"], dir);

    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
    const parsed = JSON.parse(res.stdout);
    expect(parsed.status).toBe("passed");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.changedFiles).toEqual([]);
    expect(parsed.summary).toContain("Preview:");
    expect(parsed.summary).toContain("No files were changed.");
    expect(parsed.summary).not.toContain("generated.");
    expect(parsed.data.preview).toBe(true);
    expect(parsed.data.mutationPerformed).toBe(false);
    expect(readFileSync(join(dir, ".aiqt", "project.json"), "utf8")).toBe(filesBefore.project);
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(filesBefore.state);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(filesBefore.runlog);
  }, 20000);

  it("M18/M19/M19-RC1/M20/M21/M23: aiqt --version matches package.json's canonical version", () => {
    dir = makeTempDir();
    const res = runCli(["--version"], dir);
    expect(res.status).toBe(0);
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { version: string };
    expect(res.stdout.trim()).toBe(packageJson.version);
  });

});
