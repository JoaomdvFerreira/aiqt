import type { AutonomousExecutionPolicy } from "../schema/autonomous-run.schema.js";
import { runAutonomousCommand, type AutonomousCommandRequest } from "../workspaces/autonomous-command-runner.js";

/**
 * M36-WU04 (build spec Sec 7 WU36-04 Scope: "targeted validation;
 * authoritative validation integration"; acceptance criterion: "no pass
 * without validation"). Runs each supplied command through WU36-03's
 * already-policy-enforced runAutonomousCommand -- this module adds no
 * new execution surface, only an aggregation/pass-fail decision on top
 * of the existing one.
 *
 * Two separate command lists, matching AutonomousEvidencePacketSchema's
 * `validation` shape exactly:
 * - `targetedCommands` -- required. A repair with no targeted validation
 *   at all can never report `targetedTestsPassed: true`; an empty list
 *   is treated as "not validated," not as vacuously passed.
 * - `authoritativeCommands` -- optional (the target repository may not
 *   have (or expose) an authoritative validation command at all; this
 *   is `null`, not `false`, when never attempted -- distinct from "was
 *   attempted and failed").
 */
export interface RunAutonomousValidationParams {
  worktreePath: string;
  policy: AutonomousExecutionPolicy;
  targetedCommands: AutonomousCommandRequest[];
  authoritativeCommands: AutonomousCommandRequest[];
  maxValidationSeconds: number;
}

export interface AutonomousValidationResult {
  targetedTestsPassed: boolean;
  authoritativeValidationPassed: boolean | null;
  durationSeconds: number;
  commandsExecuted: string[];
  blockedReason: string | null;
}

function runCommandSequence(
  commands: readonly AutonomousCommandRequest[],
  worktreePath: string,
  policy: AutonomousExecutionPolicy,
  commandsExecuted: string[],
): { allPassed: boolean; blockedReason: string | null } {
  if (commands.length === 0) return { allPassed: false, blockedReason: null };

  for (const command of commands) {
    const result = runAutonomousCommand(command, worktreePath, policy);
    if (result.status === "denied" || result.status === "out_of_boundary") {
      return { allPassed: false, blockedReason: result.reason };
    }
    if (result.status === "spawn_error") {
      return { allPassed: false, blockedReason: `Validation command failed to spawn: ${result.reason}` };
    }
    commandsExecuted.push(`${command.command} ${command.args.join(" ")}`.trim());
    if (result.exitCode !== 0) {
      return { allPassed: false, blockedReason: null };
    }
  }
  return { allPassed: true, blockedReason: null };
}

/**
 * "No pass without validation" is enforced by this function's own
 * return shape, not merely by convention: `targetedTestsPassed` can only
 * be `true` if `targetedCommands` was non-empty AND every command in it
 * exited 0. A future Work Unit's overall result-state decision (Sec
 * evidence-binding-service.ts) must never report `resultState: "passed"`
 * without checking this field is `true` first.
 */
export function runAutonomousValidation(params: RunAutonomousValidationParams): AutonomousValidationResult {
  const { worktreePath, policy, targetedCommands, authoritativeCommands } = params;
  const start = Date.now();
  const commandsExecuted: string[] = [];

  const targeted = runCommandSequence(targetedCommands, worktreePath, policy, commandsExecuted);

  let authoritativeValidationPassed: boolean | null = null;
  let blockedReason = targeted.blockedReason;
  if (targeted.allPassed && authoritativeCommands.length > 0) {
    const authoritative = runCommandSequence(authoritativeCommands, worktreePath, policy, commandsExecuted);
    authoritativeValidationPassed = authoritative.allPassed;
    blockedReason = blockedReason ?? authoritative.blockedReason;
  }

  return {
    targetedTestsPassed: targeted.allPassed,
    authoritativeValidationPassed,
    durationSeconds: (Date.now() - start) / 1000,
    commandsExecuted,
    blockedReason,
  };
}
