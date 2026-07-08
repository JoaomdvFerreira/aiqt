import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
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
