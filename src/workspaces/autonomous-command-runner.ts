import { execFileSync } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import type { AutonomousExecutionPolicy } from "../schema/autonomous-run.schema.js";
import { decideCommand } from "../workflow/autonomous-run-command-policy.js";

/**
 * M36-WU03 (build spec Sec 7 WU36-03 Scope: "command-policy enforcement";
 * threat model Sec 3.7 "arbitrary shell execution" / Sec 3.8 "command
 * injection" / Sec 3.11 "worktree escape"). The one M36 module that
 * actually executes a command -- follows git-command-runner.ts's (M25)
 * established safety pattern exactly: structured `{command, args[]}`
 * input only, never a raw shell string; `shell: false` always; a fixed,
 * bounded timeout; bounded, truncated output. Every command is checked
 * against WU36-01's decideCommand() BEFORE execFileSync ever runs --
 * denied commands never reach the process-spawn call at all.
 */

const MAX_OUTPUT_BYTES = 1048576;
const DEFAULT_COMMAND_TIMEOUT_MS = 30000;

export interface AutonomousCommandRequest {
  command: string;
  args: readonly string[];
}

export type AutonomousCommandOutcome =
  | { status: "denied"; commandClass: string; reason: string }
  | { status: "out_of_boundary"; reason: string }
  | { status: "executed"; exitCode: number; stdout: string; stderr: string; durationMs: number }
  | { status: "spawn_error"; reason: string };

function sanitizeOutput(raw: string): string {
  return raw.slice(0, 4000);
}

/** True when `candidatePath` resolves inside `boundary` (never equal-or-outside) -- mirrors workspace-path-policy.ts's isStrictDescendant reasoning, applied here to a command's own cwd rather than a workspace root. */
function isWithinBoundary(candidatePath: string, boundary: string): boolean {
  const resolvedCandidate = resolve(candidatePath);
  const resolvedBoundary = resolve(boundary);
  if (resolvedCandidate === resolvedBoundary) return true;
  const rel = relative(resolvedBoundary, resolvedCandidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Classifies and, if permitted, executes exactly one command inside
 * `worktreePath`. `policy.filesystemBoundary` must equal or contain
 * `worktreePath` -- this function additionally verifies `worktreePath`
 * itself is within the policy's declared boundary before ever spawning
 * anything, closing the gap WU36-01's own threat model (Sec 3.11) noted
 * as unenforced ("a real runner must resolve every file-path-shaped
 * argument and check it against filesystemBoundary" -- this function is
 * that real runner, for the one path this Work Unit controls directly:
 * the command's own working directory).
 */
export function runAutonomousCommand(
  request: AutonomousCommandRequest,
  worktreePath: string,
  policy: AutonomousExecutionPolicy,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
): AutonomousCommandOutcome {
  if (!isWithinBoundary(worktreePath, policy.filesystemBoundary)) {
    return { status: "out_of_boundary", reason: `worktreePath "${worktreePath}" is outside policy.filesystemBoundary "${policy.filesystemBoundary}".` };
  }

  const commandLine = `${request.command} ${request.args.join(" ")}`.trim();
  const decision = decideCommand(commandLine, policy);
  if (!decision.allowed) {
    return { status: "denied", commandClass: decision.commandClass, reason: decision.reason };
  }

  const start = Date.now();
  try {
    const stdout = execFileSync(request.command, [...request.args], {
      cwd: worktreePath,
      shell: false,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return { status: "executed", exitCode: 0, stdout: sanitizeOutput(stdout), stderr: "", durationMs: Date.now() - start };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer; status?: number | null };
    if (typeof nodeErr.status === "number") {
      const stdout = typeof nodeErr.stdout === "string" ? nodeErr.stdout : (nodeErr.stdout?.toString("utf8") ?? "");
      const stderr = typeof nodeErr.stderr === "string" ? nodeErr.stderr : (nodeErr.stderr?.toString("utf8") ?? "");
      return {
        status: "executed",
        exitCode: nodeErr.status,
        stdout: sanitizeOutput(stdout),
        stderr: sanitizeOutput(stderr),
        durationMs: Date.now() - start,
      };
    }
    return { status: "spawn_error", reason: sanitizeOutput(nodeErr.message ?? "command failed to spawn") };
  }
}
