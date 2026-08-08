import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers.js";
import {
  discoverSemverReleaseTags,
  readPackageVersionAtCommit,
  readSchemaVersionAtCommit,
  readTargetCommitTime,
  selectBaseRelease,
  discoverMilestoneReferences,
  resolveRefSafely,
} from "../../src/workflow/historical-evidence.js";
import {
  listHistoricalReleaseTargets,
  buildHistoricalReleaseTarget,
  reconstructHistoricalRelease,
} from "../../src/services/historical-reconstruction-service.js";
import { contextFor } from "../helpers.js";
import { runReleaseReconstruct } from "../../src/cli/commands/release-reconstruct.command.js";

// M34-WU02 policy: real `git` subprocess fixture, see git-command-runner.test.ts.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M44-WU02: a disposable, non-AIQT-managed repository history with:
 * - a clean linear lineage (A -> B -> C) exercising unambiguous ancestry-
 *   aware base selection, package-version reconstruction, and a deliberate
 *   tag/package-version conflict at C;
 * - a milestone tag with a closure report (verified) and one without
 *   (partial) at two different commits;
 * - a divergent branch (B -> {D1, D2} -> merge E) exercising fail-closed
 *   ambiguous base selection;
 * - a non-SemVer tag ("latest") that must never appear in discovery.
 */
function writePackageJson(dir: string, version: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "widget", version }), "utf8");
}

function commit(dir: string, message: string): string {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: dir });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
}

function tag(dir: string, name: string, ref = "HEAD"): void {
  execFileSync("git", ["tag", name, ref], { cwd: dir });
}

