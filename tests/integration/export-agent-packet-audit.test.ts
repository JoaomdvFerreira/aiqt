import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runExport } from "../../src/cli/commands/export.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const UI_PLAN = {
  milestones: [{ clientKey: "m1", title: "Foundation", objective: "Build the marketplace foundation." }],
  workUnits: [
    {
      clientKey: "profile-page",
      milestoneClientKey: "m1",
      title: "Build the user profile page",
      objective: "Implement the profile page component and layout.",
      scope: ["Create the profile page route", "Add a profile form component"],
      outOfScope: ["Do not implement admin dashboard"],
      acceptanceCriteria: ["Profile page renders with the user's data"],
      agentContextRefs: [],
      suggestedFiles: ["src/app/profile/page.tsx", "src/components/ui/profile-form.tsx"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [],
};

async function buildUiHeavyProjectWithPacket(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), {
    objective: "Build a Next.js and React marketplace with a booking flow using shadcn/ui and Tailwind.",
    targetUser: ["Client"],
  });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  await runUpdate(contextFor(dir), { repositoryPath: join(dir, "app-repo") });

  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(UI_PLAN));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt export agent-packet: M14 packet audit metadata", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("displays packet audit metadata read from the agent_packet.created runlog event", async () => {
    dir = makeTempDir();
    await buildUiHeavyProjectWithPacket(dir);

    const result = runExport(contextFor(dir), { target: "agent-packet" });
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const packetId = state.lastAgentPacket.id;
    const content = readFileSync(
      join(dir, ".aiqt", "exports", `agent-packet-${packetId}.md`),
      "utf8",
    );
    expect(content).toContain("## Packet Audit Metadata");
    expect(content).toContain("Rendered sections:");
    expect(content).toContain("- Design Guidance: yes");
    expect(content).toContain("- Working Directory Discipline: yes");
    expect(content).toContain("- Component System Guidance: yes");
    expect(content).toContain("- Recovery Guidance: no");
    expect(content).toContain("Audit source: agent_packet.created runlog event");
  });

  it("degrades gracefully when the runlog has no audit metadata for the packet (older packet)", async () => {
    dir = makeTempDir();
    await buildUiHeavyProjectWithPacket(dir);

    // Simulate an older, pre-M14 runlog entry: strip renderedSections/guidanceFlags
    // from the agent_packet.created event, mirroring a packet created before M14.
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
    expect(content).toContain("## Packet Audit Metadata");
    expect(content).toContain("Guidance audit metadata is unavailable for this packet.");
    expect(content).not.toContain("Audit source: agent_packet.created runlog event");
  });

  it("still shows the pre-existing packet metadata fields (id, workUnitId, milestoneId, createdAt, contentHash)", async () => {
    dir = makeTempDir();
    await buildUiHeavyProjectWithPacket(dir);
    const result = runExport(contextFor(dir), { target: "agent-packet" });
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const packetId = state.lastAgentPacket.id;
    const content = readFileSync(
      join(dir, ".aiqt", "exports", `agent-packet-${packetId}.md`),
      "utf8",
    );
    expect(content).toContain(`Packet ID: ${packetId}`);
    expect(content).toContain(`Work Unit ID: ${state.lastAgentPacket.workUnitId}`);
    expect(content).toContain(`Milestone ID: ${state.lastAgentPacket.milestoneId}`);
    expect(content).toContain(`Created At: ${state.lastAgentPacket.createdAt}`);
    expect(content).toContain(`Content Hash: ${state.lastAgentPacket.contentHash}`);
  });
});
