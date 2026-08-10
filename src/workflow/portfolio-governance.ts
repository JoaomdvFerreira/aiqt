import { loadPortfolioMemberState, type PortfolioMemberStatus } from "./portfolio-snapshot.js";
import { selectDueSchedule } from "./maintenance-due-engine.js";
import { getDecisionEscalations } from "../services/evidence-service.js";
import type { PortfolioManifest, PortfolioMember } from "../schema/portfolio.schema.js";

/**
 * M46-WU04/WU05 closure reconciliation: portfolio governance/attention
 * check (build spec Sec 6). Aggregation only -- reads existing M42 defect,
 * M45 maintenance-schedule, and M22 decision-escalation evidence already
 * inside each member's canonical state via the same
 * loadPortfolioMemberState() WU46-03 introduced; never mutates a member,
 * never queues/approves remediation, never runs a maintenance task, never
 * resolves/withdraws an escalation. M42 remains the owner of defect/
 * remediation authority, M45 of maintenance scheduling/execution
 * authority, and M22 (evidence-service.ts) of the decision-escalation
 * lifecycle -- this module only reads their existing typed data: the same
 * pure selectDueSchedule() `aiqt maintenance run-due` itself calls, and
 * the same getDecisionEscalations() accessor M22's own evidence-import
 * command path uses, never a duplicate/redefined escalation contract.
 *
 * Closure audit finding: an OPEN DecisionEscalation is a durable,
 * canonical human-input signal distinct from M42's defect `needs_human`
 * status. A member can have zero needs_human defects yet still have an
 * open escalation genuinely awaiting a human decision (build spec Sec 6
 * rule 4, "needs_input remains human input") -- this was the one gap the
 * original WU46-04 aggregation missed, corrected here without touching
 * WU46-01..03's contracts, the portfolio manifest schema, or either
 * schema version.
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
  /** M22 DecisionEscalationStatus "open" only -- "resolved"/"withdrawn" never count (build spec correction requirement 5). */
  openDecisionEscalationCount: number;
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
  totalOpenDecisionEscalations: number;
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
      openDecisionEscalationCount: 0,
      maintenanceDue: false,
      blockingIssues: loaded.blockingIssues,
      warnings: [],
    };
  }

  const { state } = loaded;
  const defects = state.defects ?? [];
  const openDefects = defects.filter((d) => OPEN_DEFECT_STATUSES.has(d.status));
  const needsHumanDefects = defects.filter((d) => d.status === "needs_human");

  const openEscalations = getDecisionEscalations(state).filter((e) => e.status === "open");

  const schedules = state.maintenanceSchedules ?? [];
  const dueResult = selectDueSchedule(schedules, state.maintenanceActiveOccurrence != null, now);
  const maintenanceDue = dueResult.ok && dueResult.schedule !== null;

  // Build spec Sec 6 rule 1: member-level blockers (blocked project status) remain blockers here.
  const status: PortfolioMemberStatus = state.projectStatus === "blocked" ? "blocked" : "healthy";
  const requiresHumanInput = needsHumanDefects.length > 0 || openEscalations.length > 0;
  const requiresAttention = status === "blocked" || requiresHumanInput || openDefects.length > 0 || maintenanceDue;

  const warnings: string[] = [];
  if (openDefects.length > 0) warnings.push(`${openDefects.length} open defect(s).`);
  if (maintenanceDue) warnings.push("A maintenance occurrence is due.");

  const blockingIssues: string[] = [];
  if (status === "blocked") blockingIssues.push("Project status is blocked.");
  if (needsHumanDefects.length > 0) blockingIssues.push(`${needsHumanDefects.length} defect(s) require human input.`);
  if (openEscalations.length > 0) blockingIssues.push(`${openEscalations.length} open decision escalation(s) await a human decision.`);

  return {
    memberId: member.id,
    root: member.root,
    ...(member.alias !== undefined ? { alias: member.alias } : {}),
    status,
    requiresAttention,
    requiresHumanInput,
    openDefectCount: openDefects.length,
    needsHumanDefectCount: needsHumanDefects.length,
    openDecisionEscalationCount: openEscalations.length,
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
    totalOpenDecisionEscalations: members.reduce((sum, m) => sum + m.openDecisionEscalationCount, 0),
    membersWithMaintenanceDue: members.filter((m) => m.maintenanceDue).length,
  };

  return { portfolioId: manifest.id, generatedAt: now, members, summary };
}
