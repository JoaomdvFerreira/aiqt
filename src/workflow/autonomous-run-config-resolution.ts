import type { AutonomousOperatorConfig, AutonomousOperatorConfigPartial } from "../schema/autonomous-run-operator.schema.js";
import { ALWAYS_DENIED_COMMAND_CLASSES, DEFAULT_ALLOWED_COMMAND_CLASSES } from "../schema/autonomous-run.schema.js";

/**
 * M37-WU01 (build spec Sec "Operator configuration"; precedence: "CLI
 * flags -> project configuration -> environment variables -> safe
 * defaults"). Safe, conservative defaults -- deliberately tighter than
 * M36-WU01's own AutonomousBudgetsSchema max bounds; an operator who
 * wants looser limits must say so explicitly in a higher-precedence
 * layer, never get them by omission.
 */
export const SAFE_DEFAULT_OPERATOR_CONFIG: AutonomousOperatorConfig = {
  worktreeRoot: ".aiqt-autonomous/worktrees",
  defaultBudgets: {
    maxWallClockSeconds: 600,
    maxCommandCount: 20,
    maxRetryCount: 1,
    maxChangedFiles: 20,
    maxDiffLines: 500,
    maxValidationSeconds: 300,
  },
  allowedCommandClasses: [...DEFAULT_ALLOWED_COMMAND_CLASSES],
  networkPolicy: "denied",
  approvalPolicy: "always_required",
  evidenceOutputDir: ".aiqt-autonomous/evidence",
  cleanupPolicy: "always",
};

export interface AutonomousConfigResolutionInput {
  cliFlags: AutonomousOperatorConfigPartial;
  projectConfig: AutonomousOperatorConfigPartial | null;
  env: NodeJS.ProcessEnv;
}

function parseEnvLayer(env: NodeJS.ProcessEnv): AutonomousOperatorConfigPartial {
  const layer: AutonomousOperatorConfigPartial = {};
  if (env.AIQT_AUTONOMOUS_WORKTREE_ROOT) layer.worktreeRoot = env.AIQT_AUTONOMOUS_WORKTREE_ROOT;
  if (env.AIQT_AUTONOMOUS_EVIDENCE_DIR) layer.evidenceOutputDir = env.AIQT_AUTONOMOUS_EVIDENCE_DIR;
  if (env.AIQT_AUTONOMOUS_NETWORK_POLICY === "denied" || env.AIQT_AUTONOMOUS_NETWORK_POLICY === "explicitly_enabled") {
    layer.networkPolicy = env.AIQT_AUTONOMOUS_NETWORK_POLICY;
  }
  if (env.AIQT_AUTONOMOUS_APPROVAL_POLICY === "always_required" || env.AIQT_AUTONOMOUS_APPROVAL_POLICY === "required_for_elevated") {
    layer.approvalPolicy = env.AIQT_AUTONOMOUS_APPROVAL_POLICY;
  }
  if (env.AIQT_AUTONOMOUS_CLEANUP_POLICY === "always" || env.AIQT_AUTONOMOUS_CLEANUP_POLICY === "retain_on_failure") {
    layer.cleanupPolicy = env.AIQT_AUTONOMOUS_CLEANUP_POLICY;
  }
  return layer;
}

/**
 * Precedence, lowest to highest: safe defaults -> environment variables ->
 * project configuration file -> CLI flags (build spec's stated order,
 * "CLI flags -> project configuration -> environment variables -> safe
 * defaults", read as a priority list from highest to lowest -- CLI flags
 * win). Each layer only overrides the fields it actually sets (a partial
 * merge, never a full replace of an unset layer). `defaultBudgets` is
 * merged as a whole object per layer (not field-by-field) -- a layer that
 * sets budgets sets all of them, avoiding a partially-mixed budget from
 * two different sources.
 *
 * `allowedCommandClasses` is filtered against ALWAYS_DENIED_COMMAND_CLASSES
 * after every layer is merged, regardless of which layer supplied it --
 * no configuration layer, including an operator's own CLI flag, can ever
 * re-enable `destructive`/`privileged` (M36-WU01's fixed, no-override
 * always-denied classes).
 */
export function resolveAutonomousRunConfig(input: AutonomousConfigResolutionInput): AutonomousOperatorConfig {
  const envLayer = parseEnvLayer(input.env);
  const merged: AutonomousOperatorConfig = {
    ...SAFE_DEFAULT_OPERATOR_CONFIG,
    ...envLayer,
    ...(input.projectConfig ?? {}),
    ...input.cliFlags,
  };
  return {
    ...merged,
    allowedCommandClasses: merged.allowedCommandClasses.filter((c) => !ALWAYS_DENIED_COMMAND_CLASSES.has(c)),
  };
}
