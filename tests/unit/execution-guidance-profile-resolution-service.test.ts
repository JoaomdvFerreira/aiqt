import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir } from "../helpers.js";
import {
  resolveExecutionGuidanceProfileConfig,
  DEFAULT_EXECUTION_GUIDANCE_PROFILE_CONFIG_FILENAME,
} from "../../src/services/execution-guidance-profile-resolution-service.js";
import { resolveConcreteRecommendation } from "../../src/workflow/execution-guidance.js";

describe("execution-guidance-profile-resolution-service (M39-WU03)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) removeDir(dir);
  });

  it("returns ok/null when the default config file is absent (generic guidance keeps working)", () => {
    dir = makeTempDir();
    const outcome = resolveExecutionGuidanceProfileConfig({ cwd: dir });
    expect(outcome).toEqual({ ok: true, config: null });
  });

  it("loads a valid default-named project config file and makes it usable for a concrete lookup", () => {
    dir = makeTempDir();
    writeFileSync(
      join(dir, DEFAULT_EXECUTION_GUIDANCE_PROFILE_CONFIG_FILENAME),
      JSON.stringify({ agentClassProfiles: { balanced: { medium: { agent: "Claude Code", model: "Sonnet 5", effort: "medium" } } } }),
    );
    const outcome = resolveExecutionGuidanceProfileConfig({ cwd: dir });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(resolveConcreteRecommendation("balanced", "medium", outcome.config)).toEqual({
        agent: "Claude Code",
        model: "Sonnet 5",
        effort: "medium",
      });
    }
  });

  it("fails closed (not silently ignored) on a malformed config file", () => {
    dir = makeTempDir();
    writeFileSync(join(dir, DEFAULT_EXECUTION_GUIDANCE_PROFILE_CONFIG_FILENAME), "{ not valid json");
    const outcome = resolveExecutionGuidanceProfileConfig({ cwd: dir });
    expect(outcome.ok).toBe(false);
  });

  it("honors an explicit configPath override", () => {
    dir = makeTempDir();
    const explicitPath = join(dir, "custom-profile.json");
    writeFileSync(explicitPath, JSON.stringify({ agentClassProfiles: { economy: { low: { agent: "X", model: null, effort: "low" } } } }));
    const outcome = resolveExecutionGuidanceProfileConfig({ cwd: dir, configPath: explicitPath });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.config?.agentClassProfiles?.economy?.low?.agent).toBe("X");
  });
});
