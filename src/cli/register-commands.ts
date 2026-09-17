import { Command } from "commander";
import { resolve } from "node:path";
import { AIQT_PACKAGE_VERSION } from "../core/constants/package-version.js";
import { makeContext, argvRequestsJson } from "./command-context.js";
import {
  normalizeInitOptions,
  collectRepeatable,
  type RawInitOptions,
  type RawUpdateOptions,
  type RawPlanOptions,
  type RawCheckpointOptions,
  type RawExportOptions,
  type RawPromptOptions,
  type RawImportOptions,
  type RawReviewOptions,
  type RawReviewAcknowledgeOptions,
  type RawReviewNightTargetOptions,
  type RawReviewNightRunOptions,
  type RawReviewNightSubmitOptions,
  type RawNextOptions,
  type RawManageOptions,
  type RawSkillsPlanOptions,
  type RawIssueListOptions,
  type RawIssueUpdateOptions,
  type RawIssuePromoteOptions,
  type RawRepairPlanOptions,
  type RawCheckpointAmendOptions,
  type RawDependencyUpdateOptions,
  type RawGraphValidateOptions,
  type RawGraphRepairOptions,
  type RawEvidenceImportOptions,
  type RawWorkspacePrepareOptions,
  type RawWorkspaceStatusOptions,
  type RawWorkspaceReleaseOptions,
  type RawWorkspaceRecoverOptions,
  type RawExecutionImportOptions,
  type RawExecutionStaleOptions,
  type RawExecutionStatusOptions,
  type RawExecutionAdapterClaudeCodeRequestOptions,
  type RawExecutionAdapterClaudeCodeImportOptions,
  type RawExecutionAdapterClaudeCodeStatusOptions,
  type RawEvidenceGatePolicyImportOptions,
  type RawEvidenceGatePolicyListOptions,
  type RawEvidenceGatePolicyShowOptions,
  type RawEvidenceGatePolicyActivateOptions,
  type RawEvidenceGateSimulateOptions,
  type RawEvidenceGateAdvisoryRefreshOptions,
  type RawEvidenceGateAdvisoryFeedbackOptions,
  type RawEvidenceGateEnforcementProfileImportOptions,
  type RawEvidenceGateEnforcementProfileShowOptions,
  type RawEvidenceGateEnforcementRecoveryImportOptions,
  type RawEvidenceGateEnforcementActivationPrepareOptions,
  type RawEvidenceGateEnforcementActivationActivateOptions,
  type RawEvidenceGateEnforcementActivationDeactivateOptions,
  type RawEvidenceGateExceptionCreateOptions,
  type RawEvidenceGateExceptionRevokeOptions,
  type RawExecutionExternalRequestOptions,
  type RawExecutionExternalImportOptions,
  type RawExecutionExternalStatusOptions,
  type RawAutonomousInspectOptions,
  type RawAutonomousClassifyOptions,
  type RawAutonomousApproveOptions,
  type RawAutonomousRunOptions,
  type RawAutonomousStatusOptions,
  type RawAutonomousCancelOptions,
  type RawAutonomousResultOptions,
  type RawAutonomousCleanupOptions,
  type RawAutonomousAgentImportOptions,
  type RawReleaseAssessOptions,
  type RawReleaseValidateOptions,
  type RawReleaseNotesOptions,
  type RawReleasePrepareOptions,
  type RawReleaseStatusOptions,
  type RawReleaseDraftOptions,
  type RawReleaseHistoryOptions,
  type RawReleaseReconstructOptions,
  type RawValidationSelectOptions,
  type RawValidationExplainOptions,
  type RawDefectsDiscoverOptions,
  type RawDefectsListOptions,
  type RawDefectsTriageOptions,
  type RawDefectsTransitionOptions,
  type RawDefectsRemediateOptions,
  type RawDefectsRecordValidationOptions,
  type RawMaintenanceScheduleAddOptions,
  type RawMaintenanceScheduleListOptions,
  type RawMaintenanceScheduleUpdateOptions,
  type RawMaintenanceStatusOptions,
  type RawMaintenanceHistoryOptions,
  type RawPortfolioCreateOptions,
  type RawPortfolioListOptions,
  type RawPortfolioInspectOptions,
  type RawPortfolioAddOptions,
  type RawPortfolioRemoveOptions,
  type RawPortfolioStatusOptions,
  type RawPortfolioCheckOptions,
  type RawPrPrepareOptions,
  type RawPrInspectOptions,
  type RawPrPushOptions,
  type RawPrCreateOptions,
  type RawPrStatusOptions,
  type RawPrValidateOptions,
} from "./options.js";
import { runInit } from "./commands/init.command.js";
import { runStatus } from "./commands/status.command.js";
import { runNext } from "./commands/next.command.js";
import { runNextPreview } from "./commands/next-preview.command.js";
import { runNextCancel } from "./commands/next-cancel.command.js";
import { runUpdate } from "./commands/update.command.js";
import { runPlan } from "./commands/plan.command.js";
import { EXAMPLE_PLAN_INPUT } from "./commands/plan-example.js";
import { runCheckpoint } from "./commands/checkpoint.command.js";
import { EXAMPLE_CHECKPOINT_INPUT } from "./commands/checkpoint-example.js";
import { runReviewCommand } from "./commands/review.command.js";
import { runReviewStructural } from "./commands/review-structural.command.js";
import { runReviewStructuralExplain } from "./commands/review-structural-explain.command.js";
import { runReviewAcknowledge } from "./commands/review-acknowledge.command.js";
import { runReviewNightRun, runReviewNightSubmit, runReviewNightStatus, runReviewNightCancel, runReviewNightCoverage } from "./commands/night-audit.command.js";
import { resolveNightAuditTargetRoot } from "../services/night-audit-session-service.js";
import { runExport } from "./commands/export.command.js";
import { runStart } from "./commands/start.command.js";
import { runContinue } from "./commands/continue.command.js";
import { runPrompt } from "./commands/prompt.command.js";
import { runImport } from "./commands/import.command.js";
import { runManage } from "./commands/manage.command.js";
import { renderManageReportText } from "../services/manage-report-template.js";
import type { ManageReport } from "../services/manage-service.js";
import type { RootResolution } from "../workflow/root-resolution.js";
import { runSkillsPlan } from "./commands/skills-plan.command.js";
import { renderSkillsPlanText } from "../services/skills-plan-template.js";
import type { SkillsPlan } from "../services/skills-detection-service.js";
import { runIssueList } from "./commands/issue-list.command.js";
import { runIssueUpdate } from "./commands/issue-update.command.js";
import { runIssuePromote } from "./commands/issue-promote.command.js";
import { runRepairPlan } from "./commands/repair-plan.command.js";
import { renderIssueListText, renderRepairPlanText } from "../services/issue-report-template.js";
import { renderParallelStatusText, type ParallelStatusData } from "../services/parallel-status-template.js";
import type { IssueListData } from "./commands/issue-list.command.js";
import type { RepairPlanData } from "./commands/repair-plan.command.js";
import { runCheckpointAmend } from "./commands/checkpoint-amend.command.js";
import { runDependencyUpdate } from "./commands/dependency-update.command.js";
import { runGraphValidate } from "./commands/graph-validate.command.js";
import { runGraphRepair } from "./commands/graph-repair.command.js";
import { runEvidenceImport } from "./commands/evidence-import.command.js";
import {
  runWorkspacePrepare,
  runWorkspaceStatus,
  runWorkspaceRelease,
  runWorkspaceRecover,
} from "./commands/workspace.command.js";
import { runExecutionImport } from "./commands/execution-import.command.js";
import { EXAMPLE_EXECUTION_ENVELOPE } from "./commands/execution-import-example.js";
import { runExecutionStale } from "./commands/execution-stale.command.js";
import { runExecutionStatus } from "./commands/execution-status.command.js";
import { runExecutionAdapterClaudeCodeRequest } from "./commands/execution-adapter-claude-code-request.command.js";
import { runExecutionAdapterClaudeCodeImport } from "./commands/execution-adapter-claude-code-import.command.js";
import { runExecutionAdapterClaudeCodeStatus } from "./commands/execution-adapter-claude-code-status.command.js";
import { EXAMPLE_CLAUDE_CODE_REQUEST } from "./commands/execution-adapter-claude-code-example.js";
import { runEvidenceGatePolicyImport } from "./commands/evidence-gate-policy-import.command.js";
import { runEvidenceGatePolicyList } from "./commands/evidence-gate-policy-list.command.js";
import { runEvidenceGatePolicyShow } from "./commands/evidence-gate-policy-show.command.js";
import { runEvidenceGatePolicyActivate } from "./commands/evidence-gate-policy-activate.command.js";
import { runEvidenceGateSimulate } from "./commands/evidence-gate-simulate.command.js";
import { runEvidenceGateAdvisoryRefresh } from "./commands/evidence-gate-advisory-refresh.command.js";
import { runEvidenceGateAdvisoryFeedback } from "./commands/evidence-gate-advisory-feedback.command.js";
import { runEvidenceGateEnforcementProfileImport } from "./commands/evidence-gate-enforcement-profile-import.command.js";
import { runEvidenceGateEnforcementProfileList } from "./commands/evidence-gate-enforcement-profile-list.command.js";
import { runEvidenceGateEnforcementProfileShow } from "./commands/evidence-gate-enforcement-profile-show.command.js";
import { runEvidenceGateEnforcementRecoveryImport } from "./commands/evidence-gate-enforcement-recovery-import.command.js";
import { runEvidenceGateEnforcementActivationPrepare } from "./commands/evidence-gate-enforcement-activation-prepare.command.js";
import { runEvidenceGateEnforcementActivationActivate } from "./commands/evidence-gate-enforcement-activation-activate.command.js";
import { runEvidenceGateEnforcementActivationDeactivate } from "./commands/evidence-gate-enforcement-activation-deactivate.command.js";
import { runEvidenceGateExceptionCreate } from "./commands/evidence-gate-exception-create.command.js";
import { runEvidenceGateExceptionRevoke } from "./commands/evidence-gate-exception-revoke.command.js";
import { runEvidenceGateExceptionList } from "./commands/evidence-gate-exception-list.command.js";
import { runEvidenceGateEnforcementStatus } from "./commands/evidence-gate-enforcement-status.command.js";
import { runDefectsDiscover } from "./commands/defects-discover.command.js";
import { runDefectsList } from "./commands/defects-list.command.js";
import { runDefectsInspect } from "./commands/defects-inspect.command.js";
import { runDefectsTriage } from "./commands/defects-triage.command.js";
import { runDefectsQueue } from "./commands/defects-queue.command.js";
import { runDefectsTransition } from "./commands/defects-transition.command.js";
import { runDefectsRemediate } from "./commands/defects-remediate.command.js";
import { runDefectsRecordValidation } from "./commands/defects-record-validation.command.js";
import { runDefectsIntakeStructural } from "./commands/defects-intake-structural.command.js";
import { runExecutionExternalRequest } from "./commands/execution-external-request.command.js";
import { runExecutionExternalImport } from "./commands/execution-external-import.command.js";
import { runExecutionExternalStatus } from "./commands/execution-external-status.command.js";
import { EXAMPLE_EXTERNAL_REQUEST } from "./commands/execution-external-example.js";
import { runAutonomousInspect } from "./commands/autonomous-inspect.command.js";
import { runAutonomousClassify } from "./commands/autonomous-classify.command.js";
import { runAutonomousApprove } from "./commands/autonomous-approve.command.js";
import { runAutonomousRun } from "./commands/autonomous-run.command.js";
import { runAutonomousStatus } from "./commands/autonomous-status.command.js";
import { runAutonomousCancel } from "./commands/autonomous-cancel.command.js";
import { runAutonomousResult } from "./commands/autonomous-result.command.js";
import { runAutonomousCleanup } from "./commands/autonomous-cleanup.command.js";
import { runAutonomousAgentImport } from "./commands/autonomous-agent-import.command.js";
import {
  runMaintenanceScheduleAdd,
  runMaintenanceScheduleList,
  runMaintenanceScheduleInspect,
  runMaintenanceScheduleUpdate,
  runMaintenanceScheduleEnable,
  runMaintenanceScheduleDisable,
  runMaintenanceScheduleRemove,
} from "./commands/maintenance-schedule.command.js";
import { runMaintenanceStatus, runMaintenanceHistory } from "./commands/maintenance-status.command.js";
import { runMaintenanceRunDue, runMaintenanceCancel } from "./commands/maintenance-run.command.js";
import { runReleaseAssess } from "./commands/release-assess.command.js";
import { runReleaseValidate } from "./commands/release-validate.command.js";
import { runReleaseNotes } from "./commands/release-notes.command.js";
import { runReleasePrepare } from "./commands/release-prepare.command.js";
import { runReleaseStatus } from "./commands/release-status.command.js";
import { runReleaseDraft } from "./commands/release-draft.command.js";
import { runReleaseHistory } from "./commands/release-history.command.js";
import { runReleaseReconstruct } from "./commands/release-reconstruct.command.js";
import { runValidationSelect } from "./commands/validation-select.command.js";
import { runValidationExplain } from "./commands/validation-explain.command.js";
import {
  runPortfolioCreate,
  runPortfolioList,
  runPortfolioInspect,
  runPortfolioAdd,
  runPortfolioRemove,
  runPortfolioStatus,
  runPortfolioCheck,
} from "./commands/portfolio.command.js";
import { runPrPrepare, runPrInspect } from "./commands/pr-prepare.command.js";
import { runPrPush } from "./commands/pr-push.command.js";
import { runPrCreate } from "./commands/pr-create.command.js";
import { runPrStatus, runPrValidate } from "./commands/pr-status.command.js";
import { errorToResult } from "../core/output/result.js";
import { renderJson } from "../core/output/json-output.js";
import { renderHuman, renderResultFooter } from "../core/output/human-output.js";
import { renderExecutionGuidanceHuman } from "../workflow/execution-guidance-render.js";
import type { ExecutionGuidance } from "../schema/execution-guidance.schema.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { CommandResult } from "../core/output/result.js";
import { acquireProjectMutationGuard, type ProjectMutationGuard } from "../state/project-mutation-guard.js";

