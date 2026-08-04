import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { getEvidenceGatePolicies, findPolicy, findLatestPolicyVersion } from "../../services/evidence-gate-policy-service.js";

export interface RunEvidenceGatePolicyShowOptions {
  policyId?: string;
  version?: number;
}

function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "evidence", area: "evidence-gate", summary, exitCode, issueId });
}

/** aiqt evidence gate policy show <policy-id> [--version <n>] [--json] (M28 §4.1): read-only. */
export function runEvidenceGatePolicyShow(ctx: CommandContext, options: RunEvidenceGatePolicyShowOptions): CommandResult {
  if (!options.policyId) {
    return failure("aiqt evidence gate policy show requires <policy-id>.", ExitCode.HumanInputRequired, "EVIDENCE-GATE-POLICY-SHOW-NO-POLICY-ID");
  }
  if (!aiqtDirExists(ctx)) {
    return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EVIDENCE-GATE-POLICY-SHOW-NO-PROJECT");
  }
  const { state } = loadProject(ctx);
  const policies = getEvidenceGatePolicies(state);

  const policy = options.version !== undefined ? findPolicy(options.policyId, options.version, policies) : findLatestPolicyVersion(options.policyId, policies);
  if (!policy) {
    return failure(
      `No policy "${options.policyId}"${options.version !== undefined ? ` v${options.version}` : ""} exists.`,
      ExitCode.InvalidInput,
      "EVIDENCE-GATE-POLICY-SHOW-NOT-FOUND",
    );
  }

  return makeResult({
    status: "passed",
    action: "evidence",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: `Policy ${policy.policyId} v${policy.version}: ${policy.rules.length} rule(s).`,
    exitCode: ExitCode.Success,
    data: { policy },
  });
}
