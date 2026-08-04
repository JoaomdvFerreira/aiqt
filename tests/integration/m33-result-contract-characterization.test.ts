import { describe, it, expect, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

// M33-WU01: these tests characterize (do not fix) the CLI result/stream
// contradictions inventoried in
// docs/engineering/m33-wu01-command-result-contract.md. Several drive the
// real CLI through multiple subprocess spawns per test; see
// docs/engineering/m30-correction-node22-integration-timeouts.md for why
// this repository's convention is a per-file testTimeout override rather
// than a global one.
vi.setConfig({ testTimeout: 20000 });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
}

/**
 * Reuses the exact shipped `aiqt plan --example` fixture, which contains a
 * genuine unresolvable agentContextRefs entry ("project.objective") on its
 * first work unit -- see src/cli/commands/plan-example.ts. Building a real
 * project from AIQT's own shipped example (rather than a synthetic
 * fixture) produces a real NEXT-UNRESOLVED-CONTEXT-REF warning on `next`
 * and a real "awaiting-checkpoint" review finding after `next` runs,
 * without hand-crafting either.
 */
function setupProjectWithRealWarnings(dir: string): void {
  expect(runCli(["init", "--json"], dir).status).toBe(0);
  expect(
    runCli(
      ["update", "--objective", "Test project", "--target-user", "Devs", "--json"],
      dir,
    ).status,
  ).toBe(0);
  const updatePatch = join(dir, "u.json");
  writeFileSync(updatePatch, JSON.stringify({ context: { technologyPreferences: ["TypeScript"] } }));
  expect(runCli(["update", "--from-file", updatePatch, "--json"], dir).status).toBe(0);

  const planPath = join(dir, "plan.json");
  const example = runCli(["plan", "--example"], dir);
  expect(example.status).toBe(0);
  writeFileSync(planPath, example.stdout);
  expect(runCli(["plan", "--from-file", planPath, "--json"], dir).status).toBe(0);
}

describe("M33-WU01: Contradiction A -- parser-level JSON loss", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("unknown command with --json produces non-JSON stderr output, not a CommandResult", () => {
    dir = makeTempDir();
    const res = runCli(["bogus", "--json"], dir);
    expect(res.status).toBe(3);
    expect(res.stdout).toBe("");
    expect(() => JSON.parse(res.stderr)).toThrow();
    expect(res.stderr).toContain("unknown command");
  });

  it("unknown option with --json produces non-JSON stderr output, not a CommandResult", () => {
    dir = makeTempDir();
    const res = runCli(["status", "--bogus", "--json"], dir);
    expect(res.status).toBe(3);
    expect(res.stdout).toBe("");
    expect(() => JSON.parse(res.stderr)).toThrow();
    expect(res.stderr).toContain("unknown option");
  });

  it("missing required argument with --json produces non-JSON stderr output, not a CommandResult", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["evidence", "gate", "policy", "show", "--json"], dir);
    expect(res.status).toBe(3);
    expect(res.stdout).toBe("");
    expect(() => JSON.parse(res.stderr)).toThrow();
    expect(res.stderr).toContain("missing required argument");
  });
});

describe("M33-WU01: Contradiction B (live sample) -- exit 10 body-field contradiction", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("import plan (core family) pairs exit 10 with needs_input/requiresHumanInput:true", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["import", "plan", "--json"], dir);
    // Exit 10 !== ExitCode.Success, so emit() routes this JSON to stderr (see
    // Sec 2.A/2.G of the inventory doc -- this is itself part of the
    // undocumented stream-routing behavior WU33-03 is scoped to normalize).
    const body = JSON.parse(res.stderr);
    expect(res.status).toBe(10);
    expect(body.status).toBe("needs_input");
    expect(body.requiresHumanInput).toBe(true);
  });

  it("evidence import (non-core family) pairs the SAME exit 10 with failed/requiresHumanInput:false", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["evidence", "import", "--json"], dir);
    const body = JSON.parse(res.stderr);
    expect(res.status).toBe(10);
    expect(body.status).toBe("failed");
    expect(body.requiresHumanInput).toBe(false);
  });
});

