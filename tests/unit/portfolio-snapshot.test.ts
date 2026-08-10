import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { contextFor } from "../helpers.js";
import { buildPortfolioMemberSnapshot, buildPortfolioSnapshot } from "../../src/workflow/portfolio-snapshot.js";
import type { PortfolioManifest, PortfolioMember } from "../../src/schema/portfolio.schema.js";
import { PORTFOLIO_SCHEMA_VERSION } from "../../src/schema/portfolio.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";

const dirs: string[] = [];
function tempDir(prefix = "aiqt-snapshot-test-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function member(overrides: Partial<PortfolioMember>): PortfolioMember {
  return { id: "M-001", root: tempDir(), addedAt: NOW, ...overrides };
}

describe("buildPortfolioMemberSnapshot (M46-WU03, build spec Sec 5/6)", () => {
  it("classifies a missing/moved root as unavailable", () => {
    const root = join(tempDir(), "does-not-exist");
    const snapshot = buildPortfolioMemberSnapshot(member({ root }));
    expect(snapshot.status).toBe("unavailable");
    expect(snapshot.blockingIssues).toHaveLength(1);
  });

  it("classifies an existing directory with no .aiqt/ as not_aiqt_managed", () => {
    const root = tempDir();
    const snapshot = buildPortfolioMemberSnapshot(member({ root }));
    expect(snapshot.status).toBe("not_aiqt_managed");
  });

  it("classifies a healthy AIQT-managed member", () => {
    const root = tempDir();
    runInit(contextFor(root), normalizeInitOptions({}));
    const snapshot = buildPortfolioMemberSnapshot(member({ root, alias: "foo" }));
    expect(snapshot.status).toBe("healthy");
    expect(snapshot.alias).toBe("foo");
    expect(snapshot.projectId).toBeTruthy();
    expect(snapshot.blockingIssues).toEqual([]);
  });

  it("classifies a member whose state.projectStatus is blocked", () => {
    const root = tempDir();
    runInit(contextFor(root), normalizeInitOptions({}));
    const statePath = join(root, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.projectStatus = "blocked";
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const snapshot = buildPortfolioMemberSnapshot(member({ root }));
    expect(snapshot.status).toBe("blocked");
  });

  it("classifies invalid/malformed canonical state as invalid_state without throwing", () => {
    const root = tempDir();
    mkdirSync(join(root, ".aiqt"), { recursive: true });
    writeFileSync(join(root, ".aiqt", "project.json"), "not json");

    const snapshot = buildPortfolioMemberSnapshot(member({ root }));
    expect(snapshot.status).toBe("invalid_state");
    expect(snapshot.blockingIssues).toHaveLength(1);
  });
});

describe("buildPortfolioSnapshot (M46-WU03)", () => {
  function manifest(members: PortfolioMember[]): PortfolioManifest {
    return { schemaVersion: PORTFOLIO_SCHEMA_VERSION, id: "acme", name: "Acme", members, createdAt: NOW, updatedAt: NOW };
  }

  it("returns an empty, zeroed summary for a portfolio with no members", () => {
    const snapshot = buildPortfolioSnapshot(manifest([]), NOW);
    expect(snapshot.members).toEqual([]);
    expect(snapshot.summary.totalMembers).toBe(0);
  });

  it("aggregates a mix of healthy and unavailable members deterministically, preserving manifest order", () => {
    const healthyRoot = tempDir();
    runInit(contextFor(healthyRoot), normalizeInitOptions({}));
    const missingRoot = join(tempDir(), "gone");

    const m1 = member({ id: "M-001", root: healthyRoot });
    const m2 = member({ id: "M-002", root: missingRoot });
    const snapshot = buildPortfolioSnapshot(manifest([m1, m2]), NOW);

    expect(snapshot.members.map((m) => m.memberId)).toEqual(["M-001", "M-002"]);
    expect(snapshot.summary).toEqual({ totalMembers: 2, healthy: 1, blocked: 0, unavailable: 1, invalidState: 0, notAiqtManaged: 0 });
    expect(snapshot.generatedAt).toBe(NOW);
    expect(snapshot.portfolioId).toBe("acme");
  });
});
