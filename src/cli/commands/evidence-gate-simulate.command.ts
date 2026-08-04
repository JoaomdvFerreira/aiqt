import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeTextFile } from "../../core/filesystem/safe-writer.js";
import { getEvidenceRecords } from "../../services/evidence-service.js";
import { getEvidenceGatePolicies, findPolicy, findLatestPolicyVersion, resolveActivePolicy } from "../../services/evidence-gate-policy-service.js";
import { buildEvidenceSnapshotEntries } from "../../workflow/evidence-gate-snapshot.js";
import { simulate } from "../../workflow/evidence-gate-simulation-engine.js";
import type { SimulationTarget } from "../../schema/evidence-gate-simulation.schema.js";

export interface RunEvidenceGateSimulateOptions {
  project?: boolean;
  workUnitId?: string;
  checkpointId?: string;
  policyId?: string;
  policyVersion?: number;
  asOf?: string;
  output?: string;
}

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

function isValidIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * aiqt evidence gate simulate --project|--work-unit <id>|--checkpoint <id>
 * [--policy <id> [--version <n>]] [--as-of <ts>] [--output <path>]
 * [--json] (M28 §5.1): the sole boundary for read-only evidence-gate
 * simulation. Always exits 0 for a completed simulation (pass, fail, or
 * indeterminate are all data, never a CLI failure) -- never writes
 * canonical state, never appends a runlog event, never creates a
 * finding or issue.
 */
export function runEvidenceGateSimulate(ctx: CommandContext, options: RunEvidenceGateSimulateOptions): CommandResult {
  try {
    const targetsGiven = [options.project === true, options.workUnitId !== undefined, options.checkpointId !== undefined].filter(Boolean).length;
    if (targetsGiven === 0) {
      return failure("aiqt evidence gate simulate requires exactly one of --project, --work-unit <id>, or --checkpoint <id>.", ExitCode.HumanInputRequired, "EVIDENCE-GATE-SIMULATE-NO-TARGET");
    }
    if (targetsGiven > 1) {
      return failure("aiqt evidence gate simulate accepts exactly one target; more than one target flag was given.", ExitCode.InvalidInput, "EVIDENCE-GATE-SIMULATE-MULTIPLE-TARGETS");
    }
    if (options.asOf !== undefined && !isValidIsoTimestamp(options.asOf)) {
      return failure(`Invalid --as-of timestamp: ${options.asOf}`, ExitCode.InvalidInput, "EVIDENCE-GATE-SIMULATE-INVALID-AS-OF");
    }
    const asOf = options.asOf ?? new Date().toISOString();

    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "EVIDENCE-GATE-SIMULATE-NO-PROJECT");
    }
    const { project, state } = loadProject(ctx);

    let target: SimulationTarget;
    if (options.project) {
      target = { type: "project", id: project.project.id, relatedProjectId: project.project.id };
    } else if (options.workUnitId !== undefined) {
      const wu = state.workGraph.workUnits.find((w) => w.id === options.workUnitId);
      if (!wu) {
        return failure(`Work unit "${options.workUnitId}" does not exist.`, ExitCode.InvalidInput, "EVIDENCE-GATE-SIMULATE-UNKNOWN-WORK-UNIT");
      }
      target = { type: "work_unit", id: wu.id, relatedProjectId: project.project.id };
    } else {
      const cp = state.checkpoints.find((c) => c.id === options.checkpointId);
      if (!cp) {
        return failure(`Checkpoint "${options.checkpointId}" does not exist.`, ExitCode.InvalidInput, "EVIDENCE-GATE-SIMULATE-UNKNOWN-CHECKPOINT");
      }
      target = { type: "checkpoint", id: cp.id, relatedProjectId: project.project.id, relatedWorkUnitId: cp.workUnitId };
    }

    const policies = getEvidenceGatePolicies(state);
    const policy =
      options.policyId !== undefined
        ? options.policyVersion !== undefined
          ? findPolicy(options.policyId, options.policyVersion, policies)
          : findLatestPolicyVersion(options.policyId, policies)
        : resolveActivePolicy(state);

    if (!policy) {
      if (options.policyId !== undefined) {
        return failure(
          `No policy "${options.policyId}"${options.policyVersion !== undefined ? ` v${options.policyVersion}` : ""} exists.`,
          ExitCode.InvalidInput,
          "EVIDENCE-GATE-SIMULATE-UNKNOWN-POLICY",
        );
      }
      return failure("No active or explicit evidence gate policy is selected.", ExitCode.WorkflowBlocked, "EVIDENCE-GATE-SIMULATE-NO-POLICY");
    }

    const records = getEvidenceRecords(state);
    const entries = buildEvidenceSnapshotEntries(records, project.project.id);
    const generatedAt = new Date().toISOString();
    const result = simulate({ policy, target, entries, asOf, generatedAt });

    if (options.output) {
      try {
        writeTextFile(options.output, JSON.stringify(result, null, 2) + "\n");
      } catch (err) {
        return failure(`Simulation completed but writing --output failed: ${(err as Error).message}. Canonical state was never touched.`, ExitCode.InvalidInput, "EVIDENCE-GATE-SIMULATE-OUTPUT-WRITE-FAILED");
      }
    }

    return makeResult({
      status: "passed",
      action: "evidence",
      projectStatus: state.projectStatus,
      currentMilestoneId: state.currentMilestoneId,
      currentWorkUnitId: state.currentWorkUnitId,
      summary: `Evidence gate simulation for ${target.type} "${target.id}" against policy ${policy.policyId} v${policy.version}: ${result.overallResult}.`,
      exitCode: ExitCode.Success,
      data: { simulation: result },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "EVIDENCE-GATE-SIMULATE-UNEXPECTED-ERROR");
  }
}
