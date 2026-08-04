import type { AutonomousExecutionPolicy, CommandClass } from "../schema/autonomous-run.schema.js";
import { ALWAYS_DENIED_COMMAND_CLASSES } from "../schema/autonomous-run.schema.js";

/**
 * M36-WU01: pure command-string classification (build spec Sec 6.5).
 * This module never executes anything -- `git-command-runner.ts` (M25)
 * is this repository's own precedent for the actual execution-time
 * defense (`shell: false`, no generic passthrough, allowlisted
 * subcommands only), and a future Work Unit's real command runner for
 * autonomous execution must follow that same pattern, not reimplement
 * shell-safety from scratch. This module answers a narrower, earlier
 * question -- "which broad class does this command string belong to,
 * and does the current policy allow that class" -- so a candidate
 * command can be rejected before ever reaching a real runner.
 *
 * Classification is deliberately conservative: an unrecognized command
 * classifies as `privileged` (the most restrictive class, always
 * denied) rather than defaulting to something permissive. This is the
 * fail-closed principle applied to command classification specifically.
 */

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+.*--force\b/,
  /\bgit\s+push\s+.*-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-z]*f/,
  /\bgit\s+branch\s+-D\b/,
  /\bdrop\s+(table|database)\b/i,
  /\bformat\b.*\b(disk|drive|c:)\b/i,
  /\bmkfs\b/,
];

const PRIVILEGED_PATTERNS: RegExp[] = [
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bchown\b/,
  /\bsetenforce\b/,
  /\bsystemctl\b/,
  /\bregistry\b/i,
  /\bicacls\b/i,
];

const NETWORK_PATTERNS: RegExp[] = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bfetch\(/,
  /\bnc\s+/,
  /\bssh\b/,
  /\bscp\b/,
  /\bgit\s+(clone|fetch|pull|push)\b/,
  /\bnpm\s+(install|publish)\b/,
  /\bpnpm\s+(install|publish)\b/,
];

const GIT_READ_PATTERNS: RegExp[] = [
  /\bgit\s+(status|diff|log|show|rev-parse|branch|worktree\s+list)\b/,
];

const GIT_WRITE_PATTERNS: RegExp[] = [
  // M36-WU04: added `mv`/`rm` (plain, not `rm -rf`) -- both are ordinary
  // tracked-file repository-local writes, already caught before this
  // check by DESTRUCTIVE_PATTERNS if combined with `-rf` or `--force`,
  // and distinct from the unrestricted shell `rm` (which classifyCommand
  // never actually allows unqualified either -- `\brm\s+-rf\b` is the
  // only rm pattern DESTRUCTIVE_PATTERNS matches, so a bare `git rm
  // <path>`/`rm <path>` falls through to here, not to destructive).
  /\bgit\s+(add|commit|checkout|worktree\s+add|worktree\s+remove|switch|mv|rm)\b/,
];

const TEST_BUILD_PATTERNS: RegExp[] = [
  /\b(pnpm|npm|yarn)\s+(test|run\s+test|build|typecheck|lint)\b/,
  /\bvitest\b/,
  /\btsc\b/,
  /\beslint\b/,
];

const READ_ONLY_PATTERNS: RegExp[] = [/^\s*(ls|cat|head|tail|grep|find|pwd|echo)\b/, /^\s*(dir|type)\b/i];

/**
 * Order matters: destructive/privileged/network checks run first (a
 * command matching one of those patterns is that class regardless of
 * whether it also superficially resembles a read-only or git pattern --
 * e.g. `git push --force` must classify as destructive, not as the
 * generic git-operation class the plain GIT_WRITE_PATTERNS would give
 * it). Falls through to `privileged` (always denied) for anything
 * unrecognized.
 */
export function classifyCommand(commandLine: string): CommandClass {
  const trimmed = commandLine.trim();
  if (DESTRUCTIVE_PATTERNS.some((p) => p.test(trimmed))) return "destructive";
  if (PRIVILEGED_PATTERNS.some((p) => p.test(trimmed))) return "privileged";
  if (NETWORK_PATTERNS.some((p) => p.test(trimmed))) return "network";
  if (TEST_BUILD_PATTERNS.some((p) => p.test(trimmed))) return "test_or_build";
  if (GIT_WRITE_PATTERNS.some((p) => p.test(trimmed))) return "git_operation";
  if (GIT_READ_PATTERNS.some((p) => p.test(trimmed))) return "git_operation";
  if (READ_ONLY_PATTERNS.some((p) => p.test(trimmed))) return "read_only_inspection";
  if (trimmed.length === 0) return "privileged";
  return "privileged";
}

export interface CommandDecision {
  commandClass: CommandClass;
  allowed: boolean;
  reason: string;
}

/**
 * Decides whether one command string may run under a given policy.
 * `ALWAYS_DENIED_COMMAND_CLASSES` overrides any policy's own
 * `allowedCommandClasses` list -- there is no way to configure a policy
 * that permits `destructive` or `privileged`, matching the schema's own
 * comment that there is no override path for those two classes.
 */
export function decideCommand(commandLine: string, policy: AutonomousExecutionPolicy): CommandDecision {
  const commandClass = classifyCommand(commandLine);

  if (ALWAYS_DENIED_COMMAND_CLASSES.has(commandClass)) {
    return { commandClass, allowed: false, reason: `${commandClass} commands are always denied, regardless of policy.` };
  }
  if (policy.blockedCommandClasses.includes(commandClass)) {
    return { commandClass, allowed: false, reason: `${commandClass} is explicitly blocked by this run's policy.` };
  }
  if (commandClass === "network" && policy.networkPolicy !== "explicitly_enabled") {
    return { commandClass, allowed: false, reason: "network commands require networkPolicy: explicitly_enabled." };
  }
  if (!policy.allowedCommandClasses.includes(commandClass)) {
    return { commandClass, allowed: false, reason: `${commandClass} is not in this run's allowedCommandClasses.` };
  }
  return { commandClass, allowed: true, reason: `${commandClass} is permitted by this run's policy.` };
}
