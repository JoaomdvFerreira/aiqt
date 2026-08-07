import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { StateModel } from "../../schema/state.schema.js";
import type { WorkUnit } from "../../schema/work-unit.schema.js";
import type {
  NextSelectionRequest,
  NextSelectionResult,
  ReadyCandidate,
  SelectionBlockingReason,
} from "../../workflow/next-work-unit-selector.js";
import { composeExecutionGuidance } from "../../workflow/execution-guidance.js";
import type { ExecutionGuidance } from "../../schema/execution-guidance.schema.js";
import { resolveExecutionGuidanceProfileConfig } from "../../services/execution-guidance-profile-resolution-service.js";

/**
 * M20 §6/§11: shared CLI-layer plumbing for `aiqt next`'s three selection
 * modes, used identically by next.command.ts (apply) and
 * next-preview.command.ts (preview) so their blocking/error output can
 * never drift apart. The actual selection algorithm lives in
 * resolveNextSelection (workflow layer); this module only builds
 * CommandResult envelopes around it.
 */

export interface RawSelectionOptions {
  workUnit?: string;
  milestone?: string;
}

export type ParsedSelectionRequest =
  | { ok: true; request: NextSelectionRequest }
  | { ok: false; result: CommandResult };

/** M20 §6: --work-unit and --milestone are mutually exclusive; both require a non-empty value. */
export function parseSelectionRequest(
  options: RawSelectionOptions,
  actionPrefix: string,
): ParsedSelectionRequest {
  const hasWorkUnit = options.workUnit !== undefined;
  const hasMilestone = options.milestone !== undefined;

  if (hasWorkUnit && hasMilestone) {
    const message = "--work-unit and --milestone cannot both be supplied.";
    return {
      ok: false,
      result: makeResult({
        status: "failed",
        action: "next",
        summary: message,
        exitCode: ExitCode.InvalidInput,
        blockingIssues: [
          {
            id: `${actionPrefix}-CONFLICTING-SELECTOR`,
            severity: "high",
            area: "input",
            message,
            agentCanFix: false,
          },
        ],
      }),
    };
  }

  if (hasWorkUnit) {
    const value = (options.workUnit ?? "").trim();
    if (value === "") {
      const message = "--work-unit requires a non-empty work unit id.";
      return {
        ok: false,
        result: makeResult({
          status: "failed",
          action: "next",
          summary: message,
          exitCode: ExitCode.InvalidInput,
          blockingIssues: [
            {
              id: `${actionPrefix}-MISSING-WORK-UNIT-VALUE`,
              severity: "high",
              area: "input",
              message,
              agentCanFix: false,
            },
          ],
        }),
      };
    }
    return { ok: true, request: { mode: "work_unit", workUnitId: value } };
  }

  if (hasMilestone) {
    const value = (options.milestone ?? "").trim();
    if (value === "") {
      const message = "--milestone requires a non-empty milestone id.";
      return {
        ok: false,
        result: makeResult({
          status: "failed",
          action: "next",
          summary: message,
          exitCode: ExitCode.InvalidInput,
          blockingIssues: [
            {
              id: `${actionPrefix}-MISSING-MILESTONE-VALUE`,
              severity: "high",
              area: "input",
              message,
              agentCanFix: false,
            },
          ],
        }),
      };
    }
    return { ok: true, request: { mode: "milestone", milestoneId: value } };
  }

  return { ok: true, request: { mode: "default" } };
}

/** M20 §7: the active-work-unit guard, checked before every selection mode. Identical for next/next-preview. */
export function buildActiveWorkUnitGuardResult(state: StateModel, actionPrefix: string): CommandResult {
  return makeResult({
    status: "blocked",
    action: "next",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: "A work unit is already in progress. Run aiqt checkpoint before starting another.",
    nextRecommendedCommand: "aiqt checkpoint",
    exitCode: ExitCode.WorkflowBlocked,
    blockingIssues: [
      {
        id: `${actionPrefix}-WORK-UNIT-IN-PROGRESS`,
        severity: "high",
        area: "workflow",
        message: "A work unit is already in progress. Run aiqt checkpoint before starting another.",
        agentCanFix: false,
      },
    ],
  });
}

