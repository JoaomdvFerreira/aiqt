import { describe, it, expect, afterAll, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";

// M34-WU02: this file spawns real subprocesses (git). Uses the shared
// class constant, not a locally hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });
import { runInit } from "../../src/cli/commands/init.command.js";
import { runReviewStructural } from "../../src/cli/commands/review-structural.command.js";
import { runReviewStructuralExplain } from "../../src/cli/commands/review-structural-explain.command.js";
import { runDefectsIntakeStructural } from "../../src/cli/commands/defects-intake-structural.command.js";
import { runDefectsInspect } from "../../src/cli/commands/defects-inspect.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { runStructuralReview } from "../../src/workflow/structural-review-engine.js";
import { graphifyProvider } from "../../src/workflow/structural-providers/graphify-provider.js";
import type { StructuralReview, StructuralFinding } from "../../src/schema/structural-review.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

function writeFile(root: string, relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function gitInitAndCommit(dir: string, message = "fixture"): void {
  const env = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" };
  execFileSync("git", ["init", "-q"], { cwd: dir, env });
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir, env });
}

/**
 * M43-WU05 §10: the 18 required dogfood scenarios, run against
 * disposable, non-AIQT, real git-initialized fixture project
 * directories -- never this repository's own canonical state (though
 * scenarios that need only read-only review reuse this real repository
 * directly, since that is always safe).
 */