describe("M33-WU01: Contradiction C -- aiqt review human output omits findings JSON exposes", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("review --json exposes the awaiting-checkpoint finding; review (text) does not mention it", () => {
    dir = makeTempDir();
    setupProjectWithRealWarnings(dir);
    expect(runCli(["next", "--json"], dir).status).toBe(0);

    const jsonRes = runCli(["review", "--json"], dir);
    expect(jsonRes.status).toBe(0);
    const body = JSON.parse(jsonRes.stdout);
    expect(body.status).toBe("warning");
    expect(body.data.findingCount).toBeGreaterThan(0);
    const findingMessages: string[] = body.data.findings.map((f: { message: string }) => f.message);
    expect(findingMessages.some((m) => m.includes("awaiting checkpoint capture"))).toBe(true);

    const textRes = runCli(["review"], dir);
    expect(textRes.status).toBe(0);
    expect(textRes.stdout).not.toContain("awaiting checkpoint capture");
    expect(textRes.stdout).not.toContain("workunit:");
  });
});

describe("M33-WU01: Contradiction D -- specialized-command bypass drops warnings in text mode", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("next --json carries the NEXT-UNRESOLVED-CONTEXT-REF warning; next (text) shows only the packet", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    expect(
      runCli(["update", "--objective", "Test project", "--target-user", "Devs", "--json"], dir).status,
    ).toBe(0);
    const updatePatch = join(dir, "u.json");
    writeFileSync(updatePatch, JSON.stringify({ context: { technologyPreferences: ["TypeScript"] } }));
    expect(runCli(["update", "--from-file", updatePatch, "--json"], dir).status).toBe(0);
    const planPath = join(dir, "plan.json");
    const example = runCli(["plan", "--example"], dir);
    writeFileSync(planPath, example.stdout);
    expect(runCli(["plan", "--from-file", planPath, "--json"], dir).status).toBe(0);

    const jsonRes = runCli(["next", "--json"], dir);
    expect(jsonRes.status).toBe(0);
    const body = JSON.parse(jsonRes.stdout);
    expect(body.status).toBe("warning");
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.warnings.some((w: { id: string }) => w.id === "NEXT-UNRESOLVED-CONTEXT-REF")).toBe(true);
    expect(body.nextRecommendedCommand).not.toBeNull();
  });

  it("the equivalent text-mode next omits the warning and the recommended-command line entirely", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    expect(
      runCli(["update", "--objective", "Test project", "--target-user", "Devs", "--json"], dir).status,
    ).toBe(0);
    const updatePatch = join(dir, "u.json");
    writeFileSync(updatePatch, JSON.stringify({ context: { technologyPreferences: ["TypeScript"] } }));
    expect(runCli(["update", "--from-file", updatePatch, "--json"], dir).status).toBe(0);
    const planPath = join(dir, "plan.json");
    const example = runCli(["plan", "--example"], dir);
    writeFileSync(planPath, example.stdout);
    expect(runCli(["plan", "--from-file", planPath, "--json"], dir).status).toBe(0);

    const textRes = runCli(["next"], dir);
    expect(textRes.status).toBe(0);
    expect(textRes.stdout).not.toContain("NEXT-UNRESOLVED-CONTEXT-REF");
    expect(textRes.stdout).not.toContain("Next recommended command");
    expect(textRes.stdout).not.toContain("warning");
  });
});

describe("M33-WU01: Contradiction E -- missing-project results disagree across command families", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("status, review, and evidence gate policy show disagree on issue id / area / nextRecommendedCommand for the identical missing-project input", () => {
    dir = makeTempDir(); // deliberately never initialized

    const statusRes = runCli(["status", "--json"], dir);
    const statusBody = JSON.parse(statusRes.stdout === "" ? statusRes.stderr : statusRes.stdout);
    expect(statusBody.blockingIssues[0].id).toBe("AIQT-DIR-MISSING");
    expect(statusBody.blockingIssues[0].area).toBe("filesystem");
    expect(statusBody.nextRecommendedCommand).toBeNull();

    const reviewRes = runCli(["review", "--json"], dir);
    const reviewBody = JSON.parse(reviewRes.stdout === "" ? reviewRes.stderr : reviewRes.stdout);
    expect(reviewBody.blockingIssues[0].id).toBe("REVIEW-NO-PROJECT");
    expect(reviewBody.blockingIssues[0].area).toBe("workflow");
    expect(reviewBody.nextRecommendedCommand).toBe("aiqt init");

    const gateRes = runCli(["evidence", "gate", "policy", "show", "SOME-POLICY", "--json"], dir);
    const gateBody = JSON.parse(gateRes.stdout === "" ? gateRes.stderr : gateRes.stdout);
    expect(gateBody.blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-SHOW-NO-PROJECT");
    expect(gateBody.blockingIssues[0].area).toBe("evidence-gate");
    // Characterizes the gap: unlike review, this family never sets an
    // actionable recommendation even though the underlying situation
    // (missing .aiqt/) is identical.
    expect(gateBody.nextRecommendedCommand).toBeNull();

    // All three exit 3, so the disagreement is entirely in the body, not
    // the process exit code.
    expect(statusRes.status).toBe(3);
    expect(reviewRes.status).toBe(3);
    expect(gateRes.status).toBe(3);
  });
});

