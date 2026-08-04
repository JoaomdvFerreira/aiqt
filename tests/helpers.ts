import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeContext } from "../src/cli/command-context.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, "fixtures");

/** Create an isolated temp directory for a test. Caller must clean up. */
export function makeTempDir(prefix = "aiqt-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Recursively copy a directory tree using synchronous primitives.
 * Avoids fs.cpSync, whose native threadpool call can hard-crash tinypool
 * worker threads on this Windows/Node runtime.
 */
function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyTree(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/** Copy a named fixture folder into a fresh temp dir and return its path. */
export function copyFixture(name: string): string {
  const dest = makeTempDir(`aiqt-${name}-`);
  copyTree(join(FIXTURES_DIR, name), dest);
  // Ensure the exports dir exists (git may drop empty dirs).
  mkdirSync(join(dest, ".aiqt", "exports"), { recursive: true });
  return dest;
}

export function contextFor(cwd: string, json = false) {
  return makeContext({ cwd, json });
}

/**
 * M35-WU03: shared Git-fixture-repository initializer, extracted from 5
 * files (git-command-runner.test.ts, workspace-cli.test.ts,
 * workspace-hardening.test.ts, workspace-service-prepare.test.ts,
 * workspace-service-release-recovery.test.ts) that each independently
 * repeated the identical init/config/commit sequence (build spec Sec 7,
 * WU35-03's "repeated Git setup -> shared helper" example). Runs the same
 * real `git` subprocess commands each caller previously ran inline --
 * this deduplicates the setup code, it does not change what git commands
 * execute or what state they leave behind. `core.autocrlf=false` is
 * always set (harmless for callers that didn't previously set it) to
 * avoid a Windows-specific CRLF-diff false positive on any caller that
 * later checks `git diff --quiet`.
 */
export function initGitFixtureRepo(dir: string, commitMessage = "initial"): string {
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", commitMessage], { cwd: dir });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
}
