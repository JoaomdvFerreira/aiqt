import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { contextFor } from "../helpers.js";
import { buildPortfolioGovernanceReport } from "../../src/workflow/portfolio-governance.js";
import type { PortfolioManifest, PortfolioMember } from "../../src/schema/portfolio.schema.js";
import { PORTFOLIO_SCHEMA_VERSION } from "../../src/schema/portfolio.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";

const dirs: string[] = [];
function tempDir(prefix = "aiqt-governance-test-"): string {
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

function manifest(members: PortfolioMember[]): PortfolioManifest {
  return { schemaVersion: PORTFOLIO_SCHEMA_VERSION, id: "acme", name: "Acme", members, createdAt: NOW, updatedAt: NOW };
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

function readState(root: string) {
  return JSON.parse(readFileSync(join(root, ".aiqt", "state.json"), "utf8"));
}
function writeState(root: string, state: unknown) {
  writeFileSync(join(root, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}

describe("buildPortfolioGovernanceReport (M46-WU04, build spec Sec 6)", () => {
  it("reports zero attention for a healthy member with no defects/maintenance", () => {
    const root = tempDir();
    runInit(contextFor(root), normalizeInitOptions({}));
    const report = buildPortfolioGovernanceReport(manifest([member({ root })]), NOW);

    expect(report.summary.membersNeedingAttention).toBe(0);
    expect(report.summary.membersNeedingHumanInput).toBe(0);
    expect(report.members[0].requiresAttention).toBe(false);
  });

  it("surfaces an unavailable/unreadable member as requiring attention, never silently omitted (Sec 6 rule 3)", () => {
    const missingRoot = join(tempDir(), "gone");
    const report = buildPortfolioGovernanceReport(manifest([member({ root: missingRoot })]), NOW);

    expect(report.members).toHaveLength(1);
    expect(report.members[0].requiresAttention).toBe(true);
    expect(report.members[0].status).toBe("unavailable");
    expect(report.summary.membersNeedingAttention).toBe(1);
  });

  it("surfaces a blocked member as a blocker that remains a blocker (Sec 6 rule 1)", () => {
    const root = tempDir();
    runInit(contextFor(root), normalizeInitOptions({}));
    const state = readState(root);
    state.projectStatus = "blocked";
    writeState(root, state);

    const report = buildPortfolioGovernanceReport(manifest([member({ root })]), NOW);
    expect(report.members[0].status).toBe("blocked");
    expect(report.members[0].requiresAttention).toBe(true);
    expect(report.members[0].blockingIssues.length).toBeGreaterThan(0);
  });

  it("counts open defects and flags needs_human defects as requiring human input (Sec 6 rule 4)", () => {
    const root = tempDir();
    runInit(contextFor(root), normalizeInitOptions({}));
    const state = readState(root);
    state.defects = [
      buildDefect("DEF-001", "queued"),
      buildDefect("DEF-002", "needs_human"),
      buildDefect("DEF-003", "resolved"),
    ];
    writeState(root, state);

    const report = buildPortfolioGovernanceReport(manifest([member({ root })]), NOW);
    const m = report.members[0];
    expect(m.openDefectCount).toBe(2);
    expect(m.needsHumanDefectCount).toBe(1);
    expect(m.requiresHumanInput).toBe(true);
    expect(report.summary.membersNeedingHumanInput).toBe(1);
    expect(report.summary.totalOpenDefects).toBe(2);
  });

  it("reports a partially healthy portfolio: one clean member, one needing attention", () => {
    const healthyRoot = tempDir();
    runInit(contextFor(healthyRoot), normalizeInitOptions({}));
    const missingRoot = join(tempDir(), "gone");

    const report = buildPortfolioGovernanceReport(
      manifest([member({ id: "M-001", root: healthyRoot }), member({ id: "M-002", root: missingRoot })]),
      NOW,
    );
    expect(report.summary.totalMembers).toBe(2);
    expect(report.summary.membersNeedingAttention).toBe(1);
    expect(report.members[0].requiresAttention).toBe(false);
    expect(report.members[1].requiresAttention).toBe(true);
  });

  it("flags a due maintenance schedule without executing it (Sec 6: aggregation, not a new authority layer)", () => {
    const root = tempDir();
    runInit(contextFor(root), normalizeInitOptions({}));
    const state = readState(root);
    state.maintenanceSchedules = [
      {
        id: "SCHED-001",
        taskKind: "structural_review",
        enabled: true,
        cadenceSeconds: 3600,
        anchorAt: "2020-01-01T00:00:00.000Z",
        nextDueAt: "2020-01-01T01:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW,
        lastOccurrenceAt: null,
        lastOccurrenceId: null,
        lastResultStatus: null,
        policy: {},
      },
    ];
    writeState(root, state);

    const report = buildPortfolioGovernanceReport(manifest([member({ root })]), NOW);
    expect(report.members[0].maintenanceDue).toBe(true);
    expect(report.summary.membersWithMaintenanceDue).toBe(1);
    // No execution side effect: the member's own state file is never rewritten by this read-only check.
    expect(readState(root).maintenanceActiveOccurrence).toBeUndefined();
  });
});