describe("M33-WU01: Contradiction F -- workflow pointers are null on failure even inside a live project", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("a core-family failure (review --mode bogus) and a non-core-family failure (evidence gate policy show, unknown id) both discard real, available project pointers", () => {
    dir = makeTempDir();
    setupProjectWithRealWarnings(dir);
    // A live, populated project: currentMilestoneId/projectStatus are real.
    const statusBefore = JSON.parse(runCli(["status", "--json"], dir).stdout);
    expect(statusBefore.projectStatus).not.toBeNull();
    expect(statusBefore.currentMilestoneId).not.toBeNull();

    // review validates --mode before ever loading project/state, so its
    // bespoke REVIEW-INVALID-MODE branch has no state to populate pointers
    // from -- even though a live project with real pointers exists (proven
    // by statusBefore above). Confirms pointer loss is not confined to
    // local failure()-helper families; it also occurs in a core, errorToResult-
    // adjacent command whenever a hand-built early-return branch simply never
    // sets the pointer fields.
    const reviewRes = runCli(["review", "--mode", "bogus", "--json"], dir);
    const reviewBody = JSON.parse(reviewRes.stdout === "" ? reviewRes.stderr : reviewRes.stdout);
    expect(reviewBody.projectStatus).toBeNull();
    expect(reviewBody.currentMilestoneId).toBeNull();

    const gateRes = runCli(["evidence", "gate", "policy", "show", "DOES-NOT-EXIST", "--json"], dir);
    const gateBody = JSON.parse(gateRes.stdout === "" ? gateRes.stderr : gateRes.stdout);
    expect(gateBody.projectStatus).toBeNull();
    expect(gateBody.currentMilestoneId).toBeNull();
  });
});

describe("M33-WU01: Contradiction G -- status --parallel is additive in JSON, a full replacement in text", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("--parallel --json still carries a full CommandResult with data.parallelStatus; --parallel (text) shows only the advisory report", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);

    const jsonRes = runCli(["status", "--parallel", "--json"], dir);
    expect(jsonRes.status).toBe(0);
    const body = JSON.parse(jsonRes.stdout);
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("exitCode");
    expect(body.data).toHaveProperty("parallelStatus");

    const textRes = runCli(["status", "--parallel"], dir);
    expect(textRes.status).toBe(0);
    expect(textRes.stdout).not.toContain("Project status:");
    expect(textRes.stdout).not.toContain("Next recommended command");
  });
});

describe("M33-WU01: Contradiction H -- --example --json behaves three different ways", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("plan --example --json is a hard error (exit 3, valid CommandResult JSON)", () => {
    dir = makeTempDir();
    const res = runCli(["plan", "--example", "--json"], dir);
    expect(res.status).toBe(3);
    const body = JSON.parse(res.stdout === "" ? res.stderr : res.stdout);
    expect(body.blockingIssues[0].id).toBe("PLAN-EXAMPLE-JSON-CONFLICT");
  });

  it("execution import --example --json silently ignores --json and prints a raw, non-CommandResult payload with exit 0", () => {
    dir = makeTempDir();
    const res = runCli(["execution", "import", "--example", "--json"], dir);
    expect(res.status).toBe(0);
    const body = JSON.parse(res.stdout);
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("exitCode");
  });

  it("execution external example --json is a dead option: identical output with or without --json", () => {
    dir = makeTempDir();
    const withJson = runCli(["execution", "external", "example", "--json"], dir);
    const withoutJson = runCli(["execution", "external", "example"], dir);
    expect(withJson.status).toBe(0);
    expect(withoutJson.status).toBe(0);
    expect(withJson.stdout).toBe(withoutJson.stdout);
  });
});

describe("M33-WU01: read-only rendering performs no mutation", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("review, review --json, status, status --json, and status --parallel never touch state.json or runlog.jsonl", () => {
    dir = makeTempDir();
    setupProjectWithRealWarnings(dir);
    expect(runCli(["next", "--json"], dir).status).toBe(0);

    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    runCli(["review"], dir);
    runCli(["review", "--json"], dir);
    runCli(["status"], dir);
    runCli(["status", "--json"], dir);
    runCli(["status", "--parallel"], dir);
    runCli(["status", "--parallel", "--json"], dir);

    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
    expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
  });
});
