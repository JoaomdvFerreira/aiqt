import { isDirectory, isFile } from "../core/filesystem/file-exists.js";
import { resolveAiqtPaths } from "../core/filesystem/paths.js";
import { readProjectModel } from "../state/project-store.js";
import { readStateModel } from "../state/workflow-state-store.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { PortfolioManifest, PortfolioMember } from "../schema/portfolio.schema.js";

/**
 * M46-WU03: bounded, read-only multi-project snapshot aggregation (build
 * spec Sec 5/6). Reuses the exact same canonical readers every project-
 * scoped command uses (readProjectModel/readStateModel) -- this module
 * never re-implements project-state parsing/validation, and never mutates
 * a member repository. One member's failure is always typed and visible
 * (Sec 2.4 "partial failure is first-class"); it never aborts the rest of
 * the snapshot.
 */

export type PortfolioMemberStatus =
  | "healthy"
  | "blocked"
  | "unavailable"
  | "invalid_state"
  | "not_aiqt_managed";

export interface PortfolioMemberSnapshot {
  memberId: string;
  root: string;
  alias?: string;
  projectId?: string;
  projectName?: string;
  status: PortfolioMemberStatus;
  currentMilestoneId: string | null;
  currentWorkUnitId: string | null;
  blockingIssues: string[];
  warnings: string[];
}

export interface PortfolioSummary {
  totalMembers: number;
  healthy: number;
  blocked: number;
  unavailable: number;
  invalidState: number;
  notAiqtManaged: number;
}

export interface PortfolioSnapshot {
  portfolioId: string;
  generatedAt: string;
  members: PortfolioMemberSnapshot[];
  summary: PortfolioSummary;
}

function baseSnapshot(member: PortfolioMember, status: PortfolioMemberStatus, blockingIssues: string[]): PortfolioMemberSnapshot {
  return {
    memberId: member.id,
    root: member.root,
    ...(member.alias !== undefined ? { alias: member.alias } : {}),
    status,
    currentMilestoneId: null,
    currentWorkUnitId: null,
    blockingIssues,
    warnings: [],
  };
}

/**
 * Build spec Sec 2.4: an unreadable/unavailable member is a first-class,
 * typed outcome, never a thrown error and never silently omitted.
 */
export function buildPortfolioMemberSnapshot(member: PortfolioMember): PortfolioMemberSnapshot {
  if (!isDirectory(member.root)) {
    return baseSnapshot(member, "unavailable", [`Repository root "${member.root}" does not exist (missing or moved).`]);
  }

  const paths = resolveAiqtPaths(member.root);
  if (!isFile(paths.projectFile)) {
    return baseSnapshot(member, "not_aiqt_managed", [`No .aiqt/project.json found at "${member.root}".`]);
  }

  try {
    const project = readProjectModel(paths.projectFile);
    const state = readStateModel(paths.stateFile);
    return {
      memberId: member.id,
      root: member.root,
      ...(member.alias !== undefined ? { alias: member.alias } : {}),
      projectId: project.project.id,
      projectName: project.project.name,
      status: state.projectStatus === "blocked" ? "blocked" : "healthy",
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      blockingIssues: [],
      warnings: [],
    };
  } catch (err) {
    const message = err instanceof AiqtError ? err.message : err instanceof Error ? err.message : String(err);
    return baseSnapshot(member, "invalid_state", [message]);
  }
}

function emptySummary(): PortfolioSummary {
  return { totalMembers: 0, healthy: 0, blocked: 0, unavailable: 0, invalidState: 0, notAiqtManaged: 0 };
}

function tallyStatus(summary: PortfolioSummary, status: PortfolioMemberStatus): void {
  summary.totalMembers += 1;
  switch (status) {
    case "healthy":
      summary.healthy += 1;
      break;
    case "blocked":
      summary.blocked += 1;
      break;
    case "unavailable":
      summary.unavailable += 1;
      break;
    case "invalid_state":
      summary.invalidState += 1;
      break;
    case "not_aiqt_managed":
      summary.notAiqtManaged += 1;
      break;
  }
}

/** Build spec Sec 5: deterministic given the same manifest and member states -- members are iterated in the manifest's own stored order. */
export function buildPortfolioSnapshot(manifest: PortfolioManifest, now: string): PortfolioSnapshot {
  const summary = emptySummary();
  const members = manifest.members.map((member) => {
    const snapshot = buildPortfolioMemberSnapshot(member);
    tallyStatus(summary, snapshot.status);
    return snapshot;
  });

  return {
    portfolioId: manifest.id,
    generatedAt: now,
    members,
    summary,
  };
}
