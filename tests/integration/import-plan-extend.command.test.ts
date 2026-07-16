import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");

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
    { clientKey: "m1", title: "Corte 0", objective: "First cut." },
    { clientKey: "m2", title: "Corte 1 Roadmap", objective: "Placeholder for Corte 1." },
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
      title: "Corte 1 placeholder",
      objective: "Corte 1 placeholder objective.",
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

const EXTENSION_INPUT = {
  extension: {
    entryWorkUnitClientKeys: ["e1"],
    exitWorkUnitClientKeys: ["e1"],
    reason: "Detail Corte 1 via import.",
  },
  milestones: [{ clientKey: "c1-m", title: "Corte 1 detail", objective: "Detailed Corte 1 work." }],
  workUnits: [
    {
      clientKey: "e1",
      milestoneClientKey: "c1-m",
      title: "Corte 1 entry/exit",
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

describe("aiqt import plan --stdin --extend: A3/A4 delegation", () => {
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
      { importType: "plan", stdin: true, extend: true, replacePlaceholder: "WU002" },
      { stdin: stdinWith(JSON.stringify(EXTENSION_INPUT)) },
    );
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.action).toBe("import");
    const data = result.data as { operation: string; placeholderFinalStatus: string };
    expect(data.operation).toBe("extend");
    expect(data.placeholderFinalStatus).toBe("replanned");

    const state = readState(dir);
    const placeholder = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU002");
    expect(placeholder.status).toBe("replanned");
  });

  it("A4: --preview via import performs no mutation and appends no runlog event", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");

    const result = await runImport(
      contextFor(dir),
      { importType: "plan", stdin: true, extend: true, replacePlaceholder: "WU002", preview: true },
      { stdin: stdinWith(JSON.stringify(EXTENSION_INPUT)) },
    );
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { preview: boolean; mutationPerformed: boolean };
    expect(data.preview).toBe(true);
    expect(data.mutationPerformed).toBe(false);

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(runlogBefore);
  });
});

describe("aiqt import plan --stdin --extend: real CLI process", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("extends the graph end-to-end through the actual CLI entrypoint", async () => {
    dir = makeTempDir();
    await makeExtendableProject(dir);

    const res = spawnSync(
      process.execPath,
      [tsxCli, entry, "import", "plan", "--stdin", "--extend", "--replace-placeholder", "WU002", "--json"],
      { cwd: dir, encoding: "utf8", input: JSON.stringify(EXTENSION_INPUT) },
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.operation).toBe("extend");
    expect(parsed.data.placeholderFinalStatus).toBe("replanned");
  });
});
