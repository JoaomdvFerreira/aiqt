import { resolve } from "node:path";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { resolveAiqtPaths } from "../../core/filesystem/paths.js";
import { isFile } from "../../core/filesystem/file-exists.js";
import { portfolioFailure } from "./portfolio-shared.js";
import { resolvePortfolioHome, resolvePortfolioFilePath } from "../../state/portfolio-home.js";
import {
  writePortfolioManifest,
  readPortfolioManifest,
  listPortfolioIds,
  listPortfolioManifests,
} from "../../state/portfolio-store.js";
import {
  createPortfolioManifest,
  addPortfolioMember,
  removePortfolioMember,
} from "../../services/portfolio-service.js";
import { buildPortfolioSnapshot } from "../../workflow/portfolio-snapshot.js";
import { buildPortfolioGovernanceReport } from "../../workflow/portfolio-governance.js";

/**
 * `aiqt portfolio create|list|inspect|add|remove` (M46-WU02, build spec Sec
 * 4): explicit registration only -- no filesystem crawling, no automatic
 * `.aiqt/` discovery, no GitHub organization discovery. Portfolio
 * persistence is user-home-scoped (portfolio-home.ts), not tied to the
 * current working directory's own project, so none of these commands
 * require or check for a local `.aiqt/` directory the way project-scoped
 * commands do.
 */

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export function runPortfolioCreate(_ctx: CommandContext, name: string): CommandResult {
  try {
    if (!name || name.trim().length === 0) {
      return portfolioFailure("Provide a non-empty --name for the new portfolio.", ExitCode.InvalidInput, "PORTFOLIO-CREATE-INVALID-NAME");
    }
    const home = resolvePortfolioHome();
    const existingIds = listPortfolioIds(home);
    const now = new Date().toISOString();
    const outcome = createPortfolioManifest({ name, existingIds, now });
    if (!outcome.ok) {
      return portfolioFailure(outcome.reason, ExitCode.InvalidInput, "PORTFOLIO-CREATE-CAP-REACHED");
    }

    writePortfolioManifest(home, outcome.manifest);

    return makeResult({
      status: "passed",
      action: "portfolio",
      summary: `Created portfolio "${outcome.manifest.id}" (${outcome.manifest.name}).`,
      completedActions: ["Wrote portfolio manifest"],
      changedFiles: [resolvePortfolioFilePath(home, outcome.manifest.id)],
      affectedItems: [outcome.manifest.id],
      exitCode: ExitCode.Success,
      data: { portfolio: outcome.manifest },
    });
  } catch (err) {
    return portfolioFailure(err instanceof Error ? err.message : String(err), ExitCode.InvalidInput, "PORTFOLIO-CREATE-UNEXPECTED-ERROR");
  }
}

// ---------------------------------------------------------------------------
// list / inspect (read-only)
// ---------------------------------------------------------------------------

export function runPortfolioList(_ctx: CommandContext): CommandResult {
  const home = resolvePortfolioHome();
  const entries = listPortfolioManifests(home);
  const invalid = entries.filter((e) => !e.ok);
  const summary =
    entries.length === 0
      ? "No portfolios exist."
      : `${entries.length} portfolio(s) found${invalid.length > 0 ? ` (${invalid.length} unreadable)` : ""}.`;

  return makeResult({
    status: invalid.length > 0 ? "warning" : "passed",
    action: "portfolio",
    summary,
    exitCode: ExitCode.Success,
    warnings: invalid.map((e) => ({
      id: "PORTFOLIO-LIST-INVALID-MANIFEST",
      severity: "medium",
      area: "portfolio",
      message: `Portfolio "${e.id}" could not be read: ${e.reason}`,
      agentCanFix: false,
    })),
    data: { portfolios: entries },
  });
}

