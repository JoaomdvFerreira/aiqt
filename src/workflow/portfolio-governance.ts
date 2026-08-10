import { loadPortfolioMemberState, type PortfolioMemberStatus } from "./portfolio-snapshot.js";
import { selectDueSchedule } from "./maintenance-due-engine.js";
import type { PortfolioManifest, PortfolioMember } from "../schema/portfolio.schema.js";

/**
 * M46-WU04: portfolio governance/attention check (build spec Sec 6).
 * Aggregation only -- reads existing M42 defect and M45 maintenance-
 * schedule evidence already inside each member's canonical state via the
 * same loadPortfolioMemberState() WU46-03 introduced; never mutates a
 * member, never queues/approves remediation, never runs a maintenance
 * task. M42 remains the owner of defect/remediation authority and M45 of
 * maintenance scheduling/execution authority -- this module only reads
 * their existing typed data and the same pure selectDueSchedule()
 * `aiqt maintenance run-due` itself calls, never a duplicate due-decision
 * algorithm.
 */

/** Section 4.2 defect lifecycle statuses considered still "open" (not terminal). */
const OPEN_DEFECT_STATUSES: ReadonlySet<string> = new Set([
  "candidate",
  "triaged",
  "queued",
  "in_progress",
  "needs_human",
  "reopened",
  "deferred",
]);

export interface PortfolioMemberGovernance {
  memberId: string;
  root: string;
  alias?: string;
  status: PortfolioMemberStatus;
  /** True whenever this member has anything a human/operator should look at: blocked status, open defects, maintenance due, or an unreadable/unavailable member. */
  requiresAttention: boolean;
  /** Build spec Sec 6 rule 4: "needs_input remains human input" -- never auto-resolved by this check. */
  requiresHumanInput: boolean;
  openDefectCount: number;
  needsHumanDefectCount: number;
  maintenanceDue: boolean;
  blockingIssues: string[];
  warnings: string[];
}

export interface PortfolioGovernanceSummary {
  totalMembers: number;
  membersNeedingAttention: number;
  membersNeedingHumanInput: number;
  totalOpenDefects: number;
  totalNeedsHumanDefects: number;
  membersWithMaintenanceDue: number;
}

export interface PortfolioGovernanceReport {
  portfolioId: string;
  generatedAt: string;
  members: PortfolioMemberGovernance[];
  summary: PortfolioGovernanceSummary;
}

function buildMemberGovernance(member: PortfolioMember, now: string): PortfolioMemberGovernance {
  const loaded = loadPortfolioMemberState(member);
  if (!loaded.ok) {
    return {
      memberId: member.id,
      root: member.root,
      ...(member.alias !== undefined ? { alias: member.alias } : {}),
      status: loaded.status,
      // Build spec Sec 6 rule 3: an unreadable/unavailable member is never silently omitted from attention.
      requiresAttention: true,
      requiresHumanInput: false,
      openDefectCount: 0,
      needsHumanDefectCount: 0,
      maintenanceDue: false,
      blockingIssues: loaded.blockingIssues,
      warnings: [],
    };
  }

  const { state } = loaded;
  const defects = state.defects ?? [];
  const openDefects = defects.filter((d) => OPEN_DEFECT_STATUSES.has(d.status));
  const needsHumanDefects = defects.filter((d) => d.status === "needs_human");

  const schedules = state.maintenanceSchedules ?? [];
  const dueResult = selectDueSchedule(schedules, state.maintenanceActiveOccurrence != null, now);
  const maintenanceDue = dueResult.ok && dueResult.schedule !== null;

  // Build spec Sec 6 rule 1: member-level blockers (blocked project status) remain blockers here.
  const status: PortfolioMemberStatus = state.projectStatus === "blocked" ? "blocked" : "healthy";
  const requiresHumanInput = needsHumanDefects.length > 0;
  const requiresAttention = status === "blocked" || requiresHumanInput || openDefects.length > 0 || maintenanceDue;

  const warnings: string[] = [];
  if (openDefects.length > 0) warnings.push(`${openDefects.length} open defect(s).`);
  if (maintenanceDue) warnings.push("A maintenance occurrence is due.");

  const blockingIssues: string[] = [];
  if (status === "blocked") blockingIssues.push("Project status is blocked.");
  if (requiresHumanInput) blockingIssues.push(`${needsHumanDefects.length} defect(s) require human input.`);

  return {
    memberId: member.id,
    root: member.root,
    ...(member.alias !== undefined ? { alias: member.alias } : {}),
    status,
    requiresAttention,
    requiresHumanInput,
    openDefectCount: openDefects.length,
    needsHumanDefectCount: needsHumanDefects.length,
    maintenanceDue,
    blockingIssues,
    warnings,
  };
}

/** Build spec Sec 6: "The portfolio summary should identify where attention is required, not perform the action." */
export function buildPortfolioGovernanceReport(manifest: PortfolioManifest, now: string): PortfolioGovernanceReport {
  const members = manifest.members.map((member) => buildMemberGovernance(member, now));

  const summary: PortfolioGovernanceSummary = {
    totalMembers: members.length,
    membersNeedingAttention: members.filter((m) => m.requiresAttention).length,
    membersNeedingHumanInput: members.filter((m) => m.requiresHumanInput).length,
    totalOpenDefects: members.reduce((sum, m) => sum + m.openDefectCount, 0),
    totalNeedsHumanDefects: members.reduce((sum, m) => sum + m.needsHumanDefectCount, 0),
    membersWithMaintenanceDue: members.filter((m) => m.maintenanceDue).length,
  };

  return { portfolioId: manifest.id, generatedAt: now, members, summary };
}
