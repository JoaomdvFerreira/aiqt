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
import type { IssueListData } from "./commands/issue-list.command.js";
import type { RepairPlanData } from "./commands/repair-plan.command.js";
import { runCheckpointAmend } from "./commands/checkpoint-amend.command.js";
import { runDependencyUpdate } from "./commands/dependency-update.command.js";
import { runGraphValidate } from "./commands/graph-validate.command.js";
import { runGraphRepair } from "./commands/graph-repair.command.js";
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
      "Inspect current AIQT state without modifying files (M18: reports canonical ready, effectively ready, and stale-ready work unit counts)",
    )
    .option("--json", "emit machine-readable JSON output", false)
    .action((raw: { json?: boolean }) => {
      const ctx = makeContext({ json: Boolean(raw.json) });
      const result = runStatus(ctx);
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

  return program;
}