export function runPortfolioInspect(_ctx: CommandContext, portfolioId: string): CommandResult {
  const home = resolvePortfolioHome();
  const result = readPortfolioManifest(home, portfolioId);
  if (!result.ok) {
    return portfolioFailure(result.reason, ExitCode.InvalidInput, "PORTFOLIO-INSPECT-NOT-FOUND");
  }
  return makeResult({
    status: "passed",
    action: "portfolio",
    summary: `Portfolio "${result.manifest.id}" (${result.manifest.name}): ${result.manifest.members.length} member(s).`,
    exitCode: ExitCode.Success,
    data: { portfolio: result.manifest },
  });
}

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

export interface RunPortfolioAddOptions {
  alias?: string;
}

/**
 * Build spec Sec 4 "add": "Registration policy for non-AIQT repositories
 * must be deterministic and documented. Prefer fail-closed..." -- a root
 * without `.aiqt/project.json` is rejected before it ever enters a
 * manifest, so every registered member is verifiably AIQT-managed at
 * registration time (live status is re-checked at `status`/`check` time,
 * WU46-03/04, since a member can be moved/broken afterward).
 */
export function runPortfolioAdd(ctx: CommandContext, portfolioId: string, repoPath: string, options: RunPortfolioAddOptions): CommandResult {
  try {
    const home = resolvePortfolioHome();
    const readResult = readPortfolioManifest(home, portfolioId);
    if (!readResult.ok) {
      return portfolioFailure(readResult.reason, ExitCode.InvalidInput, "PORTFOLIO-ADD-NOT-FOUND");
    }

    const resolvedRoot = resolve(ctx.cwd, repoPath);
    const memberAiqtPaths = resolveAiqtPaths(resolvedRoot);
    if (!isFile(memberAiqtPaths.projectFile)) {
      return portfolioFailure(
        `"${resolvedRoot}" is not an AIQT-managed repository (no .aiqt/project.json found). Registration is fail-closed for non-AIQT repositories.`,
        ExitCode.InvalidInput,
        "PORTFOLIO-ADD-NOT-AIQT-MANAGED",
      );
    }

    const now = new Date().toISOString();
    const outcome = addPortfolioMember(readResult.manifest, { root: resolvedRoot, ...(options.alias !== undefined ? { alias: options.alias } : {}), now });
    if (!outcome.ok) {
      return portfolioFailure(outcome.reason, ExitCode.InvalidInput, "PORTFOLIO-ADD-REJECTED");
    }

    writePortfolioManifest(home, outcome.manifest);

    return makeResult({
      status: "passed",
      action: "portfolio",
      summary: `Registered ${resolvedRoot} as member ${outcome.member.id} in portfolio "${portfolioId}".`,
      completedActions: ["Wrote portfolio manifest"],
      changedFiles: [resolvePortfolioFilePath(home, portfolioId)],
      affectedItems: [outcome.member.id],
      exitCode: ExitCode.Success,
      data: { portfolio: outcome.manifest, member: outcome.member },
    });
  } catch (err) {
    return portfolioFailure(err instanceof Error ? err.message : String(err), ExitCode.InvalidInput, "PORTFOLIO-ADD-UNEXPECTED-ERROR");
  }
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

/** Build spec Sec 4 "remove": portfolio membership only -- never mutates the member repository. */
export function runPortfolioRemove(_ctx: CommandContext, portfolioId: string, memberId: string): CommandResult {
  try {
    const home = resolvePortfolioHome();
    const readResult = readPortfolioManifest(home, portfolioId);
    if (!readResult.ok) {
      return portfolioFailure(readResult.reason, ExitCode.InvalidInput, "PORTFOLIO-REMOVE-NOT-FOUND");
    }

    const now = new Date().toISOString();
    const outcome = removePortfolioMember(readResult.manifest, memberId, now);
    if (!outcome.ok) {
      return portfolioFailure(outcome.reason, ExitCode.InvalidInput, "PORTFOLIO-REMOVE-MEMBER-NOT-FOUND");
    }

    writePortfolioManifest(home, outcome.manifest);

    return makeResult({
      status: "passed",
      action: "portfolio",
      summary: `Removed member ${memberId} from portfolio "${portfolioId}".`,
      completedActions: ["Wrote portfolio manifest"],
      changedFiles: [resolvePortfolioFilePath(home, portfolioId)],
      affectedItems: [memberId],
      exitCode: ExitCode.Success,
      data: { portfolio: outcome.manifest },
    });
  } catch (err) {
    return portfolioFailure(err instanceof Error ? err.message : String(err), ExitCode.InvalidInput, "PORTFOLIO-REMOVE-UNEXPECTED-ERROR");
  }
}

// ---------------------------------------------------------------------------
// status (M46-WU03)
// ---------------------------------------------------------------------------

/**
 * Build spec Sec 4 "status": "Loads member state and returns a compact
 * deterministic portfolio snapshot." Read-only -- never mutates a member
 * repository's own .aiqt/ state, and never mutates the portfolio manifest.
 */
export function runPortfolioStatus(_ctx: CommandContext, portfolioId: string): CommandResult {
  const home = resolvePortfolioHome();
  const readResult = readPortfolioManifest(home, portfolioId);
  if (!readResult.ok) {
    return portfolioFailure(readResult.reason, ExitCode.InvalidInput, "PORTFOLIO-STATUS-NOT-FOUND");
  }

  const now = new Date().toISOString();
  const snapshot = buildPortfolioSnapshot(readResult.manifest, now);
  const { summary } = snapshot;
  const hasAttention = summary.blocked + summary.unavailable + summary.invalidState + summary.notAiqtManaged > 0;

  return makeResult({
    status: hasAttention ? "warning" : "passed",
    action: "portfolio",
    summary:
      summary.totalMembers === 0
        ? `Portfolio "${portfolioId}" has no registered members.`
        : `Portfolio "${portfolioId}": ${summary.healthy}/${summary.totalMembers} healthy, ${summary.blocked} blocked, ${summary.unavailable} unavailable, ${summary.invalidState} invalid, ${summary.notAiqtManaged} not AIQT-managed.`,
    exitCode: ExitCode.Success,
    data: { snapshot },
  });
}

// ---------------------------------------------------------------------------
// check (M46-WU04)
// ---------------------------------------------------------------------------

/**
 * Build spec Sec 4 "check": "may report defects, maintenance due,
 * blockers, and human-input requirements, but must not create remediation
 * authority." Read-only aggregation; the M33 exit-10 invariant
 * (exitCode === 10 <=> status === "needs_input" && requiresHumanInput)
 * applies here exactly like any other command.
 */
export function runPortfolioCheck(_ctx: CommandContext, portfolioId: string): CommandResult {
  const home = resolvePortfolioHome();
  const readResult = readPortfolioManifest(home, portfolioId);
  if (!readResult.ok) {
    return portfolioFailure(readResult.reason, ExitCode.InvalidInput, "PORTFOLIO-CHECK-NOT-FOUND");
  }

  const now = new Date().toISOString();
  const report = buildPortfolioGovernanceReport(readResult.manifest, now);
  const { summary } = report;

  const needsHumanInput = summary.membersNeedingHumanInput > 0;
  const needsAttention = summary.membersNeedingAttention > 0;

  const summaryText =
    summary.totalMembers === 0
      ? `Portfolio "${portfolioId}" has no registered members.`
      : `Portfolio "${portfolioId}": ${summary.membersNeedingAttention}/${summary.totalMembers} member(s) need attention (${summary.membersNeedingHumanInput} need human input, ${summary.totalOpenDefects} open defect(s), ${summary.totalOpenDecisionEscalations} open decision escalation(s), ${summary.membersWithMaintenanceDue} with maintenance due).`;

  return makeResult({
    status: needsHumanInput ? "needs_input" : needsAttention ? "warning" : "passed",
    action: "portfolio",
    summary: summaryText,
    exitCode: needsHumanInput ? ExitCode.HumanInputRequired : ExitCode.Success,
    requiresHumanInput: needsHumanInput,
    data: { report },
  });
}
