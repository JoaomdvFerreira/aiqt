import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  mapRiskScoreToSeverity,
  isGitRepository,
  isSourceControlExplicitlyDisabled,
  requiresRepositoryBaselineWorkUnit,
  renderDriverSourceControlDisciplineSection,
  renderPlanRepositoryBaselineGuidance,
  renderSourceControlExpectationsSection,
  renderCheckpointSourceControlGuidance,
} from "../../src/workflow/source-control-discipline.js";
import { makeTempDir, removeDir } from "../helpers.js";

describe("mapRiskScoreToSeverity", () => {
  it("maps the canonical boundaries exactly per the M15 §8 table", () => {
    expect(mapRiskScoreToSeverity(0)).toBe("low");
    expect(mapRiskScoreToSeverity(20)).toBe("low");
    expect(mapRiskScoreToSeverity(21)).toBe("medium");
    expect(mapRiskScoreToSeverity(50)).toBe("medium");
    expect(mapRiskScoreToSeverity(51)).toBe("high");
    expect(mapRiskScoreToSeverity(80)).toBe("high");
    expect(mapRiskScoreToSeverity(81)).toBe("critical");
    expect(mapRiskScoreToSeverity(100)).toBe("critical");
  });

  it("degrades gracefully for out-of-range input rather than throwing", () => {
    expect(() => mapRiskScoreToSeverity(-5)).not.toThrow();
    expect(mapRiskScoreToSeverity(-5)).toBe("low");
    expect(() => mapRiskScoreToSeverity(150)).not.toThrow();
    expect(mapRiskScoreToSeverity(150)).toBe("critical");
  });
});

describe("isGitRepository", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("is false for a null/undefined root", () => {
    expect(isGitRepository(null)).toBe(false);
    expect(isGitRepository(undefined)).toBe(false);
  });

  it("is false for a root without a .git directory", () => {
    dir = makeTempDir();
    expect(isGitRepository(dir)).toBe(false);
  });

  it("is true for a root with a .git directory", () => {
    dir = makeTempDir();
    mkdirSync(join(dir, ".git"), { recursive: true });
    expect(isGitRepository(dir)).toBe(true);
  });

  it("degrades gracefully (false) for a nonexistent root rather than throwing", () => {
    expect(() => isGitRepository("/definitely/does/not/exist/anywhere")).not.toThrow();
    expect(isGitRepository("/definitely/does/not/exist/anywhere")).toBe(false);
  });
});

describe("isSourceControlExplicitlyDisabled", () => {
  it("recognizes explicit opt-out phrasing", () => {
    expect(isSourceControlExplicitlyDisabled("This project has no source control by design.")).toBe(true);
    expect(isSourceControlExplicitlyDisabled("We are not using git for this experiment.")).toBe(true);
  });

  it("is false for ordinary project text", () => {
    expect(isSourceControlExplicitlyDisabled("Build a marketplace with Next.js and React.")).toBe(false);
  });
});

describe("requiresRepositoryBaselineWorkUnit", () => {
  it("is true when no Git repository exists and nothing disables source control", () => {
    const dir = makeTempDir();
    expect(requiresRepositoryBaselineWorkUnit({ repoRoot: dir })).toBe(true);
    removeDir(dir);
  });

  it("is false when the implementation root already has a .git directory", () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, ".git"), { recursive: true });
    expect(requiresRepositoryBaselineWorkUnit({ repoRoot: dir })).toBe(false);
    removeDir(dir);
  });

  it("is false when the user explicitly disables source control", () => {
    const dir = makeTempDir();
    const project = {
      version: "1.0.0",
      project: {
        id: "PROJ-001",
        name: "Test",
        objective: "A quick experiment with no source control.",
        targetUsers: [],
        preferredAgent: null,
        existingRepositoryPath: null,
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
      context: {
        constraints: [],
        nonGoals: [],
        technologyPreferences: [],
        businessRules: [],
        architectureNotes: [],
      },
      requirements: [],
      decisions: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      quality: { preferredValidationCommands: [] },
    };
    expect(requiresRepositoryBaselineWorkUnit({ project, repoRoot: dir })).toBe(false);
    removeDir(dir);
  });
});

describe("renderDriverSourceControlDisciplineSection", () => {
  it("covers Git init, main branch, .gitignore, baseline commit, git status, and per-work-unit commit/tag", () => {
    const text = renderDriverSourceControlDisciplineSection();
    expect(text).toContain("Source Control Discipline:");
    expect(text).toContain("main as the default branch");
    expect(text).toContain(".gitignore");
    expect(text).toContain("baseline commit");
    expect(text).toContain("git status");
    expect(text).toContain("Commit once and tag once");
    expect(text).toMatch(/self-attested/i);
  });
});

describe("renderPlanRepositoryBaselineGuidance", () => {
  it("requires an early repository initialization/baseline work unit", () => {
    const text = renderPlanRepositoryBaselineGuidance();
    expect(text).toContain("repository initialization/baseline work unit");
    expect(text).toContain("main as the default branch");
    expect(text).toContain("repo-baseline");
  });
});

describe("renderSourceControlExpectationsSection", () => {
  it("renders a deterministic tag/commit example using the work unit and milestone ids", () => {
    const text = renderSourceControlExpectationsSection({ workUnitId: "WU003", milestoneId: "M002" });
    expect(text).toContain("## Source Control Expectations");
    expect(text).toContain("feat(WU003)");
    expect(text).toContain("m002-wu003-done");
    expect(text).toContain("git status");
    expect(text).toMatch(/self-attested/i);
  });

  it("is deterministic across repeated calls with the same input", () => {
    const first = renderSourceControlExpectationsSection({ workUnitId: "WU001", milestoneId: "M001" });
    const second = renderSourceControlExpectationsSection({ workUnitId: "WU001", milestoneId: "M001" });
    expect(first).toBe(second);
  });
});

describe("renderCheckpointSourceControlGuidance", () => {
  it("asks for the exact source-control and risk report fields", () => {
    const text = renderCheckpointSourceControlGuidance();
    expect(text).toContain("Implementation root:");
    expect(text).toContain("Current branch:");
    expect(text).toContain("Commit created: yes/no");
    expect(text).toContain("Tag created: yes/no");
    expect(text).toContain("Risk score: <0-100>/100");
    expect(text).toContain("AIQT severity: low|medium|high|critical");
    expect(text).toMatch(/does not execute Git\/GitHub commands/i);
  });
});
