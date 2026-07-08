import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("init -> update -> next flow", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("recommends aiqt update until context is sufficient, then aiqt plan", async () => {
    dir = makeTempDir();
    expect(runInit(contextFor(dir), normalizeInitOptions({})).exitCode).toBe(
      ExitCode.Success,
    );

    let next = runNext(contextFor(dir));
    expect(next.nextRecommendedCommand).toBe("aiqt update");

    // objective + targetUser alone is not structurally sufficient yet
    // (no requirement/constraint/tech-preference/business-rule/architecture-note).
    const partialUpdate = await runUpdate(contextFor(dir), {
      objective: "Ship a CLI",
      targetUser: ["devs"],
    });
    expect(partialUpdate.exitCode).toBe(ExitCode.Success);
    expect(partialUpdate.nextRecommendedCommand).toBe("aiqt update");

    next = runNext(contextFor(dir));
    expect(next.nextRecommendedCommand).toBe("aiqt update");

    // Supply a structural item (a constraint) via --from-file.
    const patchPath = join(dir, "structural-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    const finalUpdate = await runUpdate(contextFor(dir), { fromFile: patchPath });
    expect(finalUpdate.exitCode).toBe(ExitCode.Success);
    expect(finalUpdate.nextRecommendedCommand).toBe("aiqt plan");
    expect((finalUpdate.data as Record<string, unknown>).planningContextReady).toBe(true);

    next = runNext(contextFor(dir));
    expect(next.nextRecommendedCommand).toBe("aiqt plan");

    const status = runStatus(contextFor(dir));
    expect(status.exitCode).toBe(ExitCode.Success);
    expect(status.projectStatus).toBe("draft");
    expect(status.nextRecommendedCommand).toBe("aiqt plan");
  });
});
