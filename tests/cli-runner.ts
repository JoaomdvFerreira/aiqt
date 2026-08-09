import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this file's own location. */
export const REPO_ROOT = join(here, "..");

/**
 * IH-04 (CI & Test Portfolio Rationalization): the single entry point every
 * real-CLI integration suite spawns.
 *
 * Until IH-04 each of the 28 CLI-spawning suites independently declared
 *
 *     const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
 *     const entry  = join(repoRoot, "src", "index.ts");
 *
 * and paid a **full TypeScript transform of the entire CLI source graph on
 * every single invocation**. Measured on this repository (5-run mean,
 * `aiqt --version`): 2882 ms per `tsx src/index.ts` spawn versus 1076 ms
 * per `node dist/index.js` spawn. With ~650 spawns across the suite that
 * one mechanism was 88.8% of all test execution time
 * (docs/infrastructure/.../ih01-baseline.md Sec 4.2-4.3) and the direct
 * cause of the load-induced timeout family in ih01-isolation-evidence.md.
 *
 * Pointing those suites at `dist/index.js` does not weaken what they
 * assert. They spawn a real process, pass real argv, and assert on real
 * exit codes, stdout/stderr and on-disk state exactly as before -- the only
 * change is *which* entry point runs, and `dist/index.js` is the artifact
 * `package.json#bin` actually ships. `tests/integration/built-binary-smoke.test.ts`
 * deliberately keeps spawning BOTH entry points and asserting they agree
 * (`--version`, `init --json` shape, parser-error exit code + blocking
 * issue id), so the tsx-source path remains covered and the equivalence
 * these suites now rely on is itself under test.
 *
 * Freshness is not assumed: `tests/global-setup.ts` rebuilds `dist/` before
 * any test runs whenever it is missing or older than the newest file under
 * `src/`, so a stale build can never silently be what gets tested.
 */
export const BUILT_CLI_ENTRY = join(REPO_ROOT, "dist", "index.js");
