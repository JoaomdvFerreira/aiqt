import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult, familyFailureResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { writeStateModel } from "../../state/workflow-state-store.js";
import { appendRunlogEvent, buildDefectCandidateDiscoveredEvent } from "../../state/runlog-store.js";
import { nextEventIdFactory } from "../../workflow/execution-runlog-event-builder.js";
import {
  discoverFromCheckpoints,
  discoverFromHumanReport,
  assessDiscoverySource,
  UNSUPPORTED_DISCOVERY_SOURCES,
  type DiscoveryCandidate,
} from "../../workflow/defect-discovery.js";
import { applyDiscoveryCandidates } from "../../services/defect-discovery-service.js";
import { DefectSeveritySchema } from "../../schema/defect.schema.js";
import type { StateModel } from "../../schema/state.schema.js";

export interface RunDefectsDiscoverOptions {
  workUnitId?: string;
  humanTitle?: string;
  humanSummary?: string;
  humanEvidence?: string;
  humanSeverity?: string;
  preview?: boolean;
}

/**
 * @deprecated M33-WU05: prefer calling familyFailureResult() directly in
 * new code; this thin wrapper is retained only for local call-site brevity.
 */
function failure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "defects", area: "defects", summary, exitCode, issueId });
}

/**
 * aiqt defects discover [--work-unit <id>] [--human-title --human-summary
 * --human-evidence --human-severity] [--preview] [--json] (M42 §5/§7/§9
 * WU42-02): bounded discovery over already-canonical checkpoint evidence
 * (failed validation commands, open checkpoint issues) plus one explicit
 * human-reported candidate when --human-title is supplied. Never scans
 * source files; unsupported sources are reported, not fabricated.
 * Discovery alone never authorizes remediation (Section 2's core
 * invariant) -- every created/enriched record starts/stays at whatever
 * status it already carries.
 */
export async function runDefectsDiscover(
  ctx: CommandContext,
  options: RunDefectsDiscoverOptions,
): Promise<CommandResult> {
  try {
    if (!aiqtDirExists(ctx)) {
      return failure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "DEFECTS-DISCOVER-NO-PROJECT");
    }
    const { paths, state } = loadProject(ctx);

    if (options.workUnitId && !state.workGraph.workUnits.some((wu) => wu.id === options.workUnitId)) {
      return failure(`Work unit "${options.workUnitId}" does not exist.`, ExitCode.InvalidInput, "DEFECTS-DISCOVER-UNKNOWN-WORK-UNIT");
    }

    const now = new Date().toISOString();
    const candidates: DiscoveryCandidate[] = discoverFromCheckpoints(state, now, { workUnitId: options.workUnitId });

    if (options.humanTitle) {
      if (!options.humanSummary || !options.humanEvidence) {
        return failure("--human-title requires --human-summary and --human-evidence.", ExitCode.HumanInputRequired, "DEFECTS-DISCOVER-INCOMPLETE-HUMAN-REPORT");
      }
      const severityParse = DefectSeveritySchema.safeParse(options.humanSeverity ?? "medium");
      if (!severityParse.success) {
        return failure(`Invalid --human-severity "${options.humanSeverity}". Expected one of: critical, high, medium, low, info.`, ExitCode.InvalidInput, "DEFECTS-DISCOVER-INVALID-SEVERITY");
      }
      candidates.push(
        discoverFromHumanReport(
          {
            title: options.humanTitle,
            summary: options.humanSummary,
            evidenceLocator: options.humanEvidence,
            severity: severityParse.data,
            affectedWorkUnitId: options.workUnitId,
          },
          now,
        ),
      );
    }

    const unsupported = UNSUPPORTED_DISCOVERY_SOURCES.map((kind) => assessDiscoverySource(kind));

    if (candidates.length === 0) {
      return makeResult({
        status: "passed",
        action: "defects",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: "No bounded defect evidence found from supported discovery sources.",
        exitCode: ExitCode.Success,
        data: { created: [], enriched: [], skippedAtCap: [], unsupportedSources: unsupported },
      });
    }

    const existingDefects = state.defects ?? [];
    const result = applyDiscoveryCandidates(existingDefects, candidates, now);

    if (options.preview) {
      return makeResult({
        status: "passed",
        action: "defects",
        projectStatus: state.projectStatus,
        currentMilestoneId: state.currentMilestoneId,
        currentWorkUnitId: state.currentWorkUnitId,
        summary: `Preview: would create ${result.created.length} and enrich ${result.enriched.length} defect record(s); no state written.`,
        exitCode: ExitCode.Success,
        data: {
          created: result.created,
          enriched: result.enriched,
          skippedAtCap: result.skippedAtCap,
          unsupportedSources: unsupported,
          outcome: "preview",
        },
      });
    }

    const finalState: StateModel = { ...state, defects: result.defects };
    writeStateModel(paths.stateFile, finalState);

    try {
      const nextEventId = nextEventIdFactory(paths.runlogFile);
      for (const c of result.created) {
        appendRunlogEvent(
          paths.runlogFile,
          buildDefectCandidateDiscoveredEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [c.defectId],
            data: { defectId: c.defectId, sourceKind: c.sourceKind, fingerprint: c.fingerprint, outcome: "created" },
          }),
        );
      }
      for (const e of result.enriched) {
        appendRunlogEvent(
          paths.runlogFile,
          buildDefectCandidateDiscoveredEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [e.defectId],
            data: { defectId: e.defectId, sourceKind: "failed_validation", fingerprint: e.fingerprint, outcome: "enriched" },
          }),
        );
      }
    } catch (err) {
      return failure(
        `State was written successfully but the runlog append failed: ${(err as Error).message}. State remains authoritative.`,
        ExitCode.InvalidInput,
        "DEFECTS-DISCOVER-RUNLOG-APPEND-FAILED",
      );
    }

    return makeResult({
      status: "passed",
      action: "defects",
      projectStatus: finalState.projectStatus,
      currentMilestoneId: finalState.currentMilestoneId,
      currentWorkUnitId: finalState.currentWorkUnitId,
      summary: `Discovered ${result.created.length} new defect candidate(s), enriched ${result.enriched.length} existing record(s)${result.skippedAtCap.length > 0 ? `, ${result.skippedAtCap.length} skipped at MAX_DEFECTS cap` : ""}.`,
      completedActions: ["Discovered bounded checkpoint evidence", "Wrote state.json", "Appended runlog event(s)"],
      changedFiles: [paths.stateFile, paths.runlogFile],
      affectedItems: [...result.created.map((c) => c.defectId), ...result.enriched.map((e) => e.defectId)],
      exitCode: ExitCode.Success,
      data: {
        created: result.created,
        enriched: result.enriched,
        skippedAtCap: result.skippedAtCap,
        unsupportedSources: unsupported,
        outcome: "applied",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(message, ExitCode.InvalidInput, "DEFECTS-DISCOVER-UNEXPECTED-ERROR");
  }
}
