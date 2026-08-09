import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runImport } from "../../src/cli/commands/import.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { BUILT_CLI_ENTRY } from "../cli-runner.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });


const DONE_PAYLOAD = {
  summary: "Implemented.",
  completed: ["Implemented."],
  notCompleted: [],
  filesChanged: ["src/example.ts"],
  validationResult: "passed",
  acceptanceCriteriaResult: "passed",
  validationCommands: [{ command: "pnpm test", result: "passed" }],
  acceptanceCriteria: [{ criterion: "Works", result: "passed" }],
  issues: [],
  notes: [],
};

const BASE_PLAN = {
  milestones: [
    { clientKey: "m1", title: "Completed upstream work", objective: "Foundational work already done." },
    { clientKey: "m2", title: "Refinable future work", objective: "Placeholder for future detailed work." },
  ],
  workUnits: [
    {
      clientKey: "wu1",
      milestoneClientKey: "m1",
      title: "First unit",
      objective: "First unit objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu2",
      milestoneClientKey: "m2",
      title: "Refinable future work unit",
      objective: "Future work objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [{ fromClientKey: "wu1", toClientKey: "wu2", type: "blocks" }],
};

const REFINEMENT_INPUT = {
  extension: {
    entryWorkUnitClientKeys: ["e1"],
    exitWorkUnitClientKeys: ["e1"],
    reason: "Detail the refinable future work via import.",
  },
  milestones: [{ clientKey: "r-m", title: "Refinement detail", objective: "Detailed replacement work." }],
  workUnits: [
    {
      clientKey: "e1",
      milestoneClientKey: "r-m",
      title: "Replacement entry/exit",
      objective: "Entry/exit objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [],
};

const APPEND_INPUT = {
  milestones: [],
  workUnits: [
    {
      clientKey: "a1",
      // "M001" is the existing canonical milestone id ("m1"'s clientKey was
      // only used at initial-plan time), demonstrating append targeting an
      // already-existing milestone rather than declaring a new one.
      milestoneClientKey: "M001",
      title: "Appended unit",
      objective: "Appended objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [],
};

async function makeExtendableProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(BASE_PLAN));
  expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
  expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
  expect(runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD }).exitCode).toBe(ExitCode.Success);
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

/** A real PassThrough stream pre-loaded with text, standing in for process.stdin. */
function stdinWith(text: string, isTTY = false): PassThrough & { isTTY?: boolean } {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
  stream.isTTY = isTTY;
  stream.end(text);
  return stream;
}

describe("aiqt import plan --stdin --extend --refine-work-unit: A3/A4 delegation", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("A3: produces the same canonical result as the direct --from-file path", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const result = await runImport(
      contextFor(dir),
      { importType: "plan", stdin: true, extend: true, refineWorkUnit: "WU002" },
      { stdin: stdinWith(JSON.stringify(REFINEMENT_INPUT)) },
    );
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.action).toBe("import");
    const data = result.data as { operation: string; targetFinalStatus: string };
    expect(data.operation).toBe("refine");
    expect(data.targetFinalStatus).toBe("replanned");

    const state = readState(dir);
    const target = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
    expect(target.status).toBe("replanned");
  });

  it("A4: --preview via import performs no mutation and appends no runlog event", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

    const result = await runImport(
      contextFor(dir),
      { importType: "plan", stdin: true, extend: true, refineWorkUnit: "WU002", preview: true },
      { stdin: stdinWith(JSON.stringify(REFINEMENT_INPUT)) },
    );
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { preview: boolean; mutationPerformed: boolean };
    expect(data.preview).toBe(true);
    expect(data.mutationPerformed).toBe(false);

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  });

  it("appends through import with no refinement target, reporting operation 'append'", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const result = await runImport(
      contextFor(dir),
      { importType: "plan", stdin: true, extend: true },
      { stdin: stdinWith(JSON.stringify(APPEND_INPUT)) },
    );
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { operation: string };
    expect(data.operation).toBe("append");
  });

  it("still refines through the deprecated --replace-placeholder alias", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const result = await runImport(
      contextFor(dir),
      { importType: "plan", stdin: true, extend: true, replacePlaceholder: "WU002" },
      { stdin: stdinWith(JSON.stringify(REFINEMENT_INPUT)) },
    );
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { operation: string };
    expect(data.operation).toBe("refine");
    expect(result.warnings.some((w) => w.id === "PLAN-EXTEND-DEPRECATED-ALIAS")).toBe(true);
  });
});

describe("aiqt import plan --stdin --extend: real CLI process", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("refines the graph end-to-end through the actual CLI entrypoint", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const res = spawnSync(
      process.execPath,
      [BUILT_CLI_ENTRY, "import", "plan", "--stdin", "--extend", "--refine-work-unit", "WU002", "--json"],
      { cwd: dir, encoding: "utf8", input: JSON.stringify(REFINEMENT_INPUT) },
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.operation).toBe("refine");
    expect(parsed.data.targetFinalStatus).toBe("replanned");
  });

  it("appends to the graph end-to-end through the actual CLI entrypoint", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const res = spawnSync(
      process.execPath,
      [BUILT_CLI_ENTRY, "import", "plan", "--stdin", "--extend", "--json"],
      { cwd: dir, encoding: "utf8", input: JSON.stringify(APPEND_INPUT) },
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.operation).toBe("append");
  });
});
