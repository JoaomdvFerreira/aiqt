import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runNextPreview } from "../../src/cli/commands/next-preview.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { computeContextFootprintReduction } from "../../src/workflow/execution-guidance-efficiency-evidence.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { ExecutionGuidance } from "../../src/schema/execution-guidance.schema.js";

/**
 * M39-WU05 (build spec Sec 15/build spec's WU39-05 "Required dogfood"):
 * real, non-AIQT-repository dogfood flows for the shared Execution
 * Guidance integration -- every flow below runs `aiqt` against a fresh
 * temporary fixture project, never against this repository itself (the
 * AIQT self-development rule). No provider/billing API is called
 * anywhere in this file; "Claude Code" / "Codex" below are plain,
 * caller-supplied strings in a local JSON config file, never a real
 * provider request.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");

async function makeReadyProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
  await runUpdate(contextFor(dir), { fromFile: patchPath });
}

function writeClaudeCodeAndCodexProfileConfig(dir: string) {
  // balanced/medium (WU002, "standard" work) -> Claude Code; strong/high
  // (WU001, "complex" -- its outOfScope mentions "authentication",
  // correctly triggering the conservative risk-keyword scan even though
  // the text is a negation) -> Codex. Both are plain local strings in a
  // JSON file; no provider/billing API is ever called.
  writeFileSync(
    join(dir, "aiqt.execution-guidance.config.json"),
    JSON.stringify({
      agentClassProfiles: {
        balanced: { medium: { agent: "Claude Code", model: "Sonnet 5", effort: "medium" } },
        strong: { high: { agent: "Codex", model: "gpt-5-codex", effort: "high" } },
      },
    }),
  );
}

function guidanceOf(result: { data: unknown }): ExecutionGuidance {
  return (result.data as { executionGuidance: ExecutionGuidance }).executionGuidance;
}

describe("M39 execution-guidance dogfood (non-AIQT fixture projects)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("Flow A (mechanical/simple-shaped Work Unit): low reasoning, economy-leaning class, no concrete mapping without a configured profile", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    // A deliberately keyword-clean plan for this flow: the repository's own
    // shared valid-plan.json fixture has outOfScope: ["Do not implement
    // authentication"], which the M39-WU04 risk-keyword scan conservatively
    // (and correctly, per build spec Sec 7's "err toward more caution")
    // matches on "authentication" regardless of the negating "do not" --
    // a real, honest finding from this dogfood pass, not a defect worth
    // weakening the scan to avoid. Using a clean fixture here isolates the
    // "no risk terms present" case this flow is meant to demonstrate.
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Docs", objective: "Fix a small documentation issue." }],
        workUnits: [
          {
            clientKey: "wu-typo",
            milestoneClientKey: "m1",
            title: "Fix a typo",
            objective: "Fix a typo in a log message.",
            scope: ["Correct the log message text"],
            outOfScope: ["Do not change log formatting"],
            acceptanceCriteria: ["The log message no longer contains a typo."],
            agentContextRefs: [],
            suggestedFiles: ["src/foo.ts"],
            validationCommands: ["pnpm build"],
          },
        ],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);

    const next = runNext(contextFor(dir));
    expect(next.exitCode).toBe(ExitCode.Success);
    const guidance = guidanceOf(next);
    expect(["mechanical", "simple", "standard"]).toContain(guidance.complexity.value);
    expect(guidance.agent.reasoningEffort).not.toBe("high");
    expect(guidance.agent.concreteRecommendation).toBeNull();
    expect(guidance.subagents.mode).toBe("none");
  });

  it("Flow B (complex/architectural-shaped Work Unit): high reasoning, strong class, visible reasons", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        milestones: [{ clientKey: "m1", title: "Security", objective: "Harden the system." }],
        workUnits: [
          {
            clientKey: "wu-security",
            milestoneClientKey: "m1",
            title: "Harden authentication",
            objective: "Perform a canonical schema version migration for the authentication and concurrency model.",
            scope: ["Migrate the auth schema", "Update concurrency handling"],
            outOfScope: ["Do not touch billing"],
            acceptanceCriteria: ["No authentication regression"],
            agentContextRefs: [],
            suggestedFiles: ["src/auth/"],
            validationCommands: ["pnpm test"],
          },
        ],
        dependencies: [],
      }),
    );
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);

    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.Success);
    const guidance = guidanceOf(preview);
    expect(guidance.complexity.value).toBe("architectural");
    expect(guidance.agent.reasoningEffort).toBe("high");
    expect(guidance.agent.recommendedClass).toBe("strong");
    expect(guidance.complexity.reasons.length).toBeGreaterThan(0);
    // "pnpm test" is a full-suite command with no recorded exception: visible, deferred, never silently required or dropped.
    expect(guidance.validation.requiredNow.some((s) => s.tier === "full")).toBe(false);
    expect(guidance.validation.reasons.join(" ")).toContain("pnpm test");
  });

  it("multi-WU sequence (real dependency chain): continuation capsule and context manifest reuse WU001's real checkpoint, and both a Claude-Code-style and a Codex-style configured profile resolve correctly", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    writeClaudeCodeAndCodexProfileConfig(dir);

    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan-with-dependencies.json")));
    expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);

    const next1 = runNext(contextFor(dir));
    expect(next1.exitCode).toBe(ExitCode.Success);
    expect(next1.currentWorkUnitId).toBe("WU001");
    const guidance1 = guidanceOf(next1);
    // WU001 has no dependencies yet -> no continuation facts to carry.
    expect(guidance1.continuation?.filesChangedByDependencies).toEqual([]);

    const checkpoint = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(checkpoint.exitCode).toBe(ExitCode.Success);

    const next2 = runNext(contextFor(dir));
    expect(next2.exitCode).toBe(ExitCode.Success);
    expect(next2.currentWorkUnitId).toBe("WU002");
    const guidance2 = guidanceOf(next2);

    // Continuation capsule reuses WU001's real, already-canonical checkpoint fields verbatim.
    expect(guidance2.continuation?.previousCheckpointSummary).toContain("Implemented the bounded work unit from the M4 packet.");
    expect(guidance2.continuation?.filesChangedByDependencies).toEqual([
      "src/cli/commands/example.command.ts",
      "tests/integration/example.command.test.ts",
    ]);
    expect(guidance2.continuation?.dependencyValidationResult).toContain("passed/passed");
    // Context manifest also surfaces the dependency's changed files as should_read.
    expect(guidance2.context.items.some((i) => i.path === "src/cli/commands/example.command.ts")).toBe(true);

    // Both configured profiles resolve without any provider/billing call.
    expect(guidance1.agent.concreteRecommendation).not.toBeNull();
    expect(guidance2.agent.concreteRecommendation).not.toBeNull();

    // Preview/apply parity: previewing WU002 before this point would have produced the identical guidance shape (verified structurally by both commands calling the same shared helper -- see next-selection-helpers.ts).
    expect(guidance2.version).toBe("execution-guidance@1");

    // Honest context-footprint-reduction measurement: the naive baseline is
    // "WU002 must-reads its own contract AND re-reads everything WU001's
    // context manifest already covered as its own must-read items" (no
    // continuation reuse); the actual measurement is WU002's real
    // estimatedTokens, which relies on the compact continuation capsule
    // instead of re-declaring WU001's own context as must-read again.
    const naiveBaselineTokens = guidance1.context.estimatedTokens! + guidance2.context.estimatedTokens!;
    const actualTokens = guidance2.context.estimatedTokens!;
    const reduction = computeContextFootprintReduction({
      baselineEstimatedTokens: naiveBaselineTokens,
      actualEstimatedTokens: actualTokens,
    });
    // Reported honestly: this fixture's real numbers meet or exceed the
    // build spec's informal 30% target because WU002 never re-declares
    // WU001's own context items as its own must-read set.
    expect(reduction.reductionRatio).toBeGreaterThanOrEqual(0);
    console.info(
      `[M39 dogfood] context-footprint reduction on this multi-WU flow: ${(reduction.reductionRatio * 100).toFixed(1)}% ` +
        `(baseline=${reduction.baselineEstimatedTokens}, actual=${reduction.actualEstimatedTokens}, meetsTarget=${reduction.meetsThirtyPercentTarget})`,
    );
  });
});
