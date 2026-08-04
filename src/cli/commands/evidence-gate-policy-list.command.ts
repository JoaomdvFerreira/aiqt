import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getEvidenceGatePolicies, getActivePolicyRef } from "../../services/evidence-gate-policy-service.js";

/**
 * @deprecated M33-WU05: this per-file wrapper now only delegates to the
 * shared familyFailureResult() (M33-WU02) -- prefer calling
 * familyFailureResult() directly in any new code. Retained here only to
 * avoid rewriting every existing call site in this file; not removed
 * because doing so would touch call sites with no behavioral benefit.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

/** aiqt evidence gate policy list [--json] (M28 §4.1): read-only. Never materializes evidenceGate on a project that lacks it. */
export function runEvidenceGatePolicyList(ctx: CommandContext): CommandResult {
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-LIST-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const policies = getEvidenceGatePolicies(state);
  const activeRef = getActivePolicyRef(state);

  const byPolicyId = new Map<string, { policyId: string; versions: number[]; latestVersion: number }>();
  for (const p of policies) {
    const entry = byPolicyId.get(p.policyId) ?? { policyId: p.policyId, versions: [], latestVersion: 0 };
    entry.versions.push(p.version);
    entry.latestVersion = Math.max(entry.latestVersion, p.version);
    byPolicyId.set(p.policyId, entry);
  }
  const summaries = [...byPolicyId.values()]
    .map((e) => ({ ...e, versions: e.versions.sort((a, b) => a - b), active: activeRef?.policyId === e.policyId ? activeRef.version : null }))
    .sort((a, b) => a.policyId.localeCompare(b.policyId));

  return makeResult({
    status: "passed",
    action: "evidence",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `${summaries.length} evidence gate polic${summaries.length === 1 ? "y" : "ies"} (${policies.length} version(s) total).${activeRef ? ` Active: ${activeRef.policyId} v${activeRef.version}.` : " No active policy."}`,
    exitCode: ExitCode.Success,
    data: { policies: summaries, activePolicyRef: activeRef ?? null },
  });
}
