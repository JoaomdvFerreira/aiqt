import { z } from "zod";
import { AutonomousBudgetsSchema, CommandClassSchema } from "./autonomous-run.schema.js";

/**
 * M37-WU01 (build spec Sec "Operator configuration"): the operator-facing
 * configuration contract for the public autonomous-run CLI -- worktree
 * root, default budgets, allowed command classes, network policy,
 * approval policy, evidence output directory, cleanup policy. Distinct
 * from AutonomousExecutionPolicy (M36-WU01, a per-run runtime policy) --
 * this schema is the operator's own standing preferences, resolved once
 * per invocation (CLI flags -> project config -> environment -> safe
 * defaults, src/workflow/autonomous-run-config-resolution.ts) and then
 * used to construct a per-run AutonomousExecutionPolicy/AutonomousBudgets.
 * No field here is secret-shaped by design (build spec: "do not expose
 * secrets in output") -- there is nothing in this schema a renderer would
 * ever need to redact.
 */
export const AutonomousApprovalPolicySchema = z.enum(["always_required", "required_for_elevated"]);
export type AutonomousApprovalPolicy = z.infer<typeof AutonomousApprovalPolicySchema>;

export const AutonomousCleanupPolicySchema = z.enum(["always", "retain_on_failure"]);
export type AutonomousCleanupPolicy = z.infer<typeof AutonomousCleanupPolicySchema>;

export const AutonomousOperatorConfigSchema = z
  .object({
    worktreeRoot: z.string().min(1),
    defaultBudgets: AutonomousBudgetsSchema,
    allowedCommandClasses: z.array(CommandClassSchema),
    networkPolicy: z.enum(["denied", "explicitly_enabled"]),
    approvalPolicy: AutonomousApprovalPolicySchema,
    evidenceOutputDir: z.string().min(1),
    cleanupPolicy: AutonomousCleanupPolicySchema,
    /**
     * M38-WU04 (build spec Sec 8 invariant 2 / cross-Work-Unit
     * invariant: "No live execution without capability confirmation";
     * Sec 9 verification gate: "live mode is opt-in"). `false` unless
     * an operator explicitly sets it -- `aiqt autonomous agent-import
     * --live` refuses outright when this is false, before ever
     * checking sandbox availability/capability. This is the
     * operator-level opt-in gate; capability preflight
     * (evaluateSandboxCapabilities) is the separate, always-enforced
     * technical gate underneath it -- opting in here never bypasses
     * that check.
     */
    liveExecutionEnabled: z.boolean(),
  })
  .strict();
export type AutonomousOperatorConfig = z.infer<typeof AutonomousOperatorConfigSchema>;

/** Any subset of fields -- each configuration layer (env/project-file/CLI flags) supplies only what it knows about. */
export const AutonomousOperatorConfigPartialSchema = AutonomousOperatorConfigSchema.partial();
export type AutonomousOperatorConfigPartial = z.infer<typeof AutonomousOperatorConfigPartialSchema>;