/**
 * Emit a CommandResult and set the process exit code.
 *
 * M33 Sec 5.5 stream policy: every `--json` payload goes to stdout,
 * regardless of exit code -- a machine consumer piping `--json` output
 * should never see an empty stdout on a normal, expected workflow outcome
 * like `blocked` or `needs_input` (M33-WU01 Contradiction A/G). Human-mode
 * text keeps the pre-M33 behavior (stdout on success, stderr otherwise),
 * since that distinction is meaningful for a human at a terminal and
 * nothing in the M33 spec requires changing it.
 */
function emit(result: CommandResult, json: boolean): void {
  const text = json ? renderJson(result) : renderHuman(result);
  if (json || result.exitCode === ExitCode.Success) {
    process.stdout.write(text + "\n");
  } else {
    process.stderr.write(text + "\n");
  }
  process.exitCode = result.exitCode;
}

const CANONICAL_MUTATION_COMMANDS = new Set([
  "init", "next", "next cancel", "update", "plan", "checkpoint", "checkpoint amend",
  "review acknowledge", "review night run", "review night submit", "review night cancel",
  "export", "import", "issue update", "issue promote", "dependency update", "graph repair",
  "evidence import", "evidence gate policy import", "evidence gate policy activate",
  "evidence gate advisory refresh", "evidence gate advisory feedback",
  "evidence gate enforcement profile import", "evidence gate enforcement recovery import",
  "evidence gate enforcement activation prepare", "evidence gate enforcement activation activate",
  "evidence gate enforcement activation deactivate", "evidence gate exception create", "evidence gate exception revoke",
  "workspace prepare", "workspace release", "workspace recover", "execution import", "execution stale",
  "execution adapter claude-code request", "execution adapter claude-code import",
  "execution external request", "execution external import", "defects discover", "defects triage",
  "defects transition", "defects remediate", "defects record-validation", "defects intake structural",
  "maintenance schedule add", "maintenance schedule update", "maintenance schedule enable",
  "maintenance schedule disable", "maintenance schedule remove", "maintenance run-due", "maintenance cancel",
]);

function commandPath(command: Command): string {
  const names: string[] = [];
  for (let current: Command | null = command; current !== null && current.parent !== null; current = current.parent) {
    names.push(current.name());
  }
  return names.reverse().join(" ");
}

function commandMutatesCanonicalState(path: string, options: Record<string, unknown>): boolean {
  if (!CANONICAL_MUTATION_COMMANDS.has(path)) return false;
  if (path === "init") return true;
  if (path === "next") return !options.preview;
  if (path === "plan" || path === "checkpoint") return !options.example;
  if (path === "export") return !options.dryRun;
  if (path === "import" || path === "evidence import" || path === "execution import") return !options.preview;
  if (path === "evidence gate advisory refresh") return !options.preview;
  if (path === "workspace prepare" || path === "workspace release") return !options.preview;
  if (path === "workspace recover" || path === "graph repair" || path === "execution stale") return Boolean(options.apply);
  return true;
}

function mutationRoot(path: string, options: Record<string, unknown>): string | null {
  // Night Audit can target another managed repository. Reuse its existing
  // resolver so portfolio members are locked at their actual project root.
  if (path.startsWith("review night ")) {
    const repository = typeof options.repository === "string" ? options.repository : undefined;
    const portfolio = typeof options.portfolio === "string" && typeof options.member === "string"
      ? { portfolioId: options.portfolio, memberId: options.member }
      : undefined;
    const target = resolveNightAuditTargetRoot(process.cwd(), repository, portfolio);
    return target.ok ? target.root : null;
  }
  return resolve(process.cwd());
}

