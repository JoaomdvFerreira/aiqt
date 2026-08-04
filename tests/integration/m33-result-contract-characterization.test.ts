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

describe("M33-WU03: Contradiction A closed -- parser-level errors now emit valid JSON on stdout", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("unknown command with --json produces valid CommandResult JSON on stdout, empty stderr", () => {
    dir = makeTempDir();
    const res = runCli(["bogus", "--json"], dir);
    expect(res.status).toBe(3);
    expect(res.stderr).toBe("");
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("CLI-UNKNOWN-COMMAND");
    expect(body.exitCode).toBe(3);
  });

  it("unknown option with --json produces valid CommandResult JSON on stdout, empty stderr", () => {
    dir = makeTempDir();
    const res = runCli(["status", "--bogus", "--json"], dir);
    expect(res.status).toBe(3);
    expect(res.stderr).toBe("");
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("CLI-UNKNOWN-OPTION");
  });

  it("missing required argument with --json produces valid CommandResult JSON on stdout, empty stderr", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["evidence", "gate", "policy", "show", "--json"], dir);
    expect(res.status).toBe(3);
    expect(res.stderr).toBe("");
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("CLI-MISSING-ARGUMENT");
  });

  it("the equivalent human-mode invocations are unaffected: commander's own text still reaches stderr", () => {
    dir = makeTempDir();
    const res = runCli(["bogus"], dir);
    expect(res.status).toBe(3);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("unknown command");
  });
});

describe("M33-WU02+WU03: Contradiction B closed (live sample) -- exit 10 now agrees across families, and its JSON now lands on stdout", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("import plan (core family) pairs exit 10 with needs_input/requiresHumanInput:true, JSON on stdout", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["import", "plan", "--json"], dir);
    // M33-WU03 Sec 5.5: --json now always lands on stdout regardless of
    // exit code (previously routed to stderr whenever exitCode !== 0).
    expect(res.stderr).toBe("");
    const body = JSON.parse(res.stdout);
    expect(res.status).toBe(10);
    expect(body.status).toBe("needs_input");
    expect(body.requiresHumanInput).toBe(true);
  });

  it("evidence import (non-core family) now pairs the SAME exit 10 with the SAME needs_input/requiresHumanInput:true, via familyFailureResult", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["evidence", "import", "--json"], dir);
    expect(res.stderr).toBe("");
    const body = JSON.parse(res.stdout);
    expect(res.status).toBe(10);
    expect(body.status).toBe("needs_input");
    expect(body.requiresHumanInput).toBe(true);
  });
});

describe("M33-WU04: Contradiction C closed -- aiqt review human output now renders the same findings JSON exposes", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("review --json exposes the awaiting-checkpoint finding under data.findings AND warnings; review (text) now renders it via the shared warnings channel", () => {
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
    // M33-WU04 Sec 5.7: the same non-blocking finding is now ALSO in the
    // shared warnings channel with a stable key, not only in data.findings.
    expect(
      body.warnings.some((w: { id: string; message: string }) => w.message.includes("awaiting checkpoint capture")),
    ).toBe(true);
    const warningKey = body.warnings.find((w: { message: string }) => w.message.includes("awaiting checkpoint capture")).id;
    expect(warningKey).toMatch(/^workunit:WU\d+:awaiting-checkpoint$/);

    const textRes = runCli(["review"], dir);
    expect(textRes.status).toBe(0);
    expect(textRes.stdout).toContain("awaiting checkpoint capture");
    expect(textRes.stdout).toContain(warningKey);
  });
});

describe("M33-WU04: Contradiction D closed -- specialized-command bypass now trails the shared footer", () => {
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

  it("the equivalent text-mode next now trails the shared footer, surfacing the warning and the recommended command", () => {
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
    // M33-WU04 Sec 5.8: the packet's trailing shared footer now exposes
    // this, closing Contradiction D.
    expect(textRes.stdout).toContain("NEXT-UNRESOLVED-CONTEXT-REF");
    expect(textRes.stdout).toContain("Next recommended command");
    expect(textRes.stdout).toContain("Status: warning");
  });
});