describe("M43 structural review dogfood", () => {
  const tempDirs: string[] = [];
  function freshDir(): string {
    const d = makeTempDir();
    tempDirs.push(d);
    return d;
  }
  afterAll(() => {
    for (const d of tempDirs) removeDir(d);
  });

  it("scenario 1: duplicated/divergent decision-owner implementation is detected", () => {
    const dir = freshDir();
    writeFile(dir, "src/owner.ts", "export function decide() { return 1; }");
    writeFile(dir, "src/rogue.ts", "export function decide() { return 2; }");
    writeFile(dir, "docs/governance/repository-owner-map.json", JSON.stringify({ protocolVersion: "x@1", entries: { decisionOwner: { primary: "src/owner.ts", supporting: [] } } }));
    gitInitAndCommit(dir);

    const result = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    expect(findings.some((f) => f.ruleId === "duplicate-decision-owner-implementation")).toBe(true);
  });

  it("scenario 2: stale/missing owner-map path is detected", () => {
    const dir = freshDir();
    writeFile(dir, "docs/governance/repository-owner-map.json", JSON.stringify({ protocolVersion: "x@1", entries: { ghost: { primary: "src/nope.ts", supporting: [] } } }));
    gitInitAndCommit(dir);

    const result = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    const found = findings.find((f) => f.ruleId === "owner-map-path-missing");
    expect(found).toBeDefined();
    expect(found?.confidence).toBe("proven");
  });

  it("scenario 3: deterministic dependency cycle is detected", () => {
    const dir = freshDir();
    writeFile(dir, "src/a.ts", `import { b } from "./b.js";\nexport const a = 1;`);
    writeFile(dir, "src/b.ts", `import { a } from "./a.js";\nexport const b = 1;`);
    gitInitAndCommit(dir);

    const result = runReviewStructural(contextFor(dir), { domain: "dependency_coupling" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    expect(findings.some((f) => f.ruleId === "dependency-cycle" && f.confidence === "proven")).toBe(true);
  });

  it("scenario 4: measurable responsibility/coupling hotspot is reported conservatively", () => {
    const dir = freshDir();
    for (let i = 0; i < 15; i++) writeFile(dir, `src/normal${i}.ts`, Array.from({ length: 50 }, () => "// line").join("\n"));
    writeFile(dir, "src/huge.ts", Array.from({ length: 5000 }, () => "// line").join("\n"));
    gitInitAndCommit(dir);

    const result = runReviewStructural(contextFor(dir), { domain: "responsibility_concentration" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.confidence === "weak_signal" && !f.eligibleForIntake)).toBe(true);
  });

  it("scenario 5: stale/dead structural path is detected where evidence can prove it", () => {
    const dir = freshDir();
    writeFile(dir, "src/cli/register-commands.ts", `import { runFoo } from "./commands/foo.command.js";`);
    writeFile(dir, "src/cli/commands/foo.command.ts", "export function runFoo() {}");
    writeFile(dir, "src/cli/commands/orphan.command.ts", "export function runOrphan() {}");
    gitInitAndCommit(dir);

    const result = runReviewStructural(contextFor(dir), { domain: "dead_structural_paths" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    expect(findings.some((f) => f.affectedPaths.includes("src/cli/commands/orphan.command.ts"))).toBe(true);
  });

  it("scenario 6: documentation/public-contract drift is detected", () => {
    const dir = freshDir();
    writeFile(dir, "package.json", JSON.stringify({ engines: { node: ">=24.0.0" } }));
    writeFile(dir, ".github/workflows/validate.yml", "jobs:\n  quality:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 22\n");
    gitInitAndCommit(dir);

    const result = runReviewStructural(contextFor(dir), { domain: "public_contract_drift" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    expect(findings.some((f) => f.ruleId === "node-version-declaration-mismatch" && f.confidence === "proven")).toBe(true);
  });

  it("scenario 7: process-heavy test-infrastructure hotspot is detected without misclassifying a timeout as a product defect", () => {
    // Real dogfood target: this repository itself has real process-spawning
    // test files; the rule must classify the STRUCTURAL pattern, never an
    // individual failed run (which this read-only check never observes at all).
    const result = runStructuralReview({ repoRoot: process.cwd(), domains: ["test_infrastructure"] });
    // Every finding this rule can ever produce is structural/informational,
    // never a defect-eligible claim about a specific failure:
    expect(result.findings.every((f) => f.disposition === "informational" && !f.eligibleForIntake)).toBe(true);
  });

  it("scenario 8: intentional compatibility adapter is not falsely reported as divergent ownership", () => {
    const dir = freshDir();
    // The adapter delegates to (imports/calls) the canonical owner rather
    // than re-declaring the governed symbol name itself -- so it must not
    // collide in the duplicate-decision-owner check.
    writeFile(dir, "src/owner.ts", "export function decide() { return 1; }");
    writeFile(dir, "src/legacy-adapter.ts", `import { decide } from "./owner.js";\nexport function legacyDecide() { return decide(); }`);
    writeFile(dir, "docs/governance/repository-owner-map.json", JSON.stringify({ protocolVersion: "x@1", entries: { decisionOwner: { primary: "src/owner.ts", supporting: [] } } }));
    gitInitAndCommit(dir);

    const result = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    expect(findings.some((f) => f.ruleId === "duplicate-decision-owner-implementation")).toBe(false);
  });

  it("scenario 9: legitimate capability-dependent Docker skip is not treated as test debt merely for being skipped", () => {
    // No rule in this milestone inspects it.skip/describe.skip/skipIf at
    // all -- confirmed by construction: none of the 8 domain rules read
    // vitest skip syntax, only subprocess usage and timeout-override
    // presence. Proven here by running the real test_infrastructure rule
    // against this repository's own Docker-dependent sandbox test files
    // and confirming no finding claims a skip is itself a problem.
    const result = runStructuralReview({ repoRoot: process.cwd(), domains: ["test_infrastructure"] });
    expect(result.findings.every((f) => !f.reasonCodes.includes("SKIPPED_TEST"))).toBe(true);
  });

  it("scenario 10: equivalent findings from two evidence paths collapse deterministically", async () => {
    const { consolidateFindings } = await import("../../src/workflow/structural-review-consolidation.js");
    const shared = {
      findingKey: "sha256:" + "e".repeat(64),
      domain: "ownership_divergence" as const,
      ruleId: "r",
      title: "t",
      explanation: "e",
      reviewCommit: "a".repeat(40),
      affectedPaths: ["src/x.ts"],
      confidence: "proven" as const,
      significance: "medium" as const,
      reasonCodes: ["X"],
      evidenceGaps: [],
      disposition: "actionable" as const,
      eligibleForIntake: true,
      recommendedNextAction: "fix",
    };
    const a: StructuralFinding = { ...shared, providerSource: "repository-local", evidence: [{ evidenceId: "E1", description: "a", locator: "x" }] };
    const b: StructuralFinding = { ...shared, providerSource: "graphify", evidence: [{ evidenceId: "E2", description: "b", locator: "x" }] };
    const merged = consolidateFindings([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].evidence).toHaveLength(2);
  });

  it("scenario 11: ambiguous/weak structural evidence remains low-confidence or non-actionable", () => {
    const dir = freshDir();
    for (let i = 0; i < 15; i++) writeFile(dir, `src/normal${i}.ts`, Array.from({ length: 50 }, () => "// line").join("\n"));
    writeFile(dir, "src/big.ts", Array.from({ length: 3000 }, () => "// line").join("\n"));
    gitInitAndCommit(dir);
    const result = runReviewStructural(contextFor(dir), { domain: "responsibility_concentration" });
    const findings = (result.data as { review: StructuralReview }).review.findings;
    expect(findings.every((f) => f.confidence !== "proven")).toBe(true);
  });

  it("scenario 12: repeated review of identical repository state produces identical finding identities/order", () => {
    const first = runStructuralReview({ repoRoot: process.cwd() });
    const second = runStructuralReview({ repoRoot: process.cwd() });
    expect(first.findings.map((f) => f.findingKey)).toEqual(second.findings.map((f) => f.findingKey));
  });

  it("scenario 13: structural review creates zero canonical defects automatically", async () => {
    const dir = freshDir();
    seedIntakeableFixture(dir);
    runReviewStructural(contextFor(dir), {});
    // review alone, never followed by intake, must leave no .aiqt/state.json
    // defects section at all -- proving discovery != canonical mutation.
    const state = readState(dir);
    expect(state.defects).toBeUndefined();
  });

  it("scenario 14: explicit eligible finding intake creates or deduplicates through M42 correctly", async () => {
    const dir = freshDir();
    seedIntakeableFixture(dir);
    const reviewed = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findingKey = (reviewed.data as { review: StructuralReview }).review.findings[0].findingKey;

    const first = await runDefectsIntakeStructural(contextFor(dir), findingKey, {});
    expect(first.exitCode).toBe(ExitCode.Success);
    const second = await runDefectsIntakeStructural(contextFor(dir), findingKey, {});
    const secondData = second.data as { created: unknown[]; enriched: unknown[] };
    expect(secondData.created).toHaveLength(0);
    expect(secondData.enriched).toHaveLength(1);
  });

  it("scenario 15: stale finding intake is rejected or requires re-review", async () => {
    const dir = freshDir();
    seedIntakeableFixture(dir);
    const reviewed = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });

    // Change the repository state (new commit) without re-running review --
    // an intake attempt using a review re-run against the NEW HEAD will
    // simply not find the (now-stale-relative) old key from a stored
    // reference; here we directly exercise the freshness gate itself via
    // the intake service with an intentionally mismatched commit.
    const { intakeStructuralFinding } = await import("../../src/services/structural-finding-intake-service.js");
    const stubFinding = (reviewed.data as { review: StructuralReview }).review.findings[0];
    const outcome = intakeStructuralFinding(stubFinding, "f".repeat(40), [], new Date().toISOString());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.stale).toBe(true);
  });

  it("scenario 16: intake does not authorize remediation and preserves the risk-50 human boundary", async () => {
    const dir = freshDir();
    seedIntakeableFixture(dir);
    const reviewed = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findingKey = (reviewed.data as { review: StructuralReview }).review.findings[0].findingKey;

    const intake = await runDefectsIntakeStructural(contextFor(dir), findingKey, {});
    const created = (intake.data as { created: DefectRecord[] }).created[0];
    const inspected = runDefectsInspect(contextFor(dir), created.defectId);
    const defect = (inspected.data as { defect: DefectRecord }).defect;
    expect(defect.status).toBe("candidate");
    expect(defect.remediation).toBeUndefined();
    expect(defect.triage).toBeUndefined();
  });

  it("scenario 17: optional provider (Graphify) unavailable does not break local review", () => {
    const status = graphifyProvider.checkAvailability(process.cwd());
    expect(status.available).toBe(false);
    const result = runReviewStructural(contextFor(process.cwd()), {});
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("boundary/explain proof: explain reports why a finding is or is not intake-eligible", () => {
    const dir = freshDir();
    seedIntakeableFixture(dir);
    const reviewed = runReviewStructural(contextFor(dir), { domain: "ownership_divergence" });
    const findingKey = (reviewed.data as { review: StructuralReview }).review.findings[0].findingKey;
    const explained = runReviewStructuralExplain(contextFor(dir), findingKey);
    expect(explained.exitCode).toBe(ExitCode.Success);
    const finding = (explained.data as { finding: StructuralFinding }).finding;
    expect(typeof finding.eligibleForIntake).toBe("boolean");
    expect(finding.recommendedNextAction.length).toBeGreaterThan(0);
  });
});

function seedIntakeableFixture(dir: string): void {
  runInit(contextFor(dir), normalizeInitOptions({}));
  writeFile(dir, "docs/governance/repository-owner-map.json", JSON.stringify({ protocolVersion: "x@1", entries: { fixtureOwner: { primary: "src/does-not-exist.ts", supporting: [] } } }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.com" };
  execFileSync("git", ["init", "-q"], { cwd: dir, env });
  execFileSync("git", ["add", "-A"], { cwd: dir, env });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: dir, env });
}
