import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import {
  runPortfolioCreate,
  runPortfolioList,
  runPortfolioInspect,
  runPortfolioAdd,
  runPortfolioStatus,
  runPortfolioCheck,
} from "../../src/cli/commands/portfolio.command.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { renderJson } from "../../src/core/output/json-output.js";
import { renderHuman } from "../../src/core/output/human-output.js";
import type { PortfolioManifest } from "../../src/schema/portfolio.schema.js";
import type { PortfolioSnapshot } from "../../src/workflow/portfolio-snapshot.js";
import type { PortfolioGovernanceReport } from "../../src/workflow/portfolio-governance.js";

/**
 * M46-WU05: dogfood scenarios from the build spec's Sec 8 WU46-05 list not
 * already exercised end to end by the WU46-01..04 focused suites: multiple
 * healthy members, mixed blocked+healthy, deterministic ordering,
 * human/JSON parity, no AIQT self-management state, and malformed-manifest
 * safety surfaced through the `list` CLI path.
 */
describe("aiqt portfolio dogfood (M46-WU05, build spec Sec 8)", () => {
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

  it("scenario 3: aggregates multiple healthy members correctly", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const repoA = freshDir("aiqt-member-a-");
    const repoB = freshDir("aiqt-member-b-");
    const repoC = freshDir("aiqt-member-c-");
    for (const r of [repoA, repoB, repoC]) runInit(contextFor(r), normalizeInitOptions({}));
    runPortfolioAdd(anyCtx(), "acme", repoA, {});
    runPortfolioAdd(anyCtx(), "acme", repoB, {});
    runPortfolioAdd(anyCtx(), "acme", repoC, {});

    const status = runPortfolioStatus(anyCtx(), "acme");
    const snapshot = (status.data as { snapshot: PortfolioSnapshot }).snapshot;
    expect(snapshot.summary).toEqual({ totalMembers: 3, healthy: 3, blocked: 0, unavailable: 0, invalidState: 0, notAiqtManaged: 0 });
  });

  it("scenario 6: invalid AIQT state in one member is visible without hiding the rest of the portfolio", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const healthyRepo = freshDir("aiqt-member-healthy-");
    runInit(contextFor(healthyRepo), normalizeInitOptions({}));
    const brokenRepo = freshDir("aiqt-member-broken-");
    mkdirSync(join(brokenRepo, ".aiqt"), { recursive: true });
    writeFileSync(join(brokenRepo, ".aiqt", "project.json"), "not valid json");

    runPortfolioAdd(anyCtx(), "acme", healthyRepo, {});
    // "add" itself is fail-closed only on ABSENCE of .aiqt/project.json, not
    // on its validity -- a member can become invalid after registration
    // (e.g. hand-edited or corrupted), which is exactly what status/check
    // must still surface (build spec Sec 2.4).
    runPortfolioAdd(anyCtx(), "acme", brokenRepo, {});

    const status = runPortfolioStatus(anyCtx(), "acme");
    expect(status.exitCode).toBe(0);
    const snapshot = (status.data as { snapshot: PortfolioSnapshot }).snapshot;
    expect(snapshot.summary.healthy).toBe(1);
    expect(snapshot.summary.invalidState).toBe(1);
  });

  it("scenario 7: one blocked member + one healthy member -- the blocker remains a blocker for that member only", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const healthyRepo = freshDir("aiqt-member-healthy2-");
    runInit(contextFor(healthyRepo), normalizeInitOptions({}));
    const blockedRepo = freshDir("aiqt-member-blocked-");
    runInit(contextFor(blockedRepo), normalizeInitOptions({}));
    const statePath = join(blockedRepo, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.projectStatus = "blocked";
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    runPortfolioAdd(anyCtx(), "acme", healthyRepo, {});
    runPortfolioAdd(anyCtx(), "acme", blockedRepo, {});

    const status = runPortfolioStatus(anyCtx(), "acme");
    expect(status.status).toBe("warning"); // portfolio may be partially healthy (Sec 6 rule 2)
    const snapshot = (status.data as { snapshot: PortfolioSnapshot }).snapshot;
    expect(snapshot.summary.healthy).toBe(1);
    expect(snapshot.summary.blocked).toBe(1);
  });

  it("scenario 11: member ordering is deterministic and stable across repeated status/check/inspect calls", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const repoA = freshDir("aiqt-member-order-a-");
    const repoB = freshDir("aiqt-member-order-b-");
    runInit(contextFor(repoA), normalizeInitOptions({}));
    runInit(contextFor(repoB), normalizeInitOptions({}));
    runPortfolioAdd(anyCtx(), "acme", repoA, {});
    runPortfolioAdd(anyCtx(), "acme", repoB, {});

    const inspect1 = runPortfolioInspect(anyCtx(), "acme");
    const inspect2 = runPortfolioInspect(anyCtx(), "acme");
    expect((inspect1.data as { portfolio: PortfolioManifest }).portfolio.members.map((m) => m.id)).toEqual(
      (inspect2.data as { portfolio: PortfolioManifest }).portfolio.members.map((m) => m.id),
    );

    const status1 = runPortfolioStatus(anyCtx(), "acme");
    const status2 = runPortfolioStatus(anyCtx(), "acme");
    const order1 = (status1.data as { snapshot: PortfolioSnapshot }).snapshot.members.map((m) => m.memberId);
    const order2 = (status2.data as { snapshot: PortfolioSnapshot }).snapshot.members.map((m) => m.memberId);
    expect(order1).toEqual(order2);
    expect(order1).toEqual(["M-001", "M-002"]);

    const check1 = runPortfolioCheck(anyCtx(), "acme");
    const check2 = runPortfolioCheck(anyCtx(), "acme");
    expect((check1.data as { report: PortfolioGovernanceReport }).report.members.map((m) => m.memberId)).toEqual(
      (check2.data as { report: PortfolioGovernanceReport }).report.members.map((m) => m.memberId),
    );
  });

  it("scenario 12: human/JSON output parity -- both render the same underlying CommandResult substance", () => {
    runPortfolioCreate(anyCtx(), "Acme");
    const repo = freshDir("aiqt-member-parity-");
    runInit(contextFor(repo), normalizeInitOptions({}));
    runPortfolioAdd(anyCtx(), "acme", repo, {});

    const result = runPortfolioStatus(anyCtx(), "acme");
    const json = JSON.parse(renderJson(result));
    const human = renderHuman(result);
    expect(json.summary).toBe(result.summary);
    expect(human).toContain(result.summary);
    expect(json.status).toBe(result.status);
  });

  it("scenario 14: dogfooding the portfolio CLI against this AIQT repository's own working directory never creates a .aiqt/ here", () => {
    const repoRoot = process.cwd();
    const hadAiqtBefore = existsSync(join(repoRoot, ".aiqt"));
    expect(hadAiqtBefore).toBe(false);

    runPortfolioCreate(contextFor(repoRoot), "Self");
    runPortfolioList(contextFor(repoRoot));

    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });

  it("scenario 17 (CLI level): list surfaces a malformed manifest as an unreadable entry without failing the whole command", () => {
    runPortfolioCreate(anyCtx(), "Good");
    writeFileSync(join(portfolioHome, "corrupt.json"), "{ this is not json", "utf8");

    const list = runPortfolioList(anyCtx());
    expect(list.exitCode).toBe(0);
    expect(list.status).toBe("warning");
    const portfolios = (list.data as { portfolios: { ok: boolean }[] }).portfolios;
    expect(portfolios).toHaveLength(2);
    expect(portfolios.some((p) => p.ok)).toBe(true);
    expect(portfolios.some((p) => !p.ok)).toBe(true);
  });
});