describe("M33-WU02: Contradiction E closed -- missing-project results now agree on the actionable recommendation", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("status, review, and evidence gate policy show retain distinct, family-specific issue ids/areas (by design, M33 Sec 5.10 requires same semantic CATEGORY not identical ids) but now all agree nextRecommendedCommand is \"aiqt init\"", () => {
    dir = makeTempDir(); // deliberately never initialized

    const statusRes = runCli(["status", "--json"], dir);
    const statusBody = JSON.parse(statusRes.stdout === "" ? statusRes.stderr : statusRes.stdout);
    expect(statusBody.blockingIssues[0].id).toBe("STATUS-NO-PROJECT");
    expect(statusBody.blockingIssues[0].area).toBe("workflow");
    expect(statusBody.nextRecommendedCommand).toBe("aiqt init");

    const reviewRes = runCli(["review", "--json"], dir);
    const reviewBody = JSON.parse(reviewRes.stdout === "" ? reviewRes.stderr : reviewRes.stdout);
    expect(reviewBody.blockingIssues[0].id).toBe("REVIEW-NO-PROJECT");
    expect(reviewBody.blockingIssues[0].area).toBe("workflow");
    expect(reviewBody.nextRecommendedCommand).toBe("aiqt init");

    const gateRes = runCli(["evidence", "gate", "policy", "show", "SOME-POLICY", "--json"], dir);
    const gateBody = JSON.parse(gateRes.stdout === "" ? gateRes.stderr : gateRes.stdout);
    expect(gateBody.blockingIssues[0].id).toBe("EVIDENCE-GATE-POLICY-SHOW-NO-PROJECT");
    expect(gateBody.blockingIssues[0].area).toBe("evidence-gate");
    // M33-WU02: familyFailureResult's automatic NO-PROJECT/DIR-MISSING
    // detection now populates this the same way review's bespoke branch
    // always did -- closing the M33-WU01 Contradiction E gap.
    expect(gateBody.nextRecommendedCommand).toBe("aiqt init");

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

describe("M33-WU04: Contradiction G closed -- status --parallel text now trails the shared footer too", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("--parallel --json carries a full CommandResult with data.parallelStatus; --parallel (text) keeps its specialized advisory report but now also trails status/next-command", () => {
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
    // The specialized advisory report body is unchanged (still the primary
    // content, not replaced by the generic renderer)...
    expect(textRes.stdout).toContain("Parallel execution advisory");
    // ...but M33-WU04 Sec 5.8's shared footer now trails it.
    expect(textRes.stdout).toContain(`Status: ${body.status}`);
    expect(textRes.stdout).toContain("Next recommended command");
  });
});

describe("M33-WU03: Contradiction H closed -- --example --json now consistently rejects across all 5 sites", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("plan --example --json is a hard error (exit 3, valid CommandResult JSON)", () => {
    dir = makeTempDir();
    const res = runCli(["plan", "--example", "--json"], dir);
    expect(res.status).toBe(3);
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("PLAN-EXAMPLE-JSON-CONFLICT");
  });

  it("checkpoint --example --json is a hard error (exit 3, valid CommandResult JSON)", () => {
    dir = makeTempDir();
    const res = runCli(["checkpoint", "--example", "--json"], dir);
    expect(res.status).toBe(3);
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("CHECKPOINT-EXAMPLE-JSON-CONFLICT");
  });

  it("execution import --example --json is NOW a hard error too, matching plan/checkpoint (was: silently ignored --json, exit 0, raw non-CommandResult payload)", () => {
    dir = makeTempDir();
    const res = runCli(["execution", "import", "--example", "--json"], dir);
    expect(res.status).toBe(3);
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("EXECUTION-IMPORT-EXAMPLE-JSON-CONFLICT");
  });

  it("execution external example --json is NOW a hard error too (was: a dead option, identical output with or without --json)", () => {
    dir = makeTempDir();
    const res = runCli(["execution", "external", "example", "--json"], dir);
    expect(res.status).toBe(3);
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("EXECUTION-EXTERNAL-EXAMPLE-JSON-CONFLICT");

    // Without --json, the raw example is still printed exactly as before --
    // only the --json combination's behavior changed.
    const withoutJson = runCli(["execution", "external", "example"], dir);
    expect(withoutJson.status).toBe(0);
    expect(() => JSON.parse(withoutJson.stdout)).not.toThrow();
  });

  it("execution adapter claude-code example --json is NOW a hard error too (was: a dead option)", () => {
    dir = makeTempDir();
    const res = runCli(["execution", "adapter", "claude-code", "example", "--json"], dir);
    expect(res.status).toBe(3);
    const body = JSON.parse(res.stdout);
    expect(body.blockingIssues[0].id).toBe("EXECUTION-ADAPTER-CLAUDE-CODE-EXAMPLE-JSON-CONFLICT");
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

describe("M33-WU05: suite-wide stream-policy enforcement across diverse outcome classes", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("--json always lands on stdout with empty stderr, across blocked/needs_input/invalid-input/passed outcomes from unrelated command families", () => {
    dir = makeTempDir();

    // invalid-input (exit 3), no project at all
    const invalidRes = runCli(["review", "--json"], dir);
    expect(invalidRes.status).toBe(3);
    expect(invalidRes.stderr).toBe("");
    expect(() => JSON.parse(invalidRes.stdout)).not.toThrow();

    expect(runCli(["init", "--json"], dir).status).toBe(0);

    // needs_input (exit 10)
    const needsInputRes = runCli(["plan", "--json"], dir);
    expect(needsInputRes.status).toBe(10);
    expect(needsInputRes.stderr).toBe("");
    expect(() => JSON.parse(needsInputRes.stdout)).not.toThrow();

    // blocked (exit 2): no work graph yet
    const blockedRes = runCli(["next", "--json"], dir);
    expect(blockedRes.status).toBe(2);
    expect(blockedRes.stderr).toBe("");
    expect(() => JSON.parse(blockedRes.stdout)).not.toThrow();

    // passed (exit 0)
    const passedRes = runCli(["status", "--json"], dir);
    expect(passedRes.status).toBe(0);
    expect(passedRes.stderr).toBe("");
    expect(() => JSON.parse(passedRes.stdout)).not.toThrow();
  });
});

describe("M33-WU05: human/JSON substantive parity for a further representative specialized command", () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it("aiqt manage: human-mode report and --json agree on status and productionReady/developmentComplete substance", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);

    const jsonRes = runCli(["manage", "--json"], dir);
    expect(jsonRes.status).toBe(0);
    const body = JSON.parse(jsonRes.stdout);

    const textRes = runCli(["manage"], dir);
    expect(textRes.status).toBe(0);
    // The specialized manage report is the primary body (unchanged)...
    expect(textRes.stdout).toContain("AIQT Manager Report");
    // ...and M33-WU04's shared footer now trails it with the same status
    // and next-recommended-command JSON already carries.
    expect(textRes.stdout).toContain(`Status: ${body.status}`);
    expect(textRes.stdout).toContain(String(body.nextRecommendedCommand));
  });
});