describe("M44-WU02 historical evidence discovery and provenance reconstruction", () => {
  let repoDir = "";
  let commitA = "";
  let commitB = "";
  let commitC = "";
  let commitE = "";

  beforeAll(() => {
    repoDir = makeTempDir("aiqt-historical-evidence-");
    execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repoDir });

    writePackageJson(repoDir, "1.0.0");
    commitA = commit(repoDir, "1.0.0");
    tag(repoDir, "v1.0.0");
    tag(repoDir, "latest"); // non-SemVer, must be excluded from discovery

    writePackageJson(repoDir, "1.1.0");
    mkdirSync(join(repoDir, "docs", "milestones", "completed", "m1"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "milestones", "completed", "m1", "closure-report.md"), "# M1 closure\n", "utf8");
    commitB = commit(repoDir, "1.1.0 + m1 closure");
    tag(repoDir, "v1.1.0");
    tag(repoDir, "m1-widget-foundation");

    writePackageJson(repoDir, "2.0.0"); // deliberately does not match the v2.5.0 tag below
    commitC = commit(repoDir, "2.0.0 (mismatched tag)");
    tag(repoDir, "v2.5.0");
    tag(repoDir, "m2-widget-expansion"); // no closure report anywhere -> partial

    // Divergent branch from B: D1 (v1.2.0) and D2 (v1.3.0), merged into E.
    execFileSync("git", ["checkout", "--quiet", "-b", "feature1", commitB], { cwd: repoDir });
    writePackageJson(repoDir, "1.2.0");
    commit(repoDir, "1.2.0");
    tag(repoDir, "v1.2.0");

    execFileSync("git", ["checkout", "--quiet", "-b", "feature2", commitB], { cwd: repoDir });
    writePackageJson(repoDir, "1.3.0");
    commit(repoDir, "1.3.0");
    tag(repoDir, "v1.3.0");

    execFileSync("git", ["checkout", "--quiet", "-b", "merged", "feature1"], { cwd: repoDir });
    execFileSync("git", ["merge", "--quiet", "--no-ff", "-X", "ours", "-m", "merge divergent release lines", "feature2"], { cwd: repoDir });
    writePackageJson(repoDir, "9.9.9"); // matches the tag below, isolating the ambiguous-base scenario from a tag/package conflict
    commit(repoDir, "9.9.9");
    commitE = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
    tag(repoDir, "v9.9.9");

    execFileSync("git", ["checkout", "--quiet", "main"], { cwd: repoDir });
  });

  afterAll(() => {
    if (repoDir) removeDir(repoDir);
  });

  describe("discoverSemverReleaseTags", () => {
    it("returns only valid-SemVer tags, sorted ascending, excluding non-SemVer tags", () => {
      const tags = discoverSemverReleaseTags(repoDir);
      const names = tags.map((t) => t.tag);
      expect(names).not.toContain("latest");
      expect(names).not.toContain("m1-widget-foundation");
      expect(names.indexOf("v1.0.0")).toBeLessThan(names.indexOf("v1.1.0"));
      expect(names.indexOf("v1.1.0")).toBeLessThan(names.indexOf("v2.5.0"));
    });
  });

  describe("readPackageVersionAtCommit / readSchemaVersionAtCommit", () => {
    it("reads the historical package.json version at the exact commit, not the working tree", () => {
      expect(readPackageVersionAtCommit(repoDir, commitA)).toBe("1.0.0");
      expect(readPackageVersionAtCommit(repoDir, commitB)).toBe("1.1.0");
      expect(readPackageVersionAtCommit(repoDir, commitC)).toBe("2.0.0");
    });

    it("returns null when no schema-version file exists at that commit (non-AIQT-managed project)", () => {
      expect(readSchemaVersionAtCommit(repoDir, commitA)).toBeNull();
    });
  });

  describe("readTargetCommitTime", () => {
    it("returns a parseable Git-metadata timestamp for a real commit", () => {
      const iso = readTargetCommitTime(repoDir, commitA);
      expect(iso).not.toBeNull();
      expect(Number.isNaN(Date.parse(iso!))).toBe(false);
    });
  });

  describe("selectBaseRelease (ancestry-aware, fail-closed on ambiguity)", () => {
    it("selects the nearest ancestor tag by Git ancestry, not just highest SemVer", () => {
      const candidates = discoverSemverReleaseTags(repoDir).filter((t) => t.tag !== "v2.5.0");
      const result = selectBaseRelease(repoDir, commitC, candidates);
      expect(result.ambiguous).toBe(false);
      expect(result.baseRelease).toBe("v1.1.0");
    });

    it("reports no base (not ambiguous) when no prior tag is reachable in ancestry", () => {
      const candidates = discoverSemverReleaseTags(repoDir).filter((t) => t.tag !== "v1.0.0");
      const result = selectBaseRelease(repoDir, commitA, candidates);
      expect(result.ambiguous).toBe(false);
      expect(result.baseRelease).toBeNull();
    });

    it("fails closed to ambiguous when two divergent tags are equally plausible bases", () => {
      const candidates = discoverSemverReleaseTags(repoDir).filter((t) => t.tag !== "v9.9.9");
      const result = selectBaseRelease(repoDir, commitE, candidates);
      expect(result.ambiguous).toBe(true);
      expect(result.baseRelease).toBeNull();
    });
  });

  describe("discoverMilestoneReferences", () => {
    it("classifies a milestone tag with a discoverable closure report as verified, and without one as partial", () => {
      const refs = discoverMilestoneReferences(repoDir, commitC);
      const m1 = refs.find((r) => r.milestoneId === "m1");
      const m2 = refs.find((r) => r.milestoneId === "m2");
      expect(m1?.evidenceStatus).toBe("verified");
      expect(m1?.closureReportPath).toBe("docs/milestones/completed/m1/closure-report.md");
      expect(m2?.evidenceStatus).toBe("partial");
      expect(m2?.closureReportPath).toBeNull();
    });

    it("never includes a milestone tag that is not an ancestor of the target commit", () => {
      const refs = discoverMilestoneReferences(repoDir, commitA);
      expect(refs).toHaveLength(0);
    });
  });

  describe("resolveRefSafely", () => {
    it("returns null instead of throwing for an unresolvable ref", () => {
      expect(resolveRefSafely(repoDir, "refs/does-not-exist")).toBeNull();
    });
  });

  describe("listHistoricalReleaseTargets (release history inventory)", () => {
    it("is deterministic across repeated invocations", () => {
      const first = listHistoricalReleaseTargets(repoDir);
      const second = listHistoricalReleaseTargets(repoDir);
      expect(first).toEqual(second);
    });

    it("flags the tag whose package.json version disagrees with the tag itself", () => {
      const targets = listHistoricalReleaseTargets(repoDir);
      const v250 = targets.find((t) => t.tag === "v2.5.0");
      expect(v250?.packageVersionAtCommit).toBe("2.0.0");
      expect(v250?.versionMatchesTag).toBe(false);
      const v110 = targets.find((t) => t.tag === "v1.1.0");
      expect(v110?.versionMatchesTag).toBe(true);
    });
  });

  describe("buildHistoricalReleaseTarget (release reconstruct evidence ledger)", () => {
    it("returns tag_not_found for a tag that does not exist", () => {
      const outcome = buildHistoricalReleaseTarget(repoDir, "example/widget", "v404.0.0");
      expect(outcome.ok).toBe(false);
    });

    it("produces a verified base release and a conflict finding for the mismatched tag", () => {
      const outcome = buildHistoricalReleaseTarget(repoDir, "example/widget", "v2.5.0");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.target.resolvedCommit).toBe(commitC);
      expect(outcome.target.baseRelease).toBe("v1.1.0");
      expect(outcome.target.baseReleaseAmbiguous).toBe(false);
      expect(outcome.conflicts).toHaveLength(1);
      expect(outcome.conflicts[0]?.id).toBe("HIST-TAG-PACKAGE-VERSION-MISMATCH");
      const milestoneKeys = outcome.evidence.filter((e) => e.key.startsWith("milestone:")).map((e) => e.key);
      expect(milestoneKeys).toEqual(["milestone:m1", "milestone:m2"]);
    });

    it("produces an ambiguous base release for the merge-commit target", () => {
      const outcome = buildHistoricalReleaseTarget(repoDir, "example/widget", "v9.9.9");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.target.baseReleaseAmbiguous).toBe(true);
      expect(outcome.target.baseRelease).toBeNull();
      const baseEvidence = outcome.evidence.find((e) => e.key === "base_release");
      expect(baseEvidence?.status).toBe("missing");
    });

    it("is deterministic for identical repository state (same target twice)", () => {
      const first = buildHistoricalReleaseTarget(repoDir, "example/widget", "v1.1.0");
      const second = buildHistoricalReleaseTarget(repoDir, "example/widget", "v1.1.0");
      expect(first).toEqual(second);
    });
  });

  // M44-WU03: mapping a sufficiently evidenced target into the existing M40
  // candidate/readiness/risk/approval flow -- never a second decision owner.
  describe("reconstructHistoricalRelease (M40 integration)", () => {
    it("maps a clean historical target into an M40 decision with risk and approval always populated", () => {
      const outcome = reconstructHistoricalRelease(repoDir, "example/widget", "v1.1.0");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.assessment.status).toBe("reconstructable");
      expect(outcome.result.m40BlockingFindings).toHaveLength(0);
      expect(outcome.result.decision).not.toBeNull();
      expect(outcome.result.decision?.risk).not.toBeNull();
      expect(outcome.result.decision?.approval).not.toBeNull();
      // The historical tag is a real local Git tag, so M40's own
      // forward-looking "tag already exists" readiness check correctly
      // fires -- this is honest, not a bug: reconstruction never implies
      // the tag is available for a *new* publication.
      expect(outcome.result.decision?.readiness.blockingFindings.some((f) => f.id === "RELEASE-READINESS-TAG-CONFLICT")).toBe(true);
      expect(outcome.result.retrospectiveNotes).toContain("Historical reconstruction:** YES");
      expect(outcome.result.retrospectiveNotes).toContain("Reconstruction quality:** reconstructable");
    });

    it("still builds an M40 decision for a conflicting target, surfacing the conflict alongside it", () => {
      const outcome = reconstructHistoricalRelease(repoDir, "example/widget", "v2.5.0");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.assessment.status).toBe("conflicting");
      expect(outcome.result.assessment.conflicts).toHaveLength(1);
      expect(outcome.result.decision).not.toBeNull();
      expect(outcome.result.retrospectiveNotes).toContain("Reconstruction quality:** conflicting");
    });

    it("reports partial for the ambiguous-base target, and still attempts M40 mapping", () => {
      const outcome = reconstructHistoricalRelease(repoDir, "example/widget", "v9.9.9");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.assessment.status).toBe("partial");
    });

    it("surfaces M40's own RELEASE-CANDIDATE-NO-MILESTONES finding, without fabricating a decision, when zero milestones are evidenced", () => {
      const outcome = reconstructHistoricalRelease(repoDir, "example/widget", "v1.0.0");
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.assessment.status).toBe("reconstructable");
      expect(outcome.result.decision).toBeNull();
      expect(outcome.result.m40BlockingFindings.some((f) => f.id === "RELEASE-CANDIDATE-NO-MILESTONES")).toBe(true);
      expect(outcome.result.retrospectiveNotes).toBeNull();
    });

    it("returns tag_not_found for a nonexistent tag", () => {
      const outcome = reconstructHistoricalRelease(repoDir, "example/widget", "v404.0.0");
      expect(outcome.ok).toBe(false);
    });

    it("is deterministic: identical target reconstructed twice produces an identical assessment digest", () => {
      const first = reconstructHistoricalRelease(repoDir, "example/widget", "v1.1.0");
      const second = reconstructHistoricalRelease(repoDir, "example/widget", "v1.1.0");
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.result.assessment.digest).toBe(second.result.assessment.digest);
      expect(first.result.assessment.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("runReleaseReconstruct CLI (M44-WU03/WU04)", () => {
    it("fails with RELEASE-RECONSTRUCT-TAG-NOT-FOUND for an unknown tag", async () => {
      const result = await runReleaseReconstruct(contextFor(repoDir), { tag: "v404.0.0", repository: "example/widget" });
      expect(result.blockingIssues.some((i) => i.id === "RELEASE-RECONSTRUCT-TAG-NOT-FOUND")).toBe(true);
    });

    it("reports blocked status with the readiness blocking findings for a clean historical target (no GitHub token -> unverified, never fabricated)", async () => {
      const result = await runReleaseReconstruct(contextFor(repoDir), { tag: "v1.1.0", repository: "example/widget" }, { env: {} });
      expect(result.status).toBe("blocked");
      expect(result.exitCode).toBe(2);
      const data = result.data as { assessment: { status: string }; existingRelease: { releaseStatus: string; draftStatus: string }; retrospectiveNotes: string | null };
      expect(data.assessment.status).toBe("reconstructable");
      expect(data.existingRelease.releaseStatus).toBe("unverified");
      expect(data.existingRelease.draftStatus).toBe("unverified");
      expect(data.retrospectiveNotes).toContain("Historical reconstruction:** YES");
      expect(data.retrospectiveNotes).toContain("Existing GitHub Release:** unverified");
    });

    it("rejects a missing --repository with RELEASE-RECONSTRUCT-MISSING-REPOSITORY", async () => {
      const result = await runReleaseReconstruct(contextFor(repoDir), { tag: "v1.1.0", repository: "" });
      expect(result.blockingIssues.some((i) => i.id === "RELEASE-RECONSTRUCT-MISSING-REPOSITORY")).toBe(true);
    });

    it("reports existing_release and never proposes a duplicate action when a published release is found", async () => {
      const fakeClient = {
        getRepository: async () => ({ ok: true as const, value: { fullName: "example/widget" } }),
        getReleaseByTag: async () => ({ ok: true as const, value: { id: 1, htmlUrl: "https://github.com/example/widget/releases/tag/v1.1.0", draft: false } }),
        createReleaseDraft: async () => {
          throw new Error("must never be called by reconstruction");
        },
      };
      const result = await runReleaseReconstruct(
        contextFor(repoDir),
        { tag: "v1.1.0", repository: "example/widget" },
        { githubClient: fakeClient, env: { GITHUB_TOKEN: "fake-token" } },
      );
      const data = result.data as { assessment: { status: string }; existingRelease: { releaseStatus: string; releaseUrl: string | null } };
      expect(data.assessment.status).toBe("existing_release");
      expect(data.existingRelease.releaseStatus).toBe("found");
      expect(data.existingRelease.releaseUrl).toBe("https://github.com/example/widget/releases/tag/v1.1.0");
      expect(result.summary).toContain("no duplicate publication proposed");
    });

    it("surfaces a found draft without creating another one", async () => {
      const fakeClient = {
        getRepository: async () => ({ ok: true as const, value: { fullName: "example/widget" } }),
        getReleaseByTag: async () => ({ ok: true as const, value: { id: 2, htmlUrl: "https://github.com/example/widget/releases/tag/untagged-draft", draft: true } }),
        createReleaseDraft: async () => {
          throw new Error("must never be called by reconstruction");
        },
      };
      const result = await runReleaseReconstruct(
        contextFor(repoDir),
        { tag: "v1.1.0", repository: "example/widget" },
        { githubClient: fakeClient, env: { GITHUB_TOKEN: "fake-token" } },
      );
      const data = result.data as { existingRelease: { draftStatus: string; draftUrl: string | null } };
      expect(data.existingRelease.draftStatus).toBe("found");
      expect(result.summary).toContain("no duplicate draft proposed");
    });

    it("reports unverified, never a fabricated not_found, when the GitHub API call fails", async () => {
      const fakeClient = {
        getRepository: async () => ({ ok: true as const, value: { fullName: "example/widget" } }),
        getReleaseByTag: async () => ({ ok: false as const, status: 500, message: "boom" }),
        createReleaseDraft: async () => {
          throw new Error("must never be called by reconstruction");
        },
      };
      const result = await runReleaseReconstruct(
        contextFor(repoDir),
        { tag: "v1.1.0", repository: "example/widget" },
        { githubClient: fakeClient, env: { GITHUB_TOKEN: "fake-token" } },
      );
      const data = result.data as { existingRelease: { releaseStatus: string } };
      expect(data.existingRelease.releaseStatus).toBe("unverified");
    });

    it("reports unverified for a non-GitHub-shaped repository identity, without ever attempting a network call", async () => {
      const fakeClient = {
        getRepository: async () => {
          throw new Error("must never be called for a non-owner/repo identity");
        },
        getReleaseByTag: async () => {
          throw new Error("must never be called for a non-owner/repo identity");
        },
        createReleaseDraft: async () => {
          throw new Error("must never be called by reconstruction");
        },
      };
      const result = await runReleaseReconstruct(
        contextFor(repoDir),
        { tag: "v1.1.0", repository: "not-an-owner-repo-identity" },
        { githubClient: fakeClient, env: { GITHUB_TOKEN: "fake-token" } },
      );
      const data = result.data as { existingRelease: { releaseStatus: string } };
      expect(data.existingRelease.releaseStatus).toBe("unverified");
    });
  });
});
