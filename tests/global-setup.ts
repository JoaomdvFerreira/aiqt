import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const builtEntry = join(repoRoot, "dist", "index.js");
const srcDir = join(repoRoot, "src");

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    const candidate = st.isDirectory() ? newestMtimeMs(full) : st.mtimeMs;
    if (candidate > newest) newest = candidate;
  }
  return newest;
}

/**
 * IH-04: guarantee `dist/index.js` exists and is not older than `src/`
 * before any test runs.
 *
 * The real-CLI integration spine spawns the built entry point
 * (`tests/cli-runner.ts`), and `tests/integration/built-binary-smoke.test.ts`
 * has always required a prior `pnpm build`. Making that requirement
 * implicit was survivable when only one file depended on it; with the spine
 * depending on it, a stale `dist/` would mean the suite quietly validating
 * yesterday's code. This closes that hole deterministically rather than
 * documenting it.
 *
 * Fail-closed: if freshness cannot be established for any reason -- missing
 * `dist/`, an unreadable `src/` tree, anything unexpected -- the build is
 * run rather than skipped. In CI the single `validate` job already runs
 * `pnpm build` immediately before `pnpm test`, so `dist/` is newer than
 * `src/` and this is a no-op mtime scan (single-digit milliseconds); it
 * only actually builds for a developer running a bare `pnpm test`.
 */
export default function setup(): void {
  let needsBuild = true;
  try {
    if (existsSync(builtEntry)) {
      needsBuild = statSync(builtEntry).mtimeMs < newestMtimeMs(srcDir);
    }
  } catch {
    needsBuild = true;
  }
  if (!needsBuild) return;

  process.stderr.write("[global-setup] dist/ missing or stale -- running tsc before the suite\n");
  execFileSync(process.execPath, [join(repoRoot, "node_modules", "typescript", "bin", "tsc")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
