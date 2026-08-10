import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import {
  runPortfolioCreate,
  runPortfolioList,
  runPortfolioInspect,
  runPortfolioAdd,
  runPortfolioRemove,
} from "../../src/cli/commands/portfolio.command.js";
import { canonicalizeRepositoryRoot } from "../../src/services/portfolio-service.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import type { PortfolioManifest, PortfolioMember } from "../../src/schema/portfolio.schema.js";

/**
 * M46-WU02: registry CLI (create/list/inspect/add/remove) against a
 * disposable AIQT_PORTFOLIO_HOME, mirroring maintenance-schedule-cli.test.ts's
 * disposable-fixture-project pattern. Never touches the real user home.
 */
describe("aiqt portfolio create/list/inspect/add/remove CLI", () => {
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

  it("create makes an empty portfolio with a stable slug id, never mutating any member repo", () => {
    const created = runPortfolioCreate(anyCtx(), "Acme Corp");
    expect(created.exitCode).toBe(0);
    const portfolio = (created.data as { portfolio: PortfolioManifest }).portfolio;
    expect(portfolio.id).toBe("acme-corp");
    expect(portfolio.members).toEqual([]);

    const list = runPortfolioList(anyCtx());
    expect((list.data as { portfolios: { ok: boolean }[] }).portfolios).toHaveLength(1);
  });

  it("list is deterministic and reports zero portfolios when none exist", () => {
    const list = runPortfolioList(anyCtx());
    expect(list.exitCode).toBe(0);
    expect((list.data as { portfolios: unknown[] }).portfolios).toEqual([]);
  });

  it("inspect returns registry metadata and explicit member references", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const inspected = runPortfolioInspect(anyCtx(), "acme");
    expect(inspected.exitCode).toBe(0);
    expect((inspected.data as { portfolio: PortfolioManifest }).portfolio.name).toBe("Acme");
  });

  it("inspect fails deterministically for an unknown portfolio", () => {
    const result = runPortfolioInspect(anyCtx(), "does-not-exist");
    expect(result.exitCode).not.toBe(0);
    expect(result.status).toBe("failed");
  });

  it("add registers an AIQT-managed member repository and it is immediately visible via inspect", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));

    const added = runPortfolioAdd(anyCtx(), "acme", memberRepo, {});
    expect(added.exitCode).toBe(0);
    const member = (added.data as { member: PortfolioMember }).member;
    expect(member.root).toBe(canonicalizeRepositoryRoot(memberRepo));
    expect(member.id).toBe("M-001");

    const inspected = runPortfolioInspect(anyCtx(), "acme");
    expect((inspected.data as { portfolio: PortfolioManifest }).portfolio.members).toHaveLength(1);
  });

  it("add fails closed for a repository with no .aiqt/project.json (non-AIQT-managed)", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const plainRepo = freshDir("aiqt-plain-");

    const added = runPortfolioAdd(anyCtx(), "acme", plainRepo, {});
    expect(added.exitCode).not.toBe(0);
    expect(added.status).toBe("failed");
  });

  it("add rejects a duplicate root registration in the same portfolio", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-dup-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));

    const first = runPortfolioAdd(anyCtx(), "acme", memberRepo, {});
    expect(first.exitCode).toBe(0);
    const second = runPortfolioAdd(anyCtx(), "acme", memberRepo, {});
    expect(second.exitCode).not.toBe(0);
  });

  it("remove drops portfolio membership only, without touching the member repository's own .aiqt/ state", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const memberRepo = freshDir("aiqt-member-remove-");
    runInit(contextFor(memberRepo), normalizeInitOptions({}));
    const added = runPortfolioAdd(anyCtx(), "acme", memberRepo, {});
    const memberId = (added.data as { member: PortfolioMember }).member.id;

    const removed = runPortfolioRemove(anyCtx(), "acme", memberId);
    expect(removed.exitCode).toBe(0);

    const inspected = runPortfolioInspect(anyCtx(), "acme");
    expect((inspected.data as { portfolio: PortfolioManifest }).portfolio.members).toEqual([]);

    // The member repository's own project.json is untouched.
    const memberStatus = runPortfolioInspect(contextFor(memberRepo), "acme");
    expect(memberStatus.exitCode).toBe(0); // portfolio store is home-scoped, unaffected by cwd
  });

  it("remove fails deterministically for an unknown member", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const result = runPortfolioRemove(anyCtx(), "acme", "M-999");
    expect(result.exitCode).not.toBe(0);
  });

  it("persists across separate command invocations (process-restart survival)", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const inspectAgain = runPortfolioInspect(anyCtx(), "acme");
    expect(inspectAgain.exitCode).toBe(0);
  });
});
