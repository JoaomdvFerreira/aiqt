import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runEvidenceImport } from "../../src/cli/commands/evidence-import.command.js";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { contextFor, makeTempDir, removeDir } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const NOW = "2026-01-01T00:00:00.000Z";

const UNKNOWN_PROJECT_SECTION = {
  producer: "future-aiqt",
  feature: "compatible-project-section",
  nested: { retained: true },
};

const UNKNOWN_STATE_SECTION = {
  producer: "future-aiqt",
  feature: "compatible-state-section",
  nested: { retained: true },
};

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

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function addUnknownSection(path: string, key: string, value: unknown): void {
  const model = readJson(path);
  model[key] = value;
  writeJson(path, model);
}

async function makeReadyProject(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeJson(patchPath, { context: { constraints: ["Local files are the source of truth"] } });
  const result = await runUpdate(contextFor(dir), { fromFile: patchPath });
  expect(result.exitCode).toBe(ExitCode.Success);
}

function seedEvidenceWorkUnit(dir: string): void {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = readJson(statePath);
  state.workGraph.workUnits.push({
    id: "WU001",
    milestoneId: "M001",
    title: "Evidence target",
    objective: "Import evidence against this target.",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
  });
  state.workGraph.milestones.push({
    id: "M001",
    title: "M",
    objective: "O",
    status: "ready",
    workUnitIds: ["WU001"],
  });
  writeJson(statePath, state);
}

function manualEvidencePayload() {
  return {
    format: "manual-evidence-json@1",
    source: { providerId: "human-reviewer" },
    binding: {
      workUnitId: "WU001",
      packetId: "PKT-001",
      implementationRootId: "ROOT-1",
      capturedAt: NOW,
    },
    reviewer: { independentContext: "declared_independent" },
    results: {
      reviewResult: "passed",
      validationResult: "passed",
      acceptanceCriteriaResult: "passed",
      summary: "ok",
    },
  };
}

describe("compatible unknown top-level canonical fields", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("update preserves unknown top-level project and state sections", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
    const projectPath = join(dir, ".aiqt", "project.json");
    const statePath = join(dir, ".aiqt", "state.json");
    addUnknownSection(projectPath, "futureProjectSection", UNKNOWN_PROJECT_SECTION);
    addUnknownSection(statePath, "futureStateSection", UNKNOWN_STATE_SECTION);

    const patchPath = join(dir, "readiness-patch.json");
    writeJson(patchPath, { context: { constraints: ["Local files are the source of truth"] } });
    const result = await runUpdate(contextFor(dir), { fromFile: patchPath });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readJson(projectPath).futureProjectSection).toEqual(UNKNOWN_PROJECT_SECTION);
    expect(readJson(statePath).futureStateSection).toEqual(UNKNOWN_STATE_SECTION);
  });

  it("initial plan preserves an unknown top-level state section", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    addUnknownSection(statePath, "futureStateSection", UNKNOWN_STATE_SECTION);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));

    const result = runPlan(contextFor(dir), { fromFile: planPath });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readJson(statePath).futureStateSection).toEqual(UNKNOWN_STATE_SECTION);
  });

  it("checkpoint preserves an unknown top-level state section", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
    expect(runNext(contextFor(dir)).exitCode).toBe(ExitCode.Success);
    const statePath = join(dir, ".aiqt", "state.json");
    addUnknownSection(statePath, "futureStateSection", UNKNOWN_STATE_SECTION);

    const result = runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readJson(statePath).futureStateSection).toEqual(UNKNOWN_STATE_SECTION);
  });

  it("evidence import preserves an unknown top-level state section", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    seedEvidenceWorkUnit(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    addUnknownSection(statePath, "futureStateSection", UNKNOWN_STATE_SECTION);
    const payloadPath = join(dir, "evidence.json");
    writeJson(payloadPath, manualEvidencePayload());

    const result = await runEvidenceImport(contextFor(dir), { fromFile: payloadPath });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readJson(statePath).futureStateSection).toEqual(UNKNOWN_STATE_SECTION);
  });
});
