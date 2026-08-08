import { resolve } from "node:path";
import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildDefectCandidateDiscoveredEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import { runStructuralReview } from "../../workflow/structural-review-engine.js";
import { consolidateFindings, suppressKnownBenignFindings } from "../../workflow/structural-review-consolidation.js";
import { intakeStructuralFinding } from "../../services/structural-finding-intake-service.js";
import type { StateModel } from "../../schema/state.schema.js";

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

export interface RunDefectsIntakeStructuralOptions {
  preview?: boolean;
}

/**
 * aiqt defects intake-structural <findingKey> [--preview] [--json] (M43
 * §3.3/§7/§8/WU43-04): the sole explicit path from a structural finding
 * into the M42 defect lifecycle. Re-runs structural review fresh (never
 * trusts a caller-supplied stale finding object), verifies freshness
 * against current HEAD and intake eligibility, then reuses M42's own
 * discovery/dedup/fingerprint owner verbatim. Creates or enriches only a
 * `candidate`-status defect -- exactly M42 discovery's own starting
 * status -- never triages, queues, or authorizes remediation itself.
 */
export async function runDefectsIntakeStructural(
  ctx: CommandContext,
  findingKey: string,
  options: RunDefectsIntakeStructuralOptions,
): Promise<CommandResult> {
  try {
    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-INTAKE-STRUCTURAL-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    const raw = runStructuralReview({ repoRoot: resolve(ctx.cwd) });
    const consolidated = suppressKnownBenignFindings(consolidateFindings(raw.findings));
    const finding = consolidated.find((f) => f.findingKey === findingKey);
    if (!finding) {
      return failure(
        `No current structural finding with key "${findingKey}" at review commit ${raw.reviewCommit}. Run "aiqt review structural" to see current findings.`,
        ExitCode.InvalidInput,
        "DEFECTS-INTAKE-STRUCTURAL-UNKNOWN-KEY",
      );
    }

    const now = new Date().toISOString();
    const existingDefects = state.defects ?? [];
    const outcome = intakeStructuralFinding(finding, raw.reviewCommit, existingDefects, now);

    if (!outcome.ok) {
      return failure(
        outcome.reason,
        outcome.stale ? ExitCode.WorkflowBlocked : ExitCode.InvalidInput,
        outcome.stale ? "DEFECTS-INTAKE-STRUCTURAL-STALE" : "DEFECTS-INTAKE-STRUCTURAL-NOT-ELIGIBLE",
      );
    }

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "defects",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: intake of "${findingKey}" would create ${outcome.result.created.length} and enrich ${outcome.result.enriched.length} defect record(s); no state written.`,
        exitCode: ExitCode.Success,
        data: { created: outcome.result.created, enriched: outcome.result.enriched, outcome: "preview" },
      });
    }

    const finalState: StateModel = { ...state, defects: outcome.result.defects };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      for (const c of outcome.result.created) {
        appendRunlogEvent(
          paths.runlogFile,
          buildDefectCandidateDiscoveredEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [c.defectId, findingKey],
            data: { defectId: c.defectId, sourceKind: "review_finding", fingerprint: c.fingerprint, outcome: "created" },
          }),
        );
      }
      for (const e of outcome.result.enriched) {
        appendRunlogEvent(
          paths.runlogFile,
          buildDefectCandidateDiscoveredEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [e.defectId, findingKey],
            data: { defectId: e.defectId, sourceKind: "review_finding", fingerprint: e.fingerprint, outcome: "enriched" },
          }),
        );
      }
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "DEFECTS-INTAKE-STRUCTURAL-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "defects",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Intake of "${findingKey}": ${outcome.result.created.length} defect(s) created, ${outcome.result.enriched.length} enriched.`,
      completedActions: ["Verified structural-finding freshness and intake eligibility", "Reused M42 discovery/dedup", "Wrote state.json", "Appended runlog event(s)"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [...outcome.result.created.map((c) => c.defectId), ...outcome.result.enriched.map((e) => e.defectId)],
      exitCode: ExitCode.Success,
      data: { created: outcome.result.created, enriched: outcome.result.enriched, outcome: "applied" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "DEFECTS-INTAKE-STRUCTURAL-UNEXPECTED-ERROR");
  }
}
