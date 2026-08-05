import { execFileSync } from "node:child_process";

/**
 * M38-WU02 (build spec: "Implement one real backend with enforceable
 * mounts, environment allowlist, network denial, resource controls,
 * isolated temp/output, and cleanup"). The single, real
 * `execFileSync("docker", ...)` call site for the entire M38 sandbox
 * backend -- structured args only, `shell: false`, bounded output
 * capture -- mirroring the exact discipline
 * `src/workspaces/autonomous-command-runner.ts` established at M36 for
 * `git`. No other file in `src/workspaces/sandbox-*` may call
 * `execFileSync`/`spawn`/`exec` directly; every real Docker invocation
 * goes through this one function, verified by the boundary scan.
 */
const MAX_CAPTURED_OUTPUT_CHARS = 8_000;

function bound(text: string): string {
  return text.length > MAX_CAPTURED_OUTPUT_CHARS ? `${text.slice(0, MAX_CAPTURED_OUTPUT_CHARS)}\n...[truncated]` : text;
}

export interface DockerCommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface DockerCommandOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Real, structured-args-only `docker <args>` invocation. Never builds a shell string; `args` is always a plain string array the caller constructed field-by-field. */
export function runDockerCommand(args: readonly string[], options: DockerCommandOptions = {}): DockerCommandResult {
  try {
    const stdout = execFileSync("docker", [...args], {
      encoding: "utf8",
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      shell: false,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, exitCode: 0, stdout: bound(stdout), stderr: "" };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      exitCode: typeof err.status === "number" ? err.status : null,
      stdout: bound(String(err.stdout ?? "")),
      stderr: bound(String(err.stderr ?? err.message ?? "")),
    };
  }
}
