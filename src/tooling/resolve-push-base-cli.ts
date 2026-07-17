#!/usr/bin/env node
import { resolveDirectPushBase } from "./push-base.js";
import { refExists } from "./git-utils.js";

/**
 * M19-RC1 §12: CI entrypoint invoked by .github/workflows/validate.yml for
 * a direct push to `main`. Prints `$GITHUB_OUTPUT`-format `key=value`
 * lines (action, base, reason) to stdout so the workflow step can redirect
 * them (`>> "$GITHUB_OUTPUT"`) and branch on `steps.<id>.outputs.action` in
 * the next step. Exits 0 for "compare" and "skip-initial" (both are
 * expected outcomes the workflow handles); exits 1 for
 * "error-unresolvable" so the job fails immediately and visibly rather
 * than silently skipping enforcement for an anomalous push event.
 */

function parseArgs(argv: readonly string[]): { before?: string; error?: string } {
  let before: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--before") {
      before = argv[i + 1] ?? "";
      i++;
    }
  }
  if (before === undefined) return { error: "--before <sha> is required (pass github.event.before, may be empty)." };
  return { before };
}

function main(): void {
  const { before, error } = parseArgs(process.argv.slice(2));
  if (error) {
    process.stderr.write(`resolve-push-base: ${error}\n`);
    process.exitCode = 1;
    return;
  }

  const resolution = resolveDirectPushBase(before, (sha) => refExists(sha, process.cwd()));

  process.stdout.write(`action=${resolution.action}\n`);
  if (resolution.base) process.stdout.write(`base=${resolution.base}\n`);
  process.stdout.write(`reason=${resolution.reason}\n`);

  if (resolution.action === "error-unresolvable") {
    process.stderr.write(`resolve-push-base: ${resolution.reason}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main();
