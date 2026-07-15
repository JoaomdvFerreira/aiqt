import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runExport } from "../../src/cli/commands/export.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

function readRunlogLines(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

async function buildProjectWithPacket(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt next: M15 Source Control Expectations packet section", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("renders Source Control Expectations deterministically, after Component System Guidance and before Required Agent Output", async () => {
    dir = makeTempDir();
    await buildProjectWithPacket(dir);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { packet: string };
    expect(data.packet).toContain("## Source Control Expectations");
    expect(data.packet).toContain("feat(WU001)");
    expect(data.packet).toContain("m001-wu001-done");

    const sourceControlIndex = data.packet.indexOf("## Source Control Expectations");
    const requiredOutputIndex = data.packet.indexOf("## Required Agent Output");
    expect(sourceControlIndex).toBeGreaterThan(-1);
    expect(requiredOutputIndex).toBeGreaterThan(sourceControlIndex);
  });

  it("writes includesSourceControlGuidance: true into agent_packet.created runlog event data", async () => {
    dir = makeTempDir();
    await buildProjectWithPacket(dir);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const packetId = (result.data as { packetId: string }).packetId;

    const runlogLines = readRunlogLines(dir);
    const packetEvent = runlogLines.find(
      (e) => e.type === "agent_packet.created" && e.data.packetId === packetId,
    )!;
    expect(packetEvent).toBeDefined();
    expect(packetEvent.data.renderedSections).toContain("sourceControlExpectations");
    expect((packetEvent.data.guidanceFlags as Record<string, boolean>).includesSourceControlGuidance).toBe(
      true,
    );
  });
});

describe("aiqt export agent-packet: M15 source-control guidance audit metadata", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("displays whether source-control guidance was included", async () => {
    dir = makeTempDir();
    await buildProjectWithPacket(dir);
    runNext(contextFor(dir));

    const result = runExport(contextFor(dir), { target: "agent-packet" });
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const packetId = state.lastAgentPacket.id;
    const content = readFileSync(
      join(dir, ".aiqt", "exports", `agent-packet-${packetId}.md`),
      "utf8",
    );
    expect(content).toContain("## Packet Audit Metadata");
    expect(content).toContain("- Source Control Guidance: yes");
  });

  it("degrades gracefully for older packets with no includesSourceControlGuidance flag", async () => {
    dir = makeTempDir();
    await buildProjectWithPacket(dir);
    runNext(contextFor(dir));

    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const lines = readFileSync(runlogPath, "utf8").trim().split(/\r?\n/);
    const rewritten = lines.map((line) => {
      const event = JSON.parse(line);
      if (event.type === "agent_packet.created") {
        delete event.data.renderedSections;
        delete event.data.guidanceFlags;
      }
      return JSON.stringify(event);
    });
    writeFileSync(runlogPath, rewritten.join("\n") + "\n");

    const result = runExport(contextFor(dir), { target: "agent-packet" });
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const packetId = state.lastAgentPacket.id;
    const content = readFileSync(
      join(dir, ".aiqt", "exports", `agent-packet-${packetId}.md`),
      "utf8",
    );
    expect(content).toContain("Guidance audit metadata is unavailable for this packet.");
    expect(content).not.toContain("Source Control Guidance");
  });
});
