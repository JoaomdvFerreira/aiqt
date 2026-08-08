import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";

// M34-WU02: this file spawns real subprocesses (git). Uses the shared
// class constant, not a locally hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });
import { runInit } from "../../src/cli/commands/init.command.js";
import { runReviewStructural } from "../../src/cli/commands/review-structural.command.js";
import { runDefectsIntakeStructural } from "../../src/cli/commands/defects-intake-structural.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { StructuralReview } from "../../src/schema/structural-review.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function writeFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

/**
 * A disposable fixture project directory that ALSO carries a real
 * owner-map with a deliberately missing path -- so structural review has
 * something real, deterministic, and non-benign to find and intake.
 */
function seedFixtureWithStructuralFinding(dir: string): void {
  runInit(contextFor(dir), normalizeInitOptions({}));
  writeFile(
    dir,
    "docs/governance/repository-owner-map.json",
    JSON.stringify({ protocolVersion: "x@1", entries: { fixtureOwner: { primary: "src/does-not-exist.ts", supporting: [] } } }),
  );
  // Structural review binds every finding to a commit (Section 3.4) --
  // a real, disposable dogfood target is a real (if minimal) git repo.
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" };
  execFileSync("git", ["init", "-q"], { cwd: dir, env: gitEnv });
  execFileSync("git", ["add", "-A"], { cwd: dir, env: gitEnv });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: dir, env: gitEnv });
}

describe("aiqt defects intake-structural", () => {
  let dir: string;
  afterEach(() => {
    if (dir) removeDir(dir);
  });

  it("intakes a fresh, eligible finding as a new candidate-status defect", async () => {
    dir = makeTempDir();
    seedFixtureWithStructuralFinding(dir);

    const reviewed = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const review = (reviewed.data as { review: StructuralReview }).review;
    expect(review.findings.length).toBeGreaterThan(0);
    const findingKey = review.findings[0].findingKey;

    const intake = await runDefectsIntakeStructural(contextFor(dir), findingKey, {});
    expect(intake.exitCode).toBe(ExitCode.Success);
    const data = intake.data as { created: DefectRecord[] };
    expect(data.created).toHaveLength(1);
    expect(data.created[0].status).toBe("candidate");
    expect(data.created[0].sourceKind).toBe("review_finding");

    const finalState = readState(dir);
    expect(finalState.defects).toHaveLength(1);
  });

  it("repeated intake of the identical finding enriches instead of duplicating", async () => {
    dir = makeTempDir();
    seedFixtureWithStructuralFinding(dir);
    const reviewed = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findingKey = (reviewed.data as { review: StructuralReview }).review.findings[0].findingKey;

    const first = await runDefectsIntakeStructural(contextFor(dir), findingKey, {});
    expect((first.data as { created: unknown[] }).created).toHaveLength(1);
    const second = await runDefectsIntakeStructural(contextFor(dir), findingKey, {});
    expect(second.exitCode).toBe(ExitCode.Success);
    const secondData = second.data as { created: unknown[]; enriched: unknown[] };
    expect(secondData.created).toHaveLength(0);
    expect(secondData.enriched).toHaveLength(1);

    const finalState = readState(dir);
    expect(finalState.defects).toHaveLength(1);
  });

  it("rejects intake of an unknown finding key", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runDefectsIntakeStructural(contextFor(dir), "sha256:" + "0".repeat(64), {});
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("--preview does not persist", async () => {
    dir = makeTempDir();
    seedFixtureWithStructuralFinding(dir);
    const reviewed = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findingKey = (reviewed.data as { review: StructuralReview }).review.findings[0].findingKey;

    const result = await runDefectsIntakeStructural(contextFor(dir), findingKey, { preview: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const finalState = readState(dir);
    expect(finalState.defects).toBeUndefined();
  });

  it("requires an initialized project", async () => {
    dir = makeTempDir();
    const result = await runDefectsIntakeStructural(contextFor(dir), "sha256:" + "0".repeat(64), {});
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });
});