/** M20 §9/§10: build the appropriate blocked/failed result for a selection that did not resolve to a work unit. */
export function buildSelectionBlockedResult(
  state: StateModel,
  reason: SelectionBlockingReason,
  actionPrefix: string,
): CommandResult {
  const isStructural = reason.code === "unknown-work-unit" || reason.code === "unknown-milestone";
  const idCode = isStructural
    ? `${actionPrefix}-${reason.code === "unknown-work-unit" ? "UNKNOWN-WORK-UNIT" : "UNKNOWN-MILESTONE"}`
    : `${actionPrefix}-${reason.code === "not-effectively-ready" ? "TARGET-NOT-EXECUTABLE" : "NO-READY-CANDIDATE"}`;

  return makeResult({
    status: isStructural ? "failed" : "blocked",
    action: "next",
    projectStatus: state.projectStatus,
    currentMilestoneId: state.currentMilestoneId,
    currentWorkUnitId: state.currentWorkUnitId,
    summary: reason.message,
    nextRecommendedCommand: isStructural ? null : "aiqt review",
    exitCode: isStructural ? ExitCode.InvalidInput : ExitCode.WorkflowBlocked,
    blockingIssues: [
      {
        id: idCode,
        severity: isStructural ? "critical" : "high",
        area: isStructural ? "input" : "workflow",
        message: reason.message,
        agentCanFix: false,
      },
    ],
    data: isStructural
      ? undefined
      : {
          canonicalStatus: reason.canonicalStatus ?? null,
          unsatisfiedDependencyIds: reason.unsatisfiedDependencyIds ?? [],
          blockingPredecessorWorkUnitIds: reason.blockingPredecessorWorkUnitIds ?? [],
        },
  });
}

/** M20 §12: the additive candidate-reporting shape shared by apply and preview output. */
export function buildCandidateReportingData(selection: NextSelectionResult): {
  selectionMode: NextSelectionResult["mode"];
  selectedWorkUnitId: string | null;
  effectivelyReadyCandidates: ReadyCandidate[];
} {
  return {
    selectionMode: selection.mode,
    selectedWorkUnitId: selection.selectedWorkUnit?.id ?? null,
    effectivelyReadyCandidates: selection.globalCandidates,
  };
}

/** M20 §12/§15: human-readable alternative-candidate guidance, appended only when more than one candidate exists. */
export function buildAlternativeCandidateGuidance(selection: NextSelectionResult): string | null {
  if (selection.globalCandidates.length <= 1 || !selection.selectedWorkUnit) return null;
  return `Multiple work units are effectively ready. Default selection: ${selection.selectedWorkUnit.id}. Use --work-unit or --milestone to choose another ready branch.`;
}

/**
 * M39-WU04 (build spec Sec 9, "aiqt next --preview" / "aiqt next"):
 * shared execution-guidance builder called identically by
 * next.command.ts (apply) and next-preview.command.ts (preview), so the
 * selected work unit is guaranteed identical guidance for the same
 * canonical state -- mirroring this file's own established preview/apply
 * parity discipline. Advisory only; never blocks or mutates. A malformed
 * project-level profile config file falls back to generic (no concrete
 * mapping) guidance for this call rather than failing the surrounding
 * read-only/mutating command over an optional, advisory config file.
 * Context-manifest input uses only this Work Unit's own explicit
 * `agentContextRefs`/`suggestedFiles`; dependency-checkpoint-derived
 * context and the continuation capsule are intentionally not wired here
 * yet (deferred to WU39-05's "Complete shared-guidance integration").
 */
export function buildExecutionGuidanceForWorkUnit(workUnit: WorkUnit, repoRoot: string): ExecutionGuidance {
  const profileOutcome = resolveExecutionGuidanceProfileConfig({ cwd: repoRoot });
  const profileConfig = profileOutcome.ok ? profileOutcome.config : null;
  return composeExecutionGuidance({
    workUnitId: workUnit.id,
    workUnit: {
      objective: workUnit.objective,
      scope: workUnit.scope,
      outOfScope: workUnit.outOfScope,
      acceptanceCriteria: workUnit.acceptanceCriteria,
      suggestedFiles: workUnit.suggestedFiles,
      dependencies: workUnit.dependencies,
      autonomousRiskClass: null,
    },
    profileConfig,
    contextManifestInput: {
      explicitAgentContextRefs: workUnit.agentContextRefs,
      suggestedFiles: workUnit.suggestedFiles,
    },
    explicitValidationCommands: workUnit.validationCommands,
  });
}
