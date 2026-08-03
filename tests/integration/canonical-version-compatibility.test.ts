import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { copyFixture, removeDir, contextFor } from "../helpers.js";
import { readProjectModel, writeProjectModel } from "../../src/state/project-store.js";
import { readStateModel, writeStateModel } from "../../src/state/workflow-state-store.js";

function readCanonicalFiles(dir: string) {
  return {
    project: readFileSync(join(dir, ".aiqt", "project.json"), "utf8"),
    state: readFileSync(join(dir, ".aiqt", "state.json"), "utf8"),
    runlog: readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8"),
  };
}

function setCanonicalVersion(path: string, version: string): void {
  const model = JSON.parse(readFileSync(path, "utf8"));
  model.version = version;
  writeFileSync(path, JSON.stringify(model, null, 2) + "\n");
}

describe("canonical schema version compatibility", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("accepts the maintained initialized-project fixture as a compatible historical canonical fixture", () => {
    dir = copyFixture("initialized-project");

    const result = runStatus(contextFor(dir, true));

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
  });

  it("accepts an older compatible project/state version without mutating the canonical fixture", () => {
    dir = copyFixture("initialized-project");
    setCanonicalVersion(join(dir, ".aiqt", "project.json"), "0.4.0");
    setCanonicalVersion(join(dir, ".aiqt", "state.json"), "0.4.0");
    const before = readCanonicalFiles(dir);

    const result = runStatus(contextFor(dir, true));

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readCanonicalFiles(dir)).toEqual(before);
  });

  it("rejects an unsupported future project.json version before update can write any canonical file", async () => {
    dir = copyFixture("initialized-project");
    setCanonicalVersion(join(dir, ".aiqt", "project.json"), "9.9.9");
    const before = readCanonicalFiles(dir);

    const result = await runUpdate(contextFor(dir), { objective: "Changed" });

    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0]?.id).toBe("VERSION-UNSUPPORTED");
    expect(readCanonicalFiles(dir)).toEqual(before);
  });

  it("rejects an unsupported future state.json version before update can write any canonical file", async () => {
    dir = copyFixture("initialized-project");
    setCanonicalVersion(join(dir, ".aiqt", "state.json"), "9.9.9");
    const before = readCanonicalFiles(dir);

    const result = await runUpdate(contextFor(dir), { objective: "Changed" });

    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0]?.id).toBe("VERSION-UNSUPPORTED");
    expect(readCanonicalFiles(dir)).toEqual(before);
  });

  it("rejects an incompatible older state.json version before update can write any canonical file", async () => {
    dir = copyFixture("initialized-project");
    setCanonicalVersion(join(dir, ".aiqt", "state.json"), "0.0.0");
    const before = readCanonicalFiles(dir);

    const result = await runUpdate(contextFor(dir), { objective: "Changed" });

    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0]?.id).toBe("VERSION-OLDER-INCOMPATIBLE");
    expect(readCanonicalFiles(dir)).toEqual(before);
  });

  it("state writer rejects a future model version before overwriting the target file", () => {
    dir = copyFixture("initialized-project");
    const statePath = join(dir, ".aiqt", "state.json");
    const before = readFileSync(statePath, "utf8");
    const state = { ...readStateModel(statePath), version: "9.9.9" };

    expect(() => writeStateModel(statePath, state)).toThrow();
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  it("project writer rejects a future model version before overwriting the target file", () => {
    dir = copyFixture("initialized-project");
    const projectPath = join(dir, ".aiqt", "project.json");
    const before = readFileSync(projectPath, "utf8");
    const project = { ...readProjectModel(projectPath), version: "9.9.9" };

    expect(() => writeProjectModel(projectPath, project)).toThrow();
    expect(readFileSync(projectPath, "utf8")).toBe(before);
  });
});