export function buildProgram(): Command {
  const program = new Command();
  const activeMutationGuards = new WeakMap<Command, ProjectMutationGuard>();

  program
    .name("aiqt")
    .description("AIQT CLI - local workflow state engine")
    .version(AIQT_PACKAGE_VERSION)
    // M9: required so that a same-named option (e.g. --json) declared on
    // both a parent command (next, review) and its nested subcommand
    // (cancel, acknowledge) is parsed against the subcommand actually
    // invoked, not silently overwritten by the parent's default value.
    .enablePositionalOptions()
    // M33-WU03 Sec 5.4: when --json was requested, suppress commander's own
    // raw-text error/help-error output (it would otherwise write directly
    // to stderr before our own JSON-error path in src/index.ts ever runs,
    // contaminating the machine-readable stream -- M33-WU01 Contradiction
    // A). Human-mode parser errors are unaffected: commander's own text
    // still reaches stderr exactly as before.
    .configureOutput({
      writeErr: (str) => {
        if (!argvRequestsJson()) process.stderr.write(str);
      },
    })
    // Unknown commands / bad input exit with code 3.
    .exitOverride((err) => {
      // commander throws for help/version (exit 0) and parse errors.
      const code =
        err.exitCode === 0 ? ExitCode.Success : ExitCode.InvalidInput;
      process.exitCode = code;
      throw err;
    });

  // M49-WU3: this is the supported project-local mutation boundary. The
  // hooks surround the action promise, so async remote/physical operations
  // remain enclosed without replacing their specialized reconciliation.
  program.hook("preAction", (_thisCommand, actionCommand) => {
    const path = commandPath(actionCommand);
    const options = actionCommand.opts() as Record<string, unknown>;
    if (!commandMutatesCanonicalState(path, options)) return;
    const root = mutationRoot(path, options);
    if (root === null) return;
    try {
      activeMutationGuards.set(actionCommand, acquireProjectMutationGuard({
        root,
        command: path,
        create: path === "init",
      }));
    } catch (err) {
      emit(errorToResult("manage", err), Boolean(options.json));
      throw err;
    }
  });
  program.hook("postAction", (_thisCommand, actionCommand) => {
    activeMutationGuards.get(actionCommand)?.complete();
  });

  program
    .command("init")
    .description("Initialize a new AIQT project in the current folder")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--objective <objective>", "project objective")
    .option("--target-user <targetUser>", "primary target user")
    .option("--agent <agent>", "preferred coding agent")
    .option(
      "--implementation-root <path>",
      "implementation root path (clearer alias for existingRepositoryPath); omit for same-root projects",
    )
    .action((raw: RawInitOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runInit(ctx, normalizeInitOptions(raw));
      emit(result, ctx.json);
    });

  program
    .command("status")
    .description(
      "Inspect current AIQT state without modifying files (M18: reports canonical ready, effectively ready, and stale-ready work unit counts; M24: --parallel reports a read-only advisory parallel-eligibility batch)",
    )
    .option("--json", "emit machine-readable JSON output", false)
    .option("--parallel", "report a read-only advisory parallel-execution eligibility batch", false)
    .action((raw: { json?: boolean; parallel?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runStatus(ctx, { parallel: Boolean(raw.parallel) });

      if (raw.parallel && !ctx.json && result.exitCode === ExitCode.Success) {
        const data = result.data as { parallelStatus?: ParallelStatusData } | undefined;
        if (data?.parallelStatus) {
          // M33-WU04 Sec 5.8: the specialized parallel-status report keeps
          // its own bespoke body, but still trails the shared status/
          // warnings/blockers/next-command footer so it agrees
          // substantively with --json (M33-WU01 Contradiction G).
          process.stdout.write(
            renderParallelStatusText(data.parallelStatus) + renderResultFooter(result) + "\n",
          );
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  const nextCommand = program
    .command("next")
    .description(
      "Select the next effectively ready work unit and generate its agent handoff packet (M18: canonical status \"ready\" is not sufficient when an active blocking dependency is unsatisfied -- --preview and the real selection always agree; M20: --work-unit/--milestone select among effectively ready candidates explicitly, without bypassing readiness or active-execution state)",
    )
    .option("--json", "emit machine-readable JSON output", false)
    .option("--preview", "preview the next selection without mutating state", false)
    .option(
      "--work-unit <id>",
      "M20: select this exact work unit instead of the default (must be effectively ready; mutually exclusive with --milestone)",
    )
    .option(
      "--milestone <id>",
      "M20: select the first effectively ready work unit within this milestone (never falls back to another milestone; mutually exclusive with --work-unit)",
    )
    .action((raw: RawNextOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const selectionOptions = { workUnit: raw.workUnit, milestone: raw.milestone };
      const result = raw.preview
        ? runNextPreview(ctx, selectionOptions)
        : runNext(ctx, selectionOptions);

      // On successful packet generation (non-preview), human-mode output is
      // the packet text itself (paste-ready for a coding agent), not the
      // usual CommandResult summary wrapper. M33-WU04 Sec 5.8: the shared
      // footer still trails it so a degraded/warning packet (M33-WU01
      // Contradiction D) isn't silently indistinguishable from a clean one.
      if (!ctx.json && !raw.preview && result.exitCode === ExitCode.Success) {
        const data = result.data as { packet?: string; executionGuidance?: ExecutionGuidance } | undefined;
        if (typeof data?.packet === "string") {
          // M39-WU-HF01 (build spec Sec 9 example): the compact Execution
          // Guidance block trails the packet, ahead of the shared result
          // footer -- additive text only, never altering the packet body
          // that was hashed/persisted above in next.command.ts.
          const guidanceBlock = data.executionGuidance ? "\n\n" + renderExecutionGuidanceHuman(data.executionGuidance) : "";
          process.stdout.write(data.packet + guidanceBlock + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  nextCommand
    .command("cancel")
    .description("Cancel an in-progress, uncheckpointed agent packet selection")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runNextCancel(ctx);
      emit(result, ctx.json);
    });

  program
    .command("update")
    .description("Capture durable project context")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load a JSON update patch from a file")
    .option("--objective <objective>", "project objective")
    .option(
      "--target-user <targetUser>",
      "target user (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option("--agent <agent>", "preferred coding agent")
    .option("--repository-path <path>", "existing repository path")
    .option(
      "--implementation-root <path>",
      "implementation root path (clearer alias for --repository-path); both write existingRepositoryPath",
    )
    .action(async (raw: RawUpdateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runUpdate(ctx, raw);
      emit(result, ctx.json);
    });

  program
    .command("plan")
    .description("Ingest a structured plan into the canonical work graph")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load a JSON plan input file")
    .option("--example", "print a sample plan input JSON and exit", false)
    .option(
      "--extend",
      "extend an existing work graph: append without a target, or refine one work unit with --refine-work-unit (M17-RC1)",
      false,
    )
    .option(
      "--refine-work-unit <workUnitId>",
      "the work unit to refine into a detailed replacement subgraph",
    )
    .option(
      "--replace-placeholder <workUnitId>",
      "[deprecated] alias for --refine-work-unit, kept for M17 backward compatibility",
    )
    .option(
      "--preview",
      "validate and report the plan operation without persisting or appending runlog events",
      false,
    )
    .action((raw: RawPlanOptions) => {
      if (raw.example && raw.json) {
        const result = errorToResult(
          "plan",
          new AiqtError(
            "aiqt plan --example cannot be combined with --json.",
            ExitCode.InvalidInput,
            {
              id: "PLAN-EXAMPLE-JSON-CONFLICT",
              severity: "critical",
              area: "input",
              message: "aiqt plan --example cannot be combined with --json.",
              agentCanFix: false,
            },
          ),
        );
        emit(result, true);
        return;
      }

      if (raw.example) {
        process.stdout.write(JSON.stringify(EXAMPLE_PLAN_INPUT, null, 2) + "\n");
        process.exitCode = ExitCode.Success;
        return;
      }

      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPlan(ctx, {
        fromFile: raw.fromFile,
        extend: raw.extend,
        refineWorkUnit: raw.refineWorkUnit,
        replacePlaceholder: raw.replacePlaceholder,
        preview: raw.preview,
      });
      emit(result, ctx.json);
    });

  const checkpointCommand = program
    .command("checkpoint")
    .description("Capture the result of the current work unit's execution cycle")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load a JSON checkpoint input file")
    .option("--example", "print a sample checkpoint input JSON and exit", false)
    .action((raw: RawCheckpointOptions) => {
      if (raw.example && raw.json) {
        const result = errorToResult(
          "checkpoint",
          new AiqtError(
            "aiqt checkpoint --example cannot be combined with --json.",
            ExitCode.InvalidInput,
            {
              id: "CHECKPOINT-EXAMPLE-JSON-CONFLICT",
              severity: "critical",
              area: "input",
              message: "aiqt checkpoint --example cannot be combined with --json.",
              agentCanFix: false,
            },
          ),
        );
        emit(result, true);
        return;
      }

      if (raw.example) {
        process.stdout.write(JSON.stringify(EXAMPLE_CHECKPOINT_INPUT, null, 2) + "\n");
        process.exitCode = ExitCode.Success;
        return;
      }

      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runCheckpoint(ctx, { fromFile: raw.fromFile });
      emit(result, ctx.json);
    });

  checkpointCommand
    .command("amend")
    .description("Amend effective results or reconcile completed recorded unfinished work")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--checkpoint <checkpointId>", "the checkpoint id to amend")
    .option("--acceptance <result>", "effective acceptance result: passed, failed, partial, or not_checked")
    .option("--validation <result>", "effective validation result: passed, failed, partial, or not_run")
    .option("--reason <reason>", "reason for this amendment")
    .option("--resolve-not-completed <item>", "record one original notCompleted item as resolved after review")
    .option("--resolution-evidence <reference>", "optional evidence/reference for --resolve-not-completed")
    .option("--reconcile-acceptance-criterion <criterion>", "reconcile one original detailed acceptance criterion by exact text")
    .option("--criterion-result <result>", "effective result for --reconcile-acceptance-criterion: passed, failed, partial, or not_checked")
    .option("--criterion-evidence <reference>", "optional evidence/reference for --reconcile-acceptance-criterion")
    .action((raw: RawCheckpointAmendOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runCheckpointAmend(ctx, {
        checkpointId: raw.checkpoint,
        acceptance: raw.acceptance,
        validation: raw.validation,
        reason: raw.reason,
        resolvedNotCompleted: raw.resolveNotCompleted,
        resolutionEvidenceReference: raw.resolutionEvidence,
        reconciledAcceptanceCriterion: raw.reconcileAcceptanceCriterion,
        criterionResult: raw.criterionResult,
        criterionEvidenceReference: raw.criterionEvidence,
      });
      emit(result, ctx.json);
    });

  const reviewCommand = program
    .command("review")
    .description("Evaluate canonical state for integrity, workflow, context, quality, and checkpoint findings")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--mode <mode>", "review mode: development (default) or release")
    .action((raw: RawReviewOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewCommand(ctx, { mode: raw.mode });
      emit(result, ctx.json);
    });

  const reviewStructuralCommand = reviewCommand
    .command("structural")
    .description("Bounded, read-only project structural review (M43): ownership, dependency, hotspot, dead-path, contract-drift, test-infrastructure, and execution-safety-boundary domains")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--domain <domain>", "limit review to one domain")
    .action((raw: { json?: boolean; domain?: string }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewStructural(ctx, { domain: raw.domain });
      emit(result, ctx.json);
    });

  reviewStructuralCommand
    .command("explain <findingKey>")
    .description("Read-only detail for one current structural finding (re-evaluated fresh; findings are transient, never stored)")
    .option("--json", "emit machine-readable JSON output", false)
    .action((findingKey: string, raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewStructuralExplain(ctx, findingKey);
      emit(result, ctx.json);
    });

  reviewCommand
    .command("acknowledge <findingKey>")
    .description("Acknowledge a known review finding without rewriting checkpoint history")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--reason <reason>", "reason for acknowledging this finding")
    .action((findingKey: string, raw: RawReviewAcknowledgeOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewAcknowledge(ctx, { findingKey, reason: raw.reason });
      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M48: aiqt review night ... (bounded overnight project review & Issue
  // generation). Never modifies project source, creates a commit/Pull
  // Request, merges, or deploys. The only external mutation (a GitHub
  // Issue) happens inside `submit`, behind lookup-before-create dedup.
  // ---------------------------------------------------------------------
  const reviewNightCommand = reviewCommand.command("night").description("Bounded, resumable Night Audit review session (M48): small ReviewTasks, a quality gate, and evidence-backed GitHub Issue publication -- never modifies source or opens a Pull Request");

  reviewNightCommand
    .command("run")
    .description("Start (if none active) or advance the Night Audit session for this project, returning the next bounded ReviewTask or a stop reason")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--repository <path>", "target repository root (defaults to the current directory)")
    .option("--portfolio <id>", "select the target repository from an M46 portfolio (requires --member)")
    .option("--member <id>", "portfolio member id identifying exactly one repository")
    .option("--target-duration-minutes <n>", "soft session duration target (default 120)", (v) => Number.parseInt(v, 10))
    .option("--hard-stop-minutes <n>", "absolute session ceiling (default 180)", (v) => Number.parseInt(v, 10))
    .option("--max-review-tasks <n>", "maximum ReviewTasks for this session (default 40)", (v) => Number.parseInt(v, 10))
    .option("--max-new-issues <n>", "maximum new GitHub Issues for this session (default 10)", (v) => Number.parseInt(v, 10))
    .option("--max-open-audit-issue-backlog <n>", "suppress new Issue publication once this many audit issues are already open (default 25)", (v) => Number.parseInt(v, 10))
    .action((raw: RawReviewNightRunOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewNightRun(ctx, {
        repository: raw.repository,
        portfolio: raw.portfolio,
        member: raw.member,
        targetDurationMinutes: raw.targetDurationMinutes,
        hardStopMinutes: raw.hardStopMinutes,
        maxReviewTasks: raw.maxReviewTasks,
        maxNewIssues: raw.maxNewIssues,
        maxOpenAuditIssueBacklog: raw.maxOpenAuditIssueBacklog,
      });
      emit(result, ctx.json);
    });

  reviewNightCommand
    .command("submit <task-id>")
    .description("Report bounded findings for a ReviewTask returned by `run` -- quality-gates, deduplicates, intakes into the M42 defect queue, and publishes a GitHub Issue where warranted")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--repository <path>", "target repository root (defaults to the current directory)")
    .option("--portfolio <id>", "select the target repository from an M46 portfolio (requires --member)")
    .option("--member <id>", "portfolio member id identifying exactly one repository")
    .requiredOption("--domain <domain>", "the ReviewTask's exact domain, as returned by `run`")
    .requiredOption("--scope <scope>", "the ReviewTask's exact scope, as returned by `run`")
    .requiredOption("--commit <sha>", "the ReviewTask's exact repositoryCommit, as returned by `run`")
    .requiredOption("--from-file <path>", "bounded JSON file: { taskId, findings: [...] }")
    .option("--token-env <name>", "name of the environment variable holding the GitHub token (defaults to GITHUB_TOKEN)")
    .action(async (taskId: string, raw: RawReviewNightSubmitOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runReviewNightSubmit(ctx, taskId, {
        repository: raw.repository,
        portfolio: raw.portfolio,
        member: raw.member,
        domain: raw.domain,
        scope: raw.scope,
        commit: raw.commit,
        fromFile: raw.fromFile,
        tokenEnv: raw.tokenEnv,
      });
      emit(result, ctx.json);
    });

  reviewNightCommand
    .command("status")
    .description("Read-only: show the active Night Audit session, or the most recent finished session's result")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--repository <path>", "target repository root (defaults to the current directory)")
    .option("--portfolio <id>", "select the target repository from an M46 portfolio (requires --member)")
    .option("--member <id>", "portfolio member id identifying exactly one repository")
    .action((raw: RawReviewNightTargetOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewNightStatus(ctx, { repository: raw.repository, portfolio: raw.portfolio, member: raw.member });
      emit(result, ctx.json);
    });

  reviewNightCommand
    .command("cancel")
    .description("Cancel the active Night Audit session (bookkeeping only -- no live process is signaled)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--repository <path>", "target repository root (defaults to the current directory)")
    .option("--portfolio <id>", "select the target repository from an M46 portfolio (requires --member)")
    .option("--member <id>", "portfolio member id identifying exactly one repository")
    .action((raw: RawReviewNightTargetOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewNightCancel(ctx, { repository: raw.repository, portfolio: raw.portfolio, member: raw.member });
      emit(result, ctx.json);
    });

  reviewNightCommand
    .command("coverage")
    .description("Read-only: list the Night Audit coverage ledger (what has been reviewed, at which commit, when)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--repository <path>", "target repository root (defaults to the current directory)")
    .option("--portfolio <id>", "select the target repository from an M46 portfolio (requires --member)")
    .option("--member <id>", "portfolio member id identifying exactly one repository")
    .action((raw: RawReviewNightTargetOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReviewNightCoverage(ctx, { repository: raw.repository, portfolio: raw.portfolio, member: raw.member });
      emit(result, ctx.json);
    });

  program
    .command("export")
    .description("Generate a markdown export document from canonical state")
    .argument("[target]", "export target: project-plan, technical-spec, status-report, agent-packet, or all")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--format <format>", "export format (only markdown is supported)")
    .option("--dry-run", "plan the export without writing files or logging", false)
    .action((target: string | undefined, raw: RawExportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runExport(ctx, {
        target,
        format: raw.format,
        dryRun: Boolean(raw.dryRun),
      });
      emit(result, ctx.json);
    });

  program
    .command("start")
    .description("Show the next guided step for the current workflow state")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runStart(ctx);
      emit(result, ctx.json);
    });

  program
    .command("continue")
    .description("Show the next guided step for the current workflow state (equivalent to aiqt start)")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runContinue(ctx);
      emit(result, ctx.json);
    });

  program
    .command("prompt")
    .description("Generate a copy-paste prompt for an external coding agent")
    .argument("<kind>", "prompt kind: update, plan, checkpoint, driver, or interview")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--out <path>", "write the prompt to a file under .aiqt/inputs/ (update/plan/checkpoint only)")
    .option("--idea <idea>", "rough product idea (driver/interview only)")
    .option(
      "--extend",
      "plan kind only (M17-RC1): render append guidance, or refine guidance with --refine-work-unit, instead of initial planning",
      false,
    )
    .option(
      "--refine-work-unit <workUnitId>",
      "plan kind only (M17-RC1): the work unit to explain how to refine",
    )
    .option(
      "--replace-placeholder <workUnitId>",
      "[deprecated] alias for --refine-work-unit, kept for M17 backward compatibility",
    )
    .action((kind: string, raw: RawPromptOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPrompt(ctx, {
        kind,
        out: raw.out,
        idea: raw.idea,
        extend: raw.extend,
        refineWorkUnit: raw.refineWorkUnit,
        replacePlaceholder: raw.replacePlaceholder,
      });

      // No --out, human mode, success: print the raw prompt text so it is
      // directly copy-pasteable, matching aiqt next's packet bypass pattern.
      // M33-WU04 Sec 5.8: shared footer trails it, per next's packet above.
      if (!ctx.json && !raw.out && result.exitCode === ExitCode.Success) {
        const data = result.data as { prompt?: string } | undefined;
        if (typeof data?.prompt === "string") {
          process.stdout.write(data.prompt + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  program
    .command("manage")
    .description("Produce a read-only project manager report")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawManageOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runManage(ctx);

      // Human mode: print the dedicated multi-section manager report text
      // rather than the generic CommandResult summary, matching aiqt
      // next/aiqt prompt's raw-text bypass pattern.
      if (!ctx.json && result.exitCode === ExitCode.Success) {
        const data = result.data as
          | ({ projectName: string; roots: RootResolution } & ManageReport)
          | undefined;
        if (data) {
          const text = renderManageReportText({
            projectName: data.projectName,
            report: data,
            roots: data.roots,
            currentMilestoneId: result.currentMilestoneId,
            currentWorkUnitId: result.currentWorkUnitId,
          });
          // M33-WU04 Sec 5.8: shared footer trails the specialized report.
          process.stdout.write(text + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  const skillsCommand = program
    .command("skills")
    .description("Read-only integration skills planning (no installation, no network calls)");

  skillsCommand
    .command("plan")
    .description("Generate a deterministic integration skills bootstrap plan")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawSkillsPlanOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runSkillsPlan(ctx);

      // Human mode: print the dedicated skills plan report text, matching
      // aiqt manage/next/prompt's raw-text bypass pattern.
      if (!ctx.json && result.exitCode === ExitCode.Success) {
        const data = result.data as SkillsPlan | undefined;
        if (data) {
          // M33-WU04 Sec 5.8: shared footer trails the specialized report.
          process.stdout.write(renderSkillsPlanText(data) + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  program
    .command("import")
    .description("Import agent-generated JSON through the existing update/plan/checkpoint engine")
    .argument("<type>", "import type: update, plan, or checkpoint")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "path to the agent-generated JSON file")
    .option("--stdin", "read the agent-generated JSON from standard input", false)
    .option(
      "--extend",
      "plan import only (M17-RC1): extend an existing work graph -- append without a target, or refine with --refine-work-unit",
      false,
    )
    .option(
      "--refine-work-unit <workUnitId>",
      "plan import only (M17-RC1): the work unit to refine into a detailed replacement subgraph",
    )
    .option(
      "--replace-placeholder <workUnitId>",
      "[deprecated] alias for --refine-work-unit, kept for M17 backward compatibility",
    )
    .option(
      "--preview",
      "plan import only (M17): validate and report an --extend operation without persisting",
      false,
    )
    .action(async (type: string, raw: RawImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runImport(ctx, {
        importType: type,
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        extend: raw.extend,
        refineWorkUnit: raw.refineWorkUnit,
        replacePlaceholder: raw.replacePlaceholder,
        preview: raw.preview,
      });
      emit(result, ctx.json);
    });

  const issueCommand = program
    .command("issue")
    .description("Inspect and manage the M11 issue lifecycle (overrides, promotion)");

  issueCommand
    .command("list")
    .description("List normalized checkpoint/review issues with effective status")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawIssueListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runIssueList(ctx);

      if (!ctx.json && result.exitCode === ExitCode.Success) {
        const data = result.data as IssueListData | undefined;
        if (data) {
          // M33-WU04 Sec 5.8: shared footer trails the specialized report.
          process.stdout.write(renderIssueListText(data) + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  issueCommand
    .command("update <issueKey>")
    .description("Store a status override for a known issue without rewriting its source record")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--status <status>", "issue status: active, accepted, deferred, resolved, or post_mvp")
    .option("--reason <reason>", "reason for this status change")
    .action((issueKey: string, raw: RawIssueUpdateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runIssueUpdate(ctx, { issueKey, status: raw.status, reason: raw.reason });
      emit(result, ctx.json);
    });

  issueCommand
    .command("promote <issueKey>")
    .description("Promote a known issue into a canonical repair work unit")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--title <title>", "title for the new repair work unit")
    .option("--reason <reason>", "reason for promoting this issue")
    .option(
      "--validation-command <command>",
      "validation command for the repair work unit (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .action((issueKey: string, raw: RawIssuePromoteOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runIssuePromote(ctx, {
        issueKey,
        title: raw.title,
        reason: raw.reason,
        validationCommands: raw.validationCommand,
      });
      emit(result, ctx.json);
    });

  const repairCommand = program
    .command("repair")
    .description("Read-only repair planning derived from the current issue list");

  repairCommand
    .command("plan")
    .description("Recommend promotable issues for repair work")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawRepairPlanOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runRepairPlan(ctx);

      if (!ctx.json && result.exitCode === ExitCode.Success) {
        const data = result.data as RepairPlanData | undefined;
        if (data) {
          // M33-WU04 Sec 5.8: shared footer trails the specialized report.
          process.stdout.write(renderRepairPlanText(data) + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  const dependencyCommand = program
    .command("dependency")
    .description("Correct dependency type mistakes with cycle validation and readiness recalculation");

  dependencyCommand
    .command("update <dependencyId>")
    .description("Update the type of an existing dependency")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--type <type>", "dependency type: blocks, requires, or relates_to")
    .option("--reason <reason>", "reason for this dependency type change")
    .action((dependencyId: string, raw: RawDependencyUpdateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runDependencyUpdate(ctx, { dependencyId, type: raw.type, reason: raw.reason });
      emit(result, ctx.json);
    });

  const graphCommand = program
    .command("graph")
    .description("Graph validation, and dry-run or apply deterministic graph repair");

  graphCommand
    .command("validate")
    .description(
      "Validate work graph structure, cycles, and readiness semantics (M18: reports stale-ready work units -- canonically ready but blocked by an unsatisfied dependency -- as a non-blocking warning)",
    )
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawGraphValidateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runGraphValidate(ctx);
      emit(result, ctx.json);
    });

  graphCommand
    .command("repair")
    .description("Propose or apply deterministic graph repairs (--dry-run or --apply, required)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--dry-run", "propose repairs without mutating state", false)
    .option("--apply", "M18: atomically apply deterministic stale-readiness repairs (ready -> planned)", false)
    .action((raw: RawGraphRepairOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runGraphRepair(ctx, { dryRun: Boolean(raw.dryRun), apply: Boolean(raw.apply) });
      emit(result, ctx.json);
    });

  const evidenceCommand = program
    .command("evidence")
    .description("Import external evidence from a controlled static-format JSON boundary (M23)");

  evidenceCommand
    .command("import")
    .description(
      "Import one generic-evidence-json@1, generic-ci-json@1, or manual-evidence-json@1 payload from a file or stdin",
    )
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "path to the external evidence JSON file")
    .option("--stdin", "read the external evidence JSON from standard input", false)
    .option("--preview", "validate and report the import plan without persisting", false)
    .action(async (raw: RawEvidenceImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceImport(ctx, {
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  const evidenceGateCommand = evidenceCommand
    .command("gate")
    .description("Evidence gate policy management and read-only simulation (M28). Never enforces, blocks, or creates findings.");

  const evidenceGatePolicyCommand = evidenceGateCommand
    .command("policy")
    .description("Manage bounded, versioned evidence gate policies");

  evidenceGatePolicyCommand
    .command("import")
    .description("Import one bounded evidence gate policy version from a file or stdin")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "path to the evidence gate policy JSON file")
    .option("--stdin", "read the evidence gate policy JSON from standard input", false)
    .option("--preview", "validate and report the import plan without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time")
    .action(async (raw: RawEvidenceGatePolicyImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGatePolicyImport(ctx, {
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  evidenceGatePolicyCommand
    .command("list")
    .description("Read-only listing of imported evidence gate policies")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawEvidenceGatePolicyListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGatePolicyList(ctx);
      emit(result, ctx.json);
    });

  evidenceGatePolicyCommand
    .command("show <policy-id>")
    .description("Read-only inspection of one evidence gate policy version (latest by default)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--version <n>", "show this specific policy version")
    .action((policyId: string, raw: RawEvidenceGatePolicyShowOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGatePolicyShow(ctx, { policyId, version: raw.version !== undefined ? Number(raw.version) : undefined });
      emit(result, ctx.json);
    });

  evidenceGatePolicyCommand
    .command("activate <policy-id>")
    .description("Activate one existing evidence gate policy version -- changes only the active-policy pointer; never evaluates or enforces")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--version <n>", "the policy version to activate")
    .option("--preview", "validate and report the activation plan without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time")
    .action(async (policyId: string, raw: RawEvidenceGatePolicyActivateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGatePolicyActivate(ctx, {
        policyId,
        version: raw.version !== undefined ? Number(raw.version) : undefined,
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  evidenceGateCommand
    .command("simulate")
    .description("Read-only evidence-gate simulation against a project, work unit, or checkpoint -- never enforces, blocks, or mutates state")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--project", "simulate against the current project", false)
    .option("--work-unit <id>", "simulate against this work unit")
    .option("--checkpoint <id>", "simulate against this checkpoint")
    .option("--policy <policy-id>", "use this policy instead of the active one")
    .option("--version <n>", "use this specific policy version (requires --policy)")
    .option("--as-of <timestamp>", "ISO timestamp used as the effective evaluation time (defaults to the command's captured current time)")
    .option("--output <path>", "also write the full simulation report to this file")
    .action((raw: RawEvidenceGateSimulateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGateSimulate(ctx, {
        project: Boolean(raw.project),
        workUnitId: raw.workUnit,
        checkpointId: raw.checkpoint,
        policyId: raw.policy,
        policyVersion: raw.version !== undefined ? Number(raw.version) : undefined,
        asOf: raw.asOf,
        output: raw.output,
      });
      emit(result, ctx.json);
    });

  const evidenceGateAdvisoryCommand = evidenceGateCommand
    .command("advisory")
    .description("Advisory checkpoint evidence integration (M29): non-blocking visibility only, never enforcement");

  evidenceGateAdvisoryCommand
    .command("refresh")
    .description("Explicitly re-evaluate the advisory for one checkpoint against the active policy -- never changes checkpoint completion")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--checkpoint <id>", "the checkpoint to re-evaluate")
    .option("--as-of <timestamp>", "ISO timestamp used as the evaluation time (defaults to the command's captured current time)")
    .option("--preview", "evaluate and report without persisting", false)
    .action((raw: RawEvidenceGateAdvisoryRefreshOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGateAdvisoryRefresh(ctx, {
        checkpointId: raw.checkpoint,
        asOf: raw.asOf,
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  evidenceGateAdvisoryCommand
    .command("feedback <issue-key>")
    .description("Record explicit, bounded human feedback on one advisory issue for false-positive/friction measurement -- never changes issue lifecycle, severity, or readiness")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--classification <value>", "one of: confirmed, false_positive, policy_gap, evidence_missing")
    .option("--rationale <text>", "bounded, non-empty rationale text")
    .option("--preview", "validate and report without persisting", false)
    .action((issueKey: string, raw: RawEvidenceGateAdvisoryFeedbackOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGateAdvisoryFeedback(ctx, {
        issueKey,
        classification: raw.classification,
        rationale: raw.rationale,
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  const evidenceGateEnforcementCommand = evidenceGateCommand
    .command("enforcement")
    .description("Required evidence enforcement (M30): profiles, recovery proofs, activation plans. Import/preparation never activates enforcement.");

  const evidenceGateEnforcementProfileCommand = evidenceGateEnforcementCommand
    .command("profile")
    .description("Manage immutable, bounded evidence enforcement profiles");

  evidenceGateEnforcementProfileCommand
    .command("import")
    .description("Import one bounded evidence enforcement profile version from a file or stdin -- never activates enforcement")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "path to the enforcement profile JSON file")
    .option("--stdin", "read the enforcement profile JSON from standard input", false)
    .option("--preview", "validate and report the import plan without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time")
    .action(async (raw: RawEvidenceGateEnforcementProfileImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGateEnforcementProfileImport(ctx, {
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  evidenceGateEnforcementProfileCommand
    .command("list")
    .description("Read-only listing of imported evidence enforcement profiles")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGateEnforcementProfileList(ctx);
      emit(result, ctx.json);
    });

  evidenceGateEnforcementProfileCommand
    .command("show <profile-id>")
    .description("Read-only inspection of one evidence enforcement profile version (latest by default)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--version <n>", "show this specific profile version")
    .action((profileId: string, raw: RawEvidenceGateEnforcementProfileShowOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGateEnforcementProfileShow(ctx, { profileId, version: raw.version !== undefined ? Number(raw.version) : undefined });
      emit(result, ctx.json);
    });

  const evidenceGateEnforcementRecoveryCommand = evidenceGateEnforcementCommand
    .command("recovery")
    .description("Required-rule recovery proofs");

  evidenceGateEnforcementRecoveryCommand
    .command("import")
    .description("Import a required-rule recovery proof from before/after M28 simulation reports -- never persists the raw reports")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--profile <profile-id>", "the enforcement profile this proof is for")
    .option("--version <n>", "the enforcement profile version")
    .option("--gate <gate>", "checkpoint | development-review | release-review")
    .option("--rule <rule-id>", "the policy rule this proof covers")
    .option("--before <path>", "path to the before (fail/indeterminate) M28 simulation report")
    .option("--after <path>", "path to the after (pass) M28 simulation report")
    .option("--recovery-kind <kind>", "evidence_import | checkpoint_amendment | evidence_replacement | scoped_exception")
    .option("--preview", "validate and report without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time")
    .action(async (raw: RawEvidenceGateEnforcementRecoveryImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGateEnforcementRecoveryImport(ctx, {
        profileId: raw.profile,
        version: raw.version !== undefined ? Number(raw.version) : undefined,
        gate: raw.gate,
        ruleId: raw.rule,
        beforeFile: raw.before,
        afterFile: raw.after,
        recoveryKind: raw.recoveryKind,
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  const evidenceGateEnforcementActivationCommand = evidenceGateEnforcementCommand
    .command("activation")
    .description("Required-mode activation lifecycle -- prepare never activates; activation is explicit and human-authored");

  evidenceGateEnforcementActivationCommand
    .command("prepare")
    .description("Compute a bounded, replay-safe activation plan (exact Gate K risk formula) -- never activates enforcement")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--profile <profile-id>", "the enforcement profile to prepare activation for")
    .option("--version <n>", "the enforcement profile version")
    .option("--preview", "compute and report without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time")
    .action(async (raw: RawEvidenceGateEnforcementActivationPrepareOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGateEnforcementActivationPrepare(ctx, {
        profileId: raw.profile,
        version: raw.version !== undefined ? Number(raw.version) : undefined,
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  evidenceGateEnforcementActivationCommand
    .command("activate")
    .description("Activate required mode -- requires a non-expired plan, zero blockers, risk <=5, and exact human confirmation")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--plan <plan-id>", "the activation plan to activate")
    .option("--activated-by <human-id>", "explicit human identity authorizing activation")
    .option("--reason <text>", "bounded, non-empty reason")
    .option("--confirm-required <project-id>", "must exactly match the current project id")
    .action(async (raw: RawEvidenceGateEnforcementActivationActivateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGateEnforcementActivationActivate(ctx, {
        planId: raw.plan,
        activatedBy: raw.activatedBy,
        reason: raw.reason,
        confirmRequired: raw.confirmRequired,
      });
      emit(result, ctx.json);
    });

  evidenceGateEnforcementActivationCommand
    .command("deactivate")
    .description("Deactivate required mode -- returns the project to advisory/off; never completes/amends/deletes anything")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--activation <activation-id>", "the activation to deactivate")
    .option("--deactivated-by <human-id>", "explicit human identity authorizing deactivation")
    .option("--reason <text>", "bounded, non-empty reason")
    .option("--confirm-deactivate <project-id>", "must exactly match the current project id")
    .action(async (raw: RawEvidenceGateEnforcementActivationDeactivateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGateEnforcementActivationDeactivate(ctx, {
        activationId: raw.activation,
        deactivatedBy: raw.deactivatedBy,
        reason: raw.reason,
        confirmDeactivate: raw.confirmDeactivate,
      });
      emit(result, ctx.json);
    });

  evidenceGateEnforcementCommand
    .command("status")
    .description("Read-only effective evidence mode (off | advisory | required) and active-activation summary")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGateEnforcementStatus(ctx);
      emit(result, ctx.json);
    });

  const evidenceGateExceptionCommand = evidenceGateCommand
    .command("exception")
    .description("Exact, governed, expiring scoped exceptions to required evidence (M30) -- never a generic force/skip/ignore-evidence bypass");

  evidenceGateExceptionCommand
    .command("create")
    .description("Create one exact scoped exception -- only for rules the active profile explicitly marks exception-eligible")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--activation <activation-id>", "the active activation this exception is scoped under")
    .option("--gate <gate>", "checkpoint | development-review | release-review")
    .option("--work-unit <id>", "required for checkpoint-gate exceptions; scopes the exception to one Work Unit")
    .option("--rules <rule-ids>", "comma-separated exception-eligible rule ids")
    .option("--authorized-by <human-id>", "explicit human identity authorizing the exception")
    .option("--reason <text>", "bounded, non-empty reason")
    .option("--expires-at <timestamp>", "ISO timestamp, at most 30 days out")
    .option("--confirm-exception <project-id>", "must exactly match the current project id")
    .option("--preview", "validate and report without persisting", false)
    .action(async (raw: RawEvidenceGateExceptionCreateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGateExceptionCreate(ctx, {
        activationId: raw.activation,
        gate: raw.gate,
        workUnitId: raw.workUnit,
        rules: raw.rules,
        authorizedBy: raw.authorizedBy,
        reason: raw.reason,
        expiresAt: raw.expiresAt,
        confirmException: raw.confirmException,
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  evidenceGateExceptionCommand
    .command("revoke <exception-id>")
    .description("Revoke an active scoped exception -- append-only audited; idempotent on an already-revoked exception")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--revoked-by <human-id>", "explicit human identity authorizing the revocation")
    .option("--reason <text>", "bounded, non-empty reason")
    .option("--preview", "validate and report without persisting", false)
    .action(async (exceptionId: string, raw: RawEvidenceGateExceptionRevokeOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runEvidenceGateExceptionRevoke(ctx, {
        exceptionId,
        revokedBy: raw.revokedBy,
        reason: raw.reason,
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  evidenceGateExceptionCommand
    .command("list")
    .description("Read-only listing of scoped exceptions")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runEvidenceGateExceptionList(ctx);
      emit(result, ctx.json);
    });

  const defectsCommand = program
    .command("defects")
    .description("Defect discovery, triage, and remediation queue (M42): bounded evidence -> deterministic defect -> resumable queue");

  defectsCommand
    .command("discover")
    .description("Bounded discovery from failed validation/checkpoint-issue evidence (plus one optional explicit human report); deterministic dedup by fingerprint")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--work-unit <id>", "bound discovery to one Work Unit's checkpoints")
    .option("--human-title <text>", "title of an explicit human-reported defect candidate")
    .option("--human-summary <text>", "summary of the human-reported defect candidate")
    .option("--human-evidence <locator>", "bounded evidence locator for the human-reported defect candidate")
    .option("--human-severity <severity>", "critical | high | medium | low | info (default: medium)")
    .option("--preview", "report what discovery would do without persisting", false)
    .action(async (raw: RawDefectsDiscoverOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runDefectsDiscover(ctx, {
        workUnitId: raw.workUnit,
        humanTitle: raw.humanTitle,
        humanSummary: raw.humanSummary,
        humanEvidence: raw.humanEvidence,
        humanSeverity: raw.humanSeverity,
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  defectsCommand
    .command("list")
    .description("Read-only listing of defect records, optionally filtered by --status")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--status <status>", "candidate | triaged | queued | in_progress | needs_human | deferred | resolved | reopened | invalid | duplicate")
    .action((raw: RawDefectsListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runDefectsList(ctx, { status: raw.status });
      emit(result, ctx.json);
    });

  defectsCommand
    .command("inspect <defectId>")
    .description("Read-only full record for one defect, including its triage decision when present")
    .option("--json", "emit machine-readable JSON output", false)
    .action((defectId: string, raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runDefectsInspect(ctx, defectId);
      emit(result, ctx.json);
    });

  defectsCommand
    .command("triage <defectId>")
    .description("Run deterministic triage on one defect and apply the resulting status transition(s)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--preview", "compute and report the triage decision without persisting", false)
    .action(async (defectId: string, raw: RawDefectsTriageOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runDefectsTriage(ctx, defectId, { preview: Boolean(raw.preview) });
      emit(result, ctx.json);
    });

  defectsCommand
    .command("queue")
    .description("Read-only, deterministically ordered view of the queue-eligible defects (queued | in_progress | needs_human)")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runDefectsQueue(ctx);
      emit(result, ctx.json);
    });

  defectsCommand
    .command("transition <defectId>")
    .description("Explicit human-driven status override (e.g. defer/invalidate/queue) -- validated against the same transition table triage uses")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--to <status>", "target DefectStatus")
    .option("--reason <text>", "bounded, non-empty reason")
    .option("--preview", "validate and report without persisting", false)
    .action(async (defectId: string, raw: RawDefectsTransitionOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runDefectsTransition(ctx, defectId, { to: raw.to, reason: raw.reason, preview: Boolean(raw.preview) });
      emit(result, ctx.json);
    });

  defectsCommand
    .command("remediate <defectId>")
    .description("Build a bounded remediation request and, when eligible, start remediation (queued -> in_progress); risk >=50 requires --approved-by")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--objective <text>", "bounded remediation objective")
    .option("--scope <paths>", "comma-separated in-scope file/area paths")
    .option("--out-of-scope <paths>", "comma-separated explicitly out-of-scope paths")
    .option("--acceptance <text>", "acceptance/reproduction contract this remediation must satisfy")
    .option("--approved-by <human-id>", "explicit human identity; required when remediation risk is 50 or higher")
    .option("--preview", "compute and report without persisting", false)
    .action(async (defectId: string, raw: RawDefectsRemediateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runDefectsRemediate(ctx, defectId, {
        objective: raw.objective,
        scope: raw.scope,
        outOfScope: raw.outOfScope,
        acceptance: raw.acceptance,
        approvedBy: raw.approvedBy,
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  defectsCommand
    .command("record-validation <defectId>")
    .description("Record remediation validation evidence; \"passed\" resolves the defect, \"failed\" returns it to the queue with evidence preserved")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--outcome <outcome>", "passed | failed")
    .option("--evidence <locator>", "bounded evidence locator for the validation result")
    .option("--note <text>", "optional bounded note")
    .option("--preview", "validate and report without persisting", false)
    .action(async (defectId: string, raw: RawDefectsRecordValidationOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runDefectsRecordValidation(ctx, defectId, {
        outcome: raw.outcome,
        evidence: raw.evidence,
        note: raw.note,
        preview: Boolean(raw.preview),
      });
      emit(result, ctx.json);
    });

  defectsCommand
    .command("intake-structural <findingKey>")
    .description("Explicit, freshness-bound intake of one M43 structural finding into the M42 defect lifecycle (M43); reuses M42 discovery/dedup, never authorizes remediation")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--preview", "validate and report without persisting", false)
    .action(async (findingKey: string, raw: { json?: boolean; preview?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runDefectsIntakeStructural(ctx, findingKey, { preview: Boolean(raw.preview) });
      emit(result, ctx.json);
    });

  const workspaceCommand = program
    .command("workspace")
    .description("Managed workspace provider adapters (M25): prepare/status/release/recover local Git workspaces");

  workspaceCommand
    .command("prepare <workUnitId>")
    .description("Prepare the managed workspace for a Work Unit (shared-repository@1 or git-worktree@1); does not start the Work Unit")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--preview", "validate and report the prepare plan without any mutation or side effect", false)
    .action((workUnitId: string, raw: RawWorkspacePrepareOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runWorkspacePrepare(ctx, { workUnitId, preview: Boolean(raw.preview) });
      emit(result, ctx.json);
    });

  workspaceCommand
    .command("status")
    .description("Read-only inspection of all managed workspaces, or one Work Unit's binding with --work-unit")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--work-unit <id>", "report only this Work Unit's managed workspace binding")
    .action((raw: RawWorkspaceStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runWorkspaceStatus(ctx, { workUnitId: raw.workUnit });
      emit(result, ctx.json);
    });

  workspaceCommand
    .command("release <workUnitId>")
    .description("Release a Work Unit's managed workspace binding; never force, never deletes a branch")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--preview", "validate and report the release plan without any mutation or side effect", false)
    .action((workUnitId: string, raw: RawWorkspaceReleaseOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runWorkspaceRelease(ctx, { workUnitId, preview: Boolean(raw.preview) });
      emit(result, ctx.json);
    });

  workspaceCommand
    .command("recover")
    .description("Inspect and (with --apply) resolve pending workspace operations left by an interrupted prepare/release")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--apply", "perform the deterministic recovery action instead of only previewing it", false)
    .action((raw: RawWorkspaceRecoverOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runWorkspaceRecover(ctx, { apply: Boolean(raw.apply) });
      emit(result, ctx.json);
    });

  const executionCommand = program
    .command("execution")
    .description("Long-running execution session protocol (M26): import provider-reported events, inspect status");

  executionCommand
    .command("import")
    .description("Import a bounded execution-protocol event envelope from a file or stdin")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "path to the execution-protocol envelope JSON file")
    .option("--stdin", "read the execution-protocol envelope JSON from standard input", false)
    .option("--preview", "validate and report the import plan without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time for all time-dependent validation")
    .option("--example", "print a sample execution-protocol envelope JSON and exit", false)
    .action(async (raw: RawExecutionImportOptions) => {
      // M33-WU03 Sec 5.11: standardized on the same reject-the-combination
      // policy already used by `plan --example`/`checkpoint --example`
      // (M33-WU01 Contradiction H) instead of silently ignoring --json.
      if (raw.example && raw.json) {
        const result = errorToResult(
          "execution",
          new AiqtError(
            "aiqt execution import --example cannot be combined with --json.",
            ExitCode.InvalidInput,
            {
              id: "EXECUTION-IMPORT-EXAMPLE-JSON-CONFLICT",
              severity: "critical",
              area: "input",
              message: "aiqt execution import --example cannot be combined with --json.",
              agentCanFix: false,
            },
          ),
        );
        emit(result, true);
        return;
      }
      if (raw.example) {
        process.stdout.write(JSON.stringify(EXAMPLE_EXECUTION_ENVELOPE, null, 2) + "\n");
        process.exitCode = ExitCode.Success;
        return;
      }
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runExecutionImport(ctx, {
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  executionCommand
    .command("stale")
    .description("Preview or apply stale-session detection (default: preview; --apply transitions eligible sessions to stale)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--preview", "explicitly request preview mode (the default)", false)
    .option("--apply", "transition every currently stale-eligible session", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time for stale-eligibility evaluation")
    .action((raw: RawExecutionStaleOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runExecutionStale(ctx, { apply: Boolean(raw.apply), asOf: raw.asOf });
      emit(result, ctx.json);
    });

  executionCommand
    .command("status")
    .description("Read-only inspection of execution sessions, or one session/work-unit with --session/--work-unit")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--session <id>", "report only this execution session's full detail")
    .option("--work-unit <id>", "report only this Work Unit's execution sessions")
    .action((raw: RawExecutionStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runExecutionStatus(ctx, { sessionId: raw.session, workUnitId: raw.workUnit });
      emit(result, ctx.json);
    });

  const externalCommand = executionCommand
    .command("external")
    .description("Agent-agnostic generic execution request/result contract (M27R). The recommended default -- works with any external coding agent, no native adapter required.");

  externalCommand
    .command("request")
    .description("Generate a vendor-neutral generic execution request bundle for the current work unit's packet, or --resume-session an existing execution session")
    .argument("<work-unit-id>", "the current work unit ID")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--resume-session <session-id>", "resume an existing non-terminal execution session instead of starting a new one")
    .option("--preview", "validate and report the request plan without persisting", false)
    .option("--output <dir>", "also write the generated request bundle (request.json, instructions.md, result.example.json, result.schema.json) to this directory")
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time for all time-dependent validation")
    .action(async (workUnitId: string, raw: RawExecutionExternalRequestOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runExecutionExternalRequest(ctx, {
        workUnitId,
        resumeSessionId: raw.resumeSession,
        preview: Boolean(raw.preview),
        output: raw.output,
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  externalCommand
    .command("import")
    .description("Import a generic aiqt-external-execution-result@1 document for a previously generated request, from a file or stdin")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--request <request-id>", "the adapter request ID this result belongs to")
    .option("--from-file <path>", "path to the captured generic result file")
    .option("--stdin", "read the generic result JSON from standard input", false)
    .option("--preview", "validate and report the import plan without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time for all time-dependent validation")
    .action(async (raw: RawExecutionExternalImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runExecutionExternalImport(ctx, {
        requestId: raw.request,
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  externalCommand
    .command("status")
    .description("Read-only inspection of generic-path adapter requests, or one session/request with --session/--request")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--session <session-id>", "report only this execution session's adapter requests")
    .option("--request <request-id>", "report only this adapter request")
    .action((raw: RawExecutionExternalStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runExecutionExternalStatus(ctx, { sessionId: raw.session, requestId: raw.request });
      emit(result, ctx.json);
    });

  externalCommand
    .command("example")
    .description("Print a sample generic execution request and exit")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      // M33-WU03 Sec 5.11: this option was previously a dead flag (the
      // action callback never read it) -- now rejects the combination,
      // matching plan/checkpoint/execution import's policy.
      if (raw.json) {
        const result = errorToResult(
          "execution",
          new AiqtError(
            "aiqt execution external example cannot be combined with --json.",
            ExitCode.InvalidInput,
            {
              id: "EXECUTION-EXTERNAL-EXAMPLE-JSON-CONFLICT",
              severity: "critical",
              area: "input",
              message: "aiqt execution external example cannot be combined with --json.",
              agentCanFix: false,
            },
          ),
        );
        emit(result, true);
        return;
      }
      process.stdout.write(JSON.stringify(EXAMPLE_EXTERNAL_REQUEST, null, 2) + "\n");
      process.exitCode = ExitCode.Success;
    });

  const adapterCommand = executionCommand
    .command("adapter")
    .description("Optional, data-only execution provider adapters (M27)");

  const claudeCodeCommand = adapterCommand
    .command("claude-code")
    .description("Claude Code non-interactive stream-json adapter (claude-code-stream-json@1). AIQT never installs, authenticates, or executes Claude Code.");

  claudeCodeCommand
    .command("request")
    .description("Generate a non-executed Claude Code request package for the current work unit's packet, or --resume-session an existing execution session")
    .argument("<work-unit-id>", "the current work unit ID")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--resume-session <session-id>", "resume an existing non-terminal execution session instead of starting a new one")
    .option("--preview", "validate and report the request plan without persisting", false)
    .option("--output <path>", "also write the generated request package to this file")
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time for all time-dependent validation")
    .action(async (workUnitId: string, raw: RawExecutionAdapterClaudeCodeRequestOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runExecutionAdapterClaudeCodeRequest(ctx, {
        workUnitId,
        resumeSessionId: raw.resumeSession,
        preview: Boolean(raw.preview),
        output: raw.output,
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  claudeCodeCommand
    .command("import")
    .description("Import bounded Claude Code stream-json output for a previously generated request, from a file or stdin")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--request <request-id>", "the adapter request ID this output belongs to")
    .option("--from-file <path>", "path to the captured stream-json output file")
    .option("--stdin", "read the stream-json output from standard input", false)
    .option("--preview", "validate and report the import plan without persisting", false)
    .option("--as-of <timestamp>", "ISO timestamp used as the effective current time for all time-dependent validation")
    .action(async (raw: RawExecutionAdapterClaudeCodeImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runExecutionAdapterClaudeCodeImport(ctx, {
        requestId: raw.request,
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        preview: Boolean(raw.preview),
        asOf: raw.asOf,
      });
      emit(result, ctx.json);
    });

  claudeCodeCommand
    .command("status")
    .description("Read-only inspection of Claude Code adapter requests, or one execution session's requests with --session")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--session <session-id>", "report only this execution session's adapter requests")
    .action((raw: RawExecutionAdapterClaudeCodeStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runExecutionAdapterClaudeCodeStatus(ctx, { sessionId: raw.session });
      emit(result, ctx.json);
    });

  claudeCodeCommand
    .command("example")
    .description("Print a sample Claude Code request package and exit")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      // M33-WU03 Sec 5.11: was a dead flag; now rejects the combination,
      // matching plan/checkpoint/execution import/execution external's
      // policy.
      if (raw.json) {
        const result = errorToResult(
          "execution",
          new AiqtError(
            "aiqt execution adapter claude-code example cannot be combined with --json.",
            ExitCode.InvalidInput,
            {
              id: "EXECUTION-ADAPTER-CLAUDE-CODE-EXAMPLE-JSON-CONFLICT",
              severity: "critical",
              area: "input",
              message: "aiqt execution adapter claude-code example cannot be combined with --json.",
              agentCanFix: false,
            },
          ),
        );
        emit(result, true);
        return;
      }
      process.stdout.write(JSON.stringify(EXAMPLE_CLAUDE_CODE_REQUEST, null, 2) + "\n");
      process.exitCode = ExitCode.Success;
    });

  // ---------------------------------------------------------------------
  // M37-WU01: aiqt autonomous ... (public CLI, configuration, and
  // simulation wiring for the M36 autonomous-run contract). No command
  // below invokes a coding model, creates a real worktree, or executes a
  // real repair command -- `aiqt autonomous run` operates in simulation
  // mode only in this Work Unit (see autonomous-run.command.ts).
  // ---------------------------------------------------------------------
  const autonomousCommand = program
    .command("autonomous")
    .description("Inspect, classify, approve, and (simulated-only) run one bounded autonomous maintenance task against a target repository (M37-WU01)");

  autonomousCommand
    .command("inspect")
    .description("Read-only preflight of a target repository (Git status, base-ref resolution) before classifying a candidate")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--repository <path>", "path to the target repository")
    .option("--base-ref <ref>", "the base ref the candidate would work from")
    .action((raw: RawAutonomousInspectOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runAutonomousInspect(ctx, { repository: raw.repository, baseRef: raw.baseRef });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("classify")
    .description("Validate and classify one candidate, creating a new autonomous run record")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load a JSON candidate input file")
    .option("--stdin", "read the JSON candidate input from standard input", false)
    .option("--issue-id <id>", "candidate issue id (direct-flags input)")
    .option("--source <source>", "candidate source: issue|review_finding|manual|operator (direct-flags input)")
    .option("--repository <path>", "path to the target repository (direct-flags input)")
    .option("--base-ref <ref>", "the base ref the candidate would work from (direct-flags input)")
    .option("--objective <text>", "the candidate's objective (direct-flags input)")
    .option("--acceptance-criterion <text>", "an acceptance criterion (repeatable, direct-flags input)", collectRepeatable, [] as string[])
    .option("--constraint <text>", "a constraint (repeatable, direct-flags input)", collectRepeatable, [] as string[])
    .option("--requested-permission <text>", "a requested elevated permission (repeatable, direct-flags input)", collectRepeatable, [] as string[])
    .option("--prohibited-area <tag>", "a prohibited-area tag this candidate touches (repeatable, operator-declared)", collectRepeatable, [] as string[])
    .option("--validation-available", "declare that a validation command is available for this candidate (fail-closed default: false)", false)
    .option("--targeted-validation-command <text>", "a real targeted validation command for a real run's completion, as a single \"cmd arg1 arg2\" string (repeatable, no quoting support)", collectRepeatable, [] as string[])
    .option("--authoritative-validation-command <text>", "a real authoritative validation command, same format (repeatable)", collectRepeatable, [] as string[])
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .action(async (raw: RawAutonomousClassifyOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runAutonomousClassify(ctx, {
        fromFile: raw.fromFile,
        stdin: Boolean(raw.stdin),
        issueId: raw.issueId,
        source: raw.source,
        repository: raw.repository,
        baseRef: raw.baseRef,
        objective: raw.objective,
        acceptanceCriterion: raw.acceptanceCriterion,
        constraint: raw.constraint,
        requestedPermission: raw.requestedPermission,
        prohibitedArea: raw.prohibitedArea,
        validationAvailable: Boolean(raw.validationAvailable),
        targetedValidationCommand: raw.targetedValidationCommand,
        authoritativeValidationCommand: raw.authoritativeValidationCommand,
        configPath: raw.config,
        evidenceDir: raw.evidenceDir,
      });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("approve")
    .description("Approve a run currently awaiting approval (interactive confirmation, or --yes non-interactively)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--run <runId>", "the run id to approve")
    .option("--yes", "approve non-interactively without a confirmation prompt", false)
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .action(async (raw: RawAutonomousApproveOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runAutonomousApprove(ctx, { run: raw.run, yes: Boolean(raw.yes), configPath: raw.config, evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("run")
    .description("Run a classified/approved candidate -- SIMULATION ONLY in this version: --simulate is required, no real coding agent is invoked")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--run <runId>", "the run id to run")
    .option("--simulate", "produce a simulated preview evidence packet (required; no real execution exists yet)", false)
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .action((raw: RawAutonomousRunOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runAutonomousRun(ctx, { run: raw.run, simulate: Boolean(raw.simulate), configPath: raw.config, evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("status")
    .description("Report lifecycle, candidate, classification, budgets, approval, and evidence availability for one run, or list all recorded runs")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--run <runId>", "report only this run (omit to list all recorded run ids)")
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .action((raw: RawAutonomousStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runAutonomousStatus(ctx, { run: raw.run, configPath: raw.config, evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("cancel")
    .description("Cancel a non-terminal run, recording an audit event")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--run <runId>", "the run id to cancel")
    .option("--reason <text>", "why this run is being cancelled")
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .action((raw: RawAutonomousCancelOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runAutonomousCancel(ctx, { run: raw.run, reason: raw.reason, configPath: raw.config, evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("result")
    .description("Return the current or terminal evidence packet for a run, wrapped in the M33 result contract (--patch/--pr-draft add integration handoff artifacts)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--run <runId>", "the run id to report")
    .option("--patch", "include a real, read-only unified diff patch between the run's base commit and its branch (requires the run to have reached real execution)", false)
    .option("--pr-draft", "include a generated PR title/body draft (pure text -- never opens, pushes, or contacts any Git host)", false)
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .action((raw: RawAutonomousResultOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runAutonomousResult(ctx, { run: raw.run, patch: Boolean(raw.patch), prDraft: Boolean(raw.prDraft), configPath: raw.config, evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("cleanup")
    .description("Remove a terminal run's own record (simulation-safe: no real worktree exists to remove in this version)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--run <runId>", "the run id to clean up")
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .action((raw: RawAutonomousCleanupOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runAutonomousCleanup(ctx, { run: raw.run, configPath: raw.config, evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  autonomousCommand
    .command("agent-import")
    .description("Import a coding-agent response for a run's pending agent request, then execute its proposed commands for real (M37-WU03: the only command that creates a real worktree)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--run <runId>", "the run id whose pending agent request this response answers")
    .option("--from-file <path>", "load the agent response from a JSON file")
    .option("--stdin", "read the agent response JSON from standard input", false)
    .option("--config <path>", "operator configuration file path (defaults to ./aiqt.autonomous.config.json if present)")
    .option("--evidence-dir <path>", "override the resolved evidence output directory")
    .option("--live", "execute the imported response's proposed commands inside a real sandbox instead of a bare worktree -- opt-in, requires liveExecutionEnabled in operator config (M38)", false)
    .action(async (raw: RawAutonomousAgentImportOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runAutonomousAgentImport(ctx, { run: raw.run, fromFile: raw.fromFile, stdin: Boolean(raw.stdin), configPath: raw.config, evidenceDir: raw.evidenceDir, live: Boolean(raw.live) });
      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M45-WU02: aiqt maintenance ... (background maintenance scheduling CLI
  // surface). schedule add/list/inspect/update/enable/disable/remove
  // mutate only scheduling state; none of them executes a maintenance
  // task as a side effect (that is `run-due`, WU45-03).
  // ---------------------------------------------------------------------
  const maintenanceCommand = program
    .command("maintenance")
    .description("Operator-controlled scheduling for bounded AIQT maintenance workflows (M45): timing intent only, never execution/approval authority");

  const maintenanceScheduleCommand = maintenanceCommand
    .command("schedule")
    .description("Create, inspect, and mutate persistent maintenance schedules");

  maintenanceScheduleCommand
    .command("add")
    .description("Create a new maintenance schedule (structural_review | defect_discovery | defect_remediation)")
    .option("--json", "emit machine-readable JSON output", false)
    .requiredOption("--task-kind <kind>", "structural_review | defect_discovery | defect_remediation")
    .requiredOption("--cadence <duration>", 'how often, e.g. "1h", "6h", "1d", "7d"')
    .option("--anchor-at <isoTimestamp>", "UTC cadence-alignment point (defaults to now)")
    .option("--max-automatic-risk <n>", "0-49: lower the existing automatic-approval risk ceiling for defect_remediation (never raises it)")
    .option("--disabled", "create the schedule disabled instead of enabled", false)
    .action((raw: RawMaintenanceScheduleAddOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceScheduleAdd(ctx, {
        taskKind: raw.taskKind,
        cadence: raw.cadence,
        anchorAt: raw.anchorAt,
        maxAutomaticRisk: raw.maxAutomaticRisk !== undefined ? Number(raw.maxAutomaticRisk) : undefined,
        disabled: Boolean(raw.disabled),
      });
      emit(result, ctx.json);
    });

  maintenanceScheduleCommand
    .command("list")
    .description("Read-only listing of all maintenance schedules")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawMaintenanceScheduleListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceScheduleList(ctx);
      emit(result, ctx.json);
    });

  maintenanceScheduleCommand
    .command("inspect <scheduleId>")
    .description("Read-only detail for one maintenance schedule")
    .option("--json", "emit machine-readable JSON output", false)
    .action((scheduleId: string, raw: RawMaintenanceScheduleListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceScheduleInspect(ctx, scheduleId);
      emit(result, ctx.json);
    });

  maintenanceScheduleCommand
    .command("update <scheduleId>")
    .description("Update a schedule's cadence and/or policy -- never mutates its enabled state or runs its task")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--cadence <duration>", 'new cadence, e.g. "1h", "6h", "1d", "7d"')
    .option("--max-automatic-risk <n>", "0-49, or omit this flag entirely to leave unchanged")
    .action((scheduleId: string, raw: RawMaintenanceScheduleUpdateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceScheduleUpdate(ctx, scheduleId, {
        cadence: raw.cadence,
        maxAutomaticRisk: raw.maxAutomaticRisk !== undefined ? Number(raw.maxAutomaticRisk) : undefined,
      });
      emit(result, ctx.json);
    });

  maintenanceScheduleCommand
    .command("enable <scheduleId>")
    .description("Enable a schedule for future due selection (never affects an already-active occurrence)")
    .option("--json", "emit machine-readable JSON output", false)
    .action((scheduleId: string, raw: RawMaintenanceScheduleListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceScheduleEnable(ctx, scheduleId);
      emit(result, ctx.json);
    });

  maintenanceScheduleCommand
    .command("disable <scheduleId>")
    .description("Disable a schedule so it is never selected as due (never kills an already-active occurrence)")
    .option("--json", "emit machine-readable JSON output", false)
    .action((scheduleId: string, raw: RawMaintenanceScheduleListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceScheduleDisable(ctx, scheduleId);
      emit(result, ctx.json);
    });

  maintenanceScheduleCommand
    .command("remove <scheduleId>")
    .description("Remove a schedule -- fails closed if it has an active occurrence; never erases runlog history")
    .option("--json", "emit machine-readable JSON output", false)
    .action((scheduleId: string, raw: RawMaintenanceScheduleListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceScheduleRemove(ctx, scheduleId);
      emit(result, ctx.json);
    });

  maintenanceCommand
    .command("status")
    .description("Read-only compact operator view: schedules, next due, active occurrence")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawMaintenanceStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceStatus(ctx);
      emit(result, ctx.json);
    });

  maintenanceCommand
    .command("history")
    .description("Read-only maintenance event history, derived from the runlog")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--schedule-id <id>", "bound history to one schedule")
    .option("--limit <n>", "maximum events to return (default 50)")
    .action((raw: RawMaintenanceHistoryOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceHistory(ctx, { scheduleId: raw.scheduleId, limit: raw.limit !== undefined ? Number(raw.limit) : undefined });
      emit(result, ctx.json);
    });

  maintenanceCommand
    .command("run-due")
    .description("Execute at most one due maintenance occurrence via typed dispatch -- never a shell command, never parallel (M45-WU03/WU04)")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawMaintenanceStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceRunDue(ctx);
      emit(result, ctx.json);
    });

  maintenanceCommand
    .command("cancel <occurrenceId>")
    .description("Cancel the current active maintenance occurrence -- bookkeeping only, no live process to signal")
    .option("--json", "emit machine-readable JSON output", false)
    .action((occurrenceId: string, raw: RawMaintenanceStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runMaintenanceCancel(ctx, occurrenceId);
      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M40-WU03: aiqt release ... (release governance CLI surface). No
  // command below ever creates or publishes a GitHub Release (WU40-04
  // scope) -- assess/validate are read-only, notes is pure rendering,
  // prepare/status only ever touch bounded local evidence.
  // ---------------------------------------------------------------------
  const releaseCommand = program
    .command("release")
    .description("Assess, validate, render notes for, and locally prepare a release candidate (M40) -- never publishes a GitHub Release");

  releaseCommand
    .command("assess")
    .description("Read-only evidence/risk assessment for a release candidate")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load the release candidate input JSON from a file")
    .option("--stdin", "read the release candidate input JSON from standard input", false)
    .action(async (raw: RawReleaseAssessOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runReleaseAssess(ctx, { fromFile: raw.fromFile, stdin: Boolean(raw.stdin) });
      emit(result, ctx.json);
    });

  releaseCommand
    .command("validate")
    .description("Read-only readiness/provenance gate for a release candidate (no risk scoring)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load the release candidate input JSON from a file")
    .option("--stdin", "read the release candidate input JSON from standard input", false)
    .action(async (raw: RawReleaseValidateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runReleaseValidate(ctx, { fromFile: raw.fromFile, stdin: Boolean(raw.stdin) });
      emit(result, ctx.json);
    });

  releaseCommand
    .command("notes")
    .description("Render deterministic release notes (risk/readiness/approval shown near the top) for a release candidate")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load the release candidate input JSON from a file")
    .option("--stdin", "read the release candidate input JSON from standard input", false)
    .action(async (raw: RawReleaseNotesOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runReleaseNotes(ctx, { fromFile: raw.fromFile, stdin: Boolean(raw.stdin) });

      if (!ctx.json && result.exitCode !== undefined) {
        const data = result.data as { notes?: string } | undefined;
        if (typeof data?.notes === "string") {
          process.stdout.write(data.notes + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  releaseCommand
    .command("prepare")
    .description("Produce bounded local release evidence/notes for a release candidate -- never publishes or contacts GitHub")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load the release candidate input JSON from a file")
    .option("--stdin", "read the release candidate input JSON from standard input", false)
    .option("--evidence-dir <path>", "override the local release-evidence output directory (defaults to ./.aiqt-release)")
    .action(async (raw: RawReleasePrepareOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runReleasePrepare(ctx, { fromFile: raw.fromFile, stdin: Boolean(raw.stdin), evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  releaseCommand
    .command("status")
    .description("Read current candidate/draft readiness from locally-prepared release evidence, without mutation")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--candidate <candidateId>", "report only this candidate (omit to list all locally-prepared candidate ids)")
    .option("--evidence-dir <path>", "override the local release-evidence output directory (defaults to ./.aiqt-release)")
    .action((raw: RawReleaseStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReleaseStatus(ctx, { candidate: raw.candidate, evidenceDir: raw.evidenceDir });
      emit(result, ctx.json);
    });

  releaseCommand
    .command("draft")
    .description("Create a GitHub release DRAFT for an integrity-checked candidate -- never publishes (M40-WU04)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--from-file <path>", "load the release candidate input JSON from a file")
    .option("--stdin", "read the release candidate input JSON from standard input", false)
    .option("--token-env <name>", "name of the environment variable holding the GitHub token (defaults to GITHUB_TOKEN)")
    .action(async (raw: RawReleaseDraftOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runReleaseDraft(ctx, { fromFile: raw.fromFile, stdin: Boolean(raw.stdin), tokenEnv: raw.tokenEnv });
      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M44-WU02: aiqt release history (bounded, read-only historical release-
  // target inventory -- repository-local Git evidence only).
  // ---------------------------------------------------------------------
  releaseCommand
    .command("history")
    .description("Read-only inventory of bounded, repository-local historical release targets (M44)")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawReleaseHistoryOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runReleaseHistory(ctx);
      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M44-WU03/WU04: aiqt release reconstruct <tag> (explicit-target, read-
  // only historical reconstruction -- maps into the existing M40 candidate/
  // readiness/risk/approval/notes flow, plus a bounded external existing-
  // release/draft lookup reusing M40's exact GitHub read adapter; never
  // publishes, drafts, or mutates).
  // ---------------------------------------------------------------------
  releaseCommand
    .command("reconstruct <tag>")
    .description("Explicit-target, read-only historical release reconstruction against the existing M40 release-governance flow (M44) -- never publishes")
    .option("--json", "emit machine-readable JSON output", false)
    .requiredOption("--repository <identity>", "repository identity to attribute the reconstructed candidate to")
    .option("--token-env <name>", "name of the environment variable holding the GitHub token for the bounded existing-release lookup (defaults to GITHUB_TOKEN)")
    .action(async (tag: string, raw: RawReleaseReconstructOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runReleaseReconstruct(ctx, { tag, repository: raw.repository, tokenEnv: raw.tokenEnv });
      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M41-WU03: aiqt validation ... (read-only test-impact selection
  // inspection). Reuses the exact same buildExecutionGuidanceForWorkUnit
  // `next`/`next --preview` already call -- never mutates workflow state.
  // ---------------------------------------------------------------------
  const validationCommand = program
    .command("validation")
    .description("Read-only test-impact validation selection for a Work Unit (M41) -- never mutates workflow state");

  validationCommand
    .command("select")
    .description("Compact recommended focused/impacted validation selection for a Work Unit")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--work-unit <workUnitId>", "the Work Unit id to compute the selection for")
    .action((raw: RawValidationSelectOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runValidationSelect(ctx, { workUnit: raw.workUnit });
      emit(result, ctx.json);
    });

  validationCommand
    .command("explain")
    .description("Richer per-target reasons and evidence gaps for a Work Unit's validation selection")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--work-unit <workUnitId>", "the Work Unit id to explain the selection for")
    .action((raw: RawValidationExplainOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runValidationExplain(ctx, { workUnit: raw.workUnit });

      if (!ctx.json) {
        const data = result.data as { explain?: string } | undefined;
        if (typeof data?.explain === "string") {
          process.stdout.write(data.explain + renderResultFooter(result) + "\n");
          process.exitCode = result.exitCode;
          return;
        }
      }

      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M46-WU02: aiqt portfolio ... (multi-repository portfolio registry).
  // Local-first, explicit registration only -- no filesystem crawling, no
  // remote discovery. Portfolio persistence is user-home-scoped, not tied
  // to the current working directory's own `.aiqt/` project.
  // ---------------------------------------------------------------------
  const portfolioCommand = program
    .command("portfolio")
    .description("Register and inspect multiple explicitly-registered AIQT-managed repositories (M46) -- aggregates existing evidence, never a second source of truth");

  portfolioCommand
    .command("create")
    .description("Create a new local portfolio manifest")
    .option("--json", "emit machine-readable JSON output", false)
    .requiredOption("--name <name>", "portfolio name")
    .action((raw: RawPortfolioCreateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPortfolioCreate(ctx, raw.name);
      emit(result, ctx.json);
    });

  portfolioCommand
    .command("list")
    .description("Read-only listing of all known portfolios")
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: RawPortfolioListOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPortfolioList(ctx);
      emit(result, ctx.json);
    });

  portfolioCommand
    .command("inspect <portfolio>")
    .description("Read-only registry metadata and explicit member references for one portfolio")
    .option("--json", "emit machine-readable JSON output", false)
    .action((portfolio: string, raw: RawPortfolioInspectOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPortfolioInspect(ctx, portfolio);
      emit(result, ctx.json);
    });

  portfolioCommand
    .command("add <portfolio> <repo>")
    .description("Explicitly register an AIQT-managed repository as a portfolio member (fails closed if <repo> has no .aiqt/project.json)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--alias <alias>", "human-readable alias for this member")
    .action((portfolio: string, repo: string, raw: RawPortfolioAddOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPortfolioAdd(ctx, portfolio, repo, { alias: raw.alias });
      emit(result, ctx.json);
    });

  portfolioCommand
    .command("remove <portfolio> <member>")
    .description("Remove a member from a portfolio -- portfolio membership only, never mutates the member repository")
    .option("--json", "emit machine-readable JSON output", false)
    .action((portfolio: string, member: string, raw: RawPortfolioRemoveOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPortfolioRemove(ctx, portfolio, member);
      emit(result, ctx.json);
    });

  portfolioCommand
    .command("status <portfolio>")
    .description("Load member state and return a compact deterministic portfolio snapshot -- never mutates a member repository")
    .option("--json", "emit machine-readable JSON output", false)
    .action((portfolio: string, raw: RawPortfolioStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPortfolioStatus(ctx, portfolio);
      emit(result, ctx.json);
    });

  portfolioCommand
    .command("check <portfolio>")
    .description("Aggregate defect/maintenance/blocker/human-input attention signals across a portfolio -- read-only, never creates remediation authority")
    .option("--json", "emit machine-readable JSON output", false)
    .action((portfolio: string, raw: RawPortfolioCheckOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPortfolioCheck(ctx, portfolio);
      emit(result, ctx.json);
    });

  // ---------------------------------------------------------------------
  // M47: aiqt pr ... (controlled Pull Request integration). Every remote
  // side effect is its own explicit subcommand -- nothing here ever runs
  // as a consequence of another workflow completing, and no subcommand
  // approves, merges, deploys, or publishes anything.
  // ---------------------------------------------------------------------
  const prCommand = program
    .command("pr")
    .description("Prepare, push, and open exactly one Pull Request for one AIQT-managed external repository (M47) -- never approves, merges, deploys, or releases");

  prCommand
    .command("prepare")
    .description("Read-only: bind an exact repository/remote/base/source/SHA into an integration plan and run the full preflight (writes nothing to the target repository)")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--repository <path>", "target repository root (defaults to the current directory)")
    .option("--remote <name>", "remote name (defaults to origin)")
    .requiredOption("--base <branch>", "base branch the Pull Request will target")
    .option("--source <branch>", "source branch to push (defaults to the currently checked-out branch)")
    .option("--title <title>", "Pull Request title (required unless --from-run is used)")
    .option("--body-file <path>", "file containing the Pull Request body")
    .option("--from-run <runId>", "reuse an M37 autonomous run's generated Pull Request draft as the title and body")
    .option("--evidence-dir <path>", "directory holding autonomous run records (for --from-run)")
    .option("--config-path <path>", "autonomous operator configuration file (for --from-run)")
    .option("--reviewer <login>", "explicitly request one reviewer (repeatable)", (value: string, previous: string[] = []) => [...previous, value])
    .option("--ready", "open a ready-for-review Pull Request instead of the default draft", false)
    .option("--require-protected-base", "refuse to create unless the base branch is verifiably protected", false)
    .option("--token-env <name>", "name of the environment variable holding the GitHub token (defaults to GITHUB_TOKEN)")
    .option("--portfolio <id>", "select the target repository from an M46 portfolio (requires --member)")
    .option("--member <id>", "portfolio member id identifying exactly one repository")
    .action(async (raw: RawPrPrepareOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runPrPrepare(ctx, {
        repository: raw.repository,
        remote: raw.remote,
        base: raw.base,
        source: raw.source,
        title: raw.title,
        bodyFile: raw.bodyFile,
        fromRun: raw.fromRun,
        evidenceDir: raw.evidenceDir,
        configPath: raw.configPath,
        reviewer: raw.reviewer,
        ready: raw.ready,
        requireProtectedBase: raw.requireProtectedBase,
        tokenEnv: raw.tokenEnv,
        portfolio: raw.portfolio,
        member: raw.member,
      });
      emit(result, ctx.json);
    });

  prCommand
    .command("inspect <integration-id>")
    .description("Read-only: show a persisted integration plan, its recorded remote side effects, and what it is currently permitted to do")
    .option("--json", "emit machine-readable JSON output", false)
    .action((integrationId: string, raw: RawPrInspectOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runPrInspect(ctx, integrationId);
      emit(result, ctx.json);
    });

  prCommand
    .command("push <integration-id>")
    .description("Push exactly the plan's bound commit to exactly its source branch -- non-force, single ref, verified by re-reading the remote afterwards")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--token-env <name>", "name of the environment variable holding the GitHub token (defaults to GITHUB_TOKEN)")
    .action(async (integrationId: string, raw: RawPrPushOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runPrPush(ctx, integrationId, { tokenEnv: raw.tokenEnv });
      emit(result, ctx.json);
    });

  prCommand
    .command("create <integration-id>")
    .description("Create or reconcile exactly one Pull Request for the plan (draft unless the plan recorded explicit ready intent) and request its explicit reviewers -- never approves or merges")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--token-env <name>", "name of the environment variable holding the GitHub token (defaults to GITHUB_TOKEN)")
    .action(async (integrationId: string, raw: RawPrCreateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runPrCreate(ctx, integrationId, { tokenEnv: raw.tokenEnv });
      emit(result, ctx.json);
    });

  prCommand
    .command("status <integration-id>")
    .description("Read-only: reconcile the plan against real remote state and report push/Pull-Request/reviewer outcomes -- never approves, merges, or publishes")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--token-env <name>", "name of the environment variable holding the GitHub token (defaults to GITHUB_TOKEN)")
    .action(async (integrationId: string, raw: RawPrStatusOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runPrStatus(ctx, integrationId, { tokenEnv: raw.tokenEnv });
      emit(result, ctx.json);
    });

  prCommand
    .command("validate <integration-id>")
    .description("Read-only: re-run every freshness, preflight, and policy gate and report whether push/create would be permitted -- writes nothing at all")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--token-env <name>", "name of the environment variable holding the GitHub token (defaults to GITHUB_TOKEN)")
    .action(async (integrationId: string, raw: RawPrValidateOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = await runPrValidate(ctx, integrationId, { tokenEnv: raw.tokenEnv });
      emit(result, ctx.json);
    });

  return program;
}
