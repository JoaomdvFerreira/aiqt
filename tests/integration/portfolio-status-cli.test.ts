import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { runPortfolioCreate, runPortfolioAdd, runPortfolioStatus } from "../../src/cli/commands/portfolio.command.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { PortfolioSnapshot } from "../../src/workflow/portfolio-snapshot.js";

/**
 * M46-WU03: `aiqt portfolio status` against a disposable
 * AIQT_PORTFOLIO_HOME plus disposable member fixture repositories.
 */
describe("aiqt portfolio status CLI", () => {
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

  it("reports zero members for an empty portfolio without error", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const status = runPortfolioStatus(anyCtx(), "acme");
    expect(status.exitCode).toBe(0);
    const snapshot = (status.data as { snapshot: PortfolioSnapshot }).snapshot;
    expect(snapshot.summary.totalMembers).toBe(0);
  });

  it("fails deterministically for an unknown portfolio", () => {
    const status = runPortfolioStatus(anyCtx(), "does-not-exist");
    expect(status.exitCode).not.toBe(0);
  });

  it("aggregates one healthy member without mutating its .aiqt/ state", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));
    runPortfolioAdd(anyCtx(), "acme", memberRepo, {});

    const status = runPortfolioStatus(anyCtx(), "acme");
    expect(status.exitCode).toBe(0);
    expect(status.status).toBe("passed");
    const snapshot = (status.data as { snapshot: PortfolioSnapshot }).snapshot;
    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.members[0].status).toBe("healthy");
    expect(status.changedFiles).toEqual([]);
  });

  it("reports a missing/moved member repository as unavailable and still succeeds overall (partial failure is first-class)", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-moved-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));
    runPortfolioAdd(anyCtx(), "acme", memberRepo, {});
    removeDir(memberRepo);

    const status = runPortfolioStatus(anyCtx(), "acme");
    expect(status.exitCode).toBe(0);
    expect(status.status).toBe("warning");
    const snapshot = (status.data as { snapshot: PortfolioSnapshot }).snapshot;
    expect(snapshot.members[0].status).toBe("unavailable");
    expect(snapshot.summary.unavailable).toBe(1);
  });
});
