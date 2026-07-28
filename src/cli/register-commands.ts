import { Command } from "commander";
import { AIQT_PACKAGE_VERSION } from "../core/constants/package-version.js";
import { makeContext } from "./command-context.js";
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
import { runReviewAcknowledge } from "./commands/review-acknowledge.command.js";
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
import { runExecutionExternalRequest } from "./commands/execution-external-request.command.js";
import { runExecutionExternalImport } from "./commands/execution-external-import.command.js";
import { runExecutionExternalStatus } from "./commands/execution-external-status.command.js";
import { EXAMPLE_EXTERNAL_REQUEST } from "./commands/execution-external-example.js";
import { errorToResult } from "../core/output/result.js";
import { renderJson } from "../core/output/json-output.js";
import { renderHuman } from "../core/output/human-output.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { CommandResult } from "../core/output/result.js";

/** Emit a CommandResult and set the process exit code. */
function emit(result: CommandResult, json: boolean): void {
  const text = json ? renderJson(result) : renderHuman(result);
  if (result.exitCode === ExitCode.Success) {
    process.stdout.write(text + "\n");
  } else {
    process.stderr.write(text + "\n");
  }
  process.exitCode = result.exitCode;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("aiqt")
    .description("AIQT CLI - local workflow state engine")
    .version(AIQT_PACKAGE_VERSION)
    // M9: required so that a same-named option (e.g. --json) declared on
    // both a parent command (next, review) and its nested subcommand
    // (cancel, acknowledge) is parsed against the subcommand actually
    // invoked, not silently overwritten by the parent's default value.
    .enablePositionalOptions()
    // Unknown commands / bad input exit with code 3.
    .exitOverride((err) => {
      // commander throws for help/version (exit 0) and parse errors.
      const code =
        err.exitCode === 0 ? ExitCode.Success : ExitCode.InvalidInput;
      process.exitCode = code;
      throw err;
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
          process.stdout.write(renderParallelStatusText(data.parallelStatus) + "\n");
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
      // usual CommandResult summary wrapper.
      if (!ctx.json && !raw.preview && result.exitCode === ExitCode.Success) {
        const data = result.data as { packet?: string } | undefined;
        if (typeof data?.packet === "string") {
          process.stdout.write(data.packet + "\n");
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
      "validate and report an --extend operation (append or refine) without persisting or appending runlog events",
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
    .description("Amend the effective validation/acceptance result of an existing checkpoint")
    .option("--json", "emit machine-readable JSON output", false)
    .option("--checkpoint <checkpointId>", "the checkpoint id to amend")
    .option("--acceptance <result>", "effective acceptance result: passed, failed, partial, or not_checked")
    .option("--validation <result>", "effective validation result: passed, failed, partial, or not_run")
    .option("--reason <reason>", "reason for this amendment")
    .action((raw: RawCheckpointAmendOptions) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runCheckpointAmend(ctx, {
        checkpointId: raw.checkpoint,
        acceptance: raw.acceptance,
        validation: raw.validation,
        reason: raw.reason,
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
      if (!ctx.json && !raw.out && result.exitCode === ExitCode.Success) {
        const data = result.data as { prompt?: string } | undefined;
        if (typeof data?.prompt === "string") {
          process.stdout.write(data.prompt + "\n");
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
          process.stdout.write(text + "\n");
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
          process.stdout.write(renderSkillsPlanText(data) + "\n");
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
          process.stdout.write(renderIssueListText(data) + "\n");
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
          process.stdout.write(renderRepairPlanText(data) + "\n");
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
    .action(() => {
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
    .action(() => {
      process.stdout.write(JSON.stringify(EXAMPLE_CLAUDE_CODE_REQUEST, null, 2) + "\n");
      process.exitCode = ExitCode.Success;
    });

  return program;
}
