import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readRunlogLines(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

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

describe("aiqt next: M14 packet audit metadata in agent_packet.created runlog data", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("writes renderedSections and guidanceFlags for a UI-heavy, shadcn/ui, existingRepositoryPath project", async () => {
    dir = makeTempDir();
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

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const packetId = (result.data as { packetId: string }).packetId;

    const runlogLines = readRunlogLines(dir);
    const packetEvent = runlogLines.find(
      (e) => e.type === "agent_packet.created" && e.data.packetId === packetId,
    )!;
    expect(packetEvent).toBeDefined();
    expect(packetEvent.data.renderedSections).toEqual(
      expect.arrayContaining([
        "scope",
        "context",
        "constraints",
        "acceptance",
        "validation",
        "designGuidance",
        "workingDirectoryDiscipline",
        "componentSystemGuidance",
      ]),
    );
    expect(packetEvent.data.guidanceFlags).toEqual({
      includesDesignGuidance: true,
      includesWorkingDirectoryDiscipline: true,
      includesComponentSystemGuidance: true,
      includesRecoveryGuidance: false,
    });

    // Preserves all existing AgentPacketMetadata fields.
    expect(packetEvent.data.packetId).toBe(packetId);
    expect(packetEvent.data.workUnitId).toBe("WU001");
    expect(packetEvent.data.milestoneId).toBe("M001");
    expect(typeof packetEvent.data.contentHash).toBe("string");
    expect(packetEvent.data.format).toBe("markdown");
  });

  it("mirrors renderedSections/guidanceFlags onto state.lastAgentPacket without dropping any existing field", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "A CLI tool that renames files.", targetUser: ["devs"] });
    const patchPath = join(dir, "readiness-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    await runUpdate(contextFor(dir), { fromFile: patchPath });

    const planPath = join(dir, "plan.json");
    const plan = {
      milestones: [{ clientKey: "m1", title: "Foundation", objective: "Build the CLI." }],
      workUnits: [
        {
          clientKey: "cli-entry",
          milestoneClientKey: "m1",
          title: "CLI entry point",
          objective: "Build the CLI entry point.",
          scope: ["Implement the entry point"],
          outOfScope: ["Do not implement other CLI commands"],
          acceptanceCriteria: ["CLI runs"],
          agentContextRefs: [],
          suggestedFiles: ["src/cli.ts"],
          validationCommands: ["pnpm test"],
        },
      ],
      dependencies: [],
    };
    writeFileSync(planPath, JSON.stringify(plan));
    runPlan(contextFor(dir), { fromFile: planPath });

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);
    expect(state.lastAgentPacket.id).toBeTruthy();
    expect(state.lastAgentPacket.workUnitId).toBe("WU001");
    expect(state.lastAgentPacket.milestoneId).toBe("M001");
    expect(state.lastAgentPacket.sourceCommand).toBe("aiqt next");
    expect(typeof state.lastAgentPacket.contentHash).toBe("string");
    expect(typeof state.lastAgentPacket.createdAt).toBe("string");
    expect(state.lastAgentPacket.format).toBe("markdown");
    expect(Array.isArray(state.lastAgentPacket.renderedSections)).toBe(true);
    expect(state.lastAgentPacket.guidanceFlags).toEqual({
      includesDesignGuidance: false,
      includesWorkingDirectoryDiscipline: false,
      includesComponentSystemGuidance: false,
      includesRecoveryGuidance: false,
    });
  });

  it("does not introduce a new runlog event type", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "A CLI tool.", targetUser: ["devs"] });
    const patchPath = join(dir, "readiness-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    await runUpdate(contextFor(dir), { fromFile: patchPath });

    const planPath = join(dir, "plan.json");
    const plan = {
      milestones: [{ clientKey: "m1", title: "Foundation", objective: "Build the CLI." }],
      workUnits: [
        {
          clientKey: "cli-entry",
          milestoneClientKey: "m1",
          title: "CLI entry point",
          objective: "Build the CLI entry point.",
          scope: ["Implement the entry point"],
          outOfScope: ["Do not implement other CLI commands"],
          acceptanceCriteria: ["CLI runs"],
          agentContextRefs: [],
          suggestedFiles: ["src/cli.ts"],
          validationCommands: ["pnpm test"],
        },
      ],
      dependencies: [],
    };
    writeFileSync(planPath, JSON.stringify(plan));
    runPlan(contextFor(dir), { fromFile: planPath });
    runNext(contextFor(dir));

    const runlogLines = readRunlogLines(dir);
    const eventTypes = new Set(runlogLines.map((e) => e.type));
    for (const type of eventTypes) {
      expect([
        "project.initialized",
        "project.updated",
        "work_graph.generated",
        "agent_packet.created",
        "work_unit.status_changed",
      ]).toContain(type);
    }
  });
});
