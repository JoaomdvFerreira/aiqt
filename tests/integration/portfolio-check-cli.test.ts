import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { runPortfolioCreate, runPortfolioAdd, runPortfolioCheck } from "../../src/cli/commands/portfolio.command.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { PortfolioGovernanceReport } from "../../src/workflow/portfolio-governance.js";

const NOW = "2026-08-10T00:00:00.000Z";

function readState(root: string) {
  return JSON.parse(readFileSync(join(root, ".aiqt", "state.json"), "utf8"));
}
function writeState(root: string, state: unknown) {
  writeFileSync(join(root, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}
function buildDefect(defectId: string, status: string) {
  return {
    defectId,
    title: "Sample defect",
    summary: "Sample defect summary.",
    sourceKind: "human_reported",
    evidenceRefs: [{ evidenceRefId: "EV-1", sourceKind: "human_reported", locator: "n/a", capturedAt: NOW }],
    fingerprint: `sha256:${"a".repeat(64)}`,
    severity: "medium",
    confidence: "confirmed",
    status,
    freshness: { state: "current", evaluatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
  };
}
function buildEscalation(escalationId: string, status: "open" | "resolved" | "withdrawn") {
  return {
    escalationId,
    escalationKey: `key-${escalationId}`,
    category: "product",
    status,
    question: "Sample escalation question?",
    rationale: "Sample escalation rationale.",
    relatedWorkUnitIds: [],
    relatedMilestoneIds: [],
    evidenceIds: [],
    resolution: status === "open" ? null : { answer: "Decided.", resolvedAt: NOW, resolvedBy: "human" },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** M46-WU04: `aiqt portfolio check` CLI, mirroring the status CLI test's disposable-fixture pattern. */
describe("aiqt portfolio check CLI", () => {
  const tempDirs: string[] = [];
  function freshDir(prefix = "aiqt-test-"): string {
    const d = makeTempDir(prefix);
    tempDirs.push(d);
    return d;
  }

  let portfolioHome: string;
  const originalHome = process.env.AIQT_PORTFOLIO_HOME;

  beforeEach(() => {
    portfolioHome = freshDir("aiqt-portfolio-home-");
    process.env.AIQT_PORTFOLIO_HOME = portfolioHome;
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.AIQT_PORTFOLIO_HOME;
    else process.env.AIQT_PORTFOLIO_HOME = originalHome;
  });
  afterAll(() => {
    for (const d of tempDirs) removeDir(d);
  });

  function anyCtx() {
    return contextFor(freshDir());
  }

  it("passes cleanly for an empty portfolio", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const check = runPortfolioCheck(anyCtx(), "acme");
    expect(check.exitCode).toBe(0);
    expect(check.status).toBe("passed");
  });

  it("fails deterministically for an unknown portfolio", () => {
    const check = runPortfolioCheck(anyCtx(), "does-not-exist");
    expect(check.exitCode).not.toBe(0);
  });

  it("reports warning status for a member with open (non-human) defects, without mutating the member repo", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));
    const state = readState(memberRepo);
    state.defects = [buildDefect("DEF-001", "queued")];
    writeState(memberRepo, state);
    runPortfolioAdd(anyCtx(), "acme", memberRepo, {});

    const check = runPortfolioCheck(anyCtx(), "acme");
    expect(check.exitCode).toBe(0);
    expect(check.status).toBe("warning");
    expect(check.requiresHumanInput).toBe(false);
    const report = (check.data as { report: PortfolioGovernanceReport }).report;
    expect(report.summary.totalOpenDefects).toBe(1);
    expect(readState(memberRepo).defects).toHaveLength(1); // untouched
  });

  it("reports needs_input status (exit 10) when a member has a needs_human defect (M33 exit-10 invariant)", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-needs-human-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));
    const state = readState(memberRepo);
    state.defects = [buildDefect("DEF-001", "needs_human")];
    writeState(memberRepo, state);
    runPortfolioAdd(anyCtx(), "acme", memberRepo, {});

    const check = runPortfolioCheck(anyCtx(), "acme");
    expect(check.exitCode).toBe(10);
    expect(check.status).toBe("needs_input");
    expect(check.requiresHumanInput).toBe(true);
  });

  it("reports needs_input status (exit 10) for a member with an open decision escalation and no needs_human defects (closure reconciliation)", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-escalation-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));
    const state = readState(memberRepo);
    state.evidence = { records: [], decisionEscalations: [buildEscalation("ESC-001", "open")] };
    writeState(memberRepo, state);
    runPortfolioAdd(anyCtx(), "acme", memberRepo, {});

    const check = runPortfolioCheck(anyCtx(), "acme");
    expect(check.exitCode).toBe(10);
    expect(check.status).toBe("needs_input");
    expect(check.requiresHumanInput).toBe(true);
    const report = (check.data as { report: PortfolioGovernanceReport }).report;
    expect(report.summary.totalOpenDecisionEscalations).toBe(1);
    expect(readState(memberRepo).evidence.decisionEscalations).toHaveLength(1); // untouched
  });

  it("does not treat a resolved decision escalation as an active human-input requirement", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-escalation-resolved-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));
    const state = readState(memberRepo);
    state.evidence = { records: [], decisionEscalations: [buildEscalation("ESC-001", "resolved")] };
    writeState(memberRepo, state);
    runPortfolioAdd(anyCtx(), "acme", memberRepo, {});

    const check = runPortfolioCheck(anyCtx(), "acme");
    expect(check.exitCode).toBe(0);
    expect(check.status).toBe("passed");
  });
});
