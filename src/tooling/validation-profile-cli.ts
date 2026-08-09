#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { classifyValidationProfile, type ValidationProfileDecision } from "./validation-profile.js";

/**
 * IH-05: emits `profile=<docs-only|full>` (plus `reason=`) in
 * GITHUB_OUTPUT's `key=value` form for `.github/workflows/validate.yml`'s
 * conditional test step.
 *
 * Fail-closed in every direction. `--base` missing, unresolvable, or a diff
 * that cannot be computed all produce `profile=full` on exit 0 -- the
 * workflow must not lose its test step because a classifier had a bad day,
 * and it must not lose its required check either. The only path to
 * `docs-only` is a successfully computed diff in which every single path is
 * documentation.
 */

function changedPaths(base: string, head: string): string[] {
  const mergeBase = execFileSync("git", ["merge-base", base, head], { encoding: "utf8" }).trim();
  const out = execFileSync("git", ["diff", "--name-only", `${mergeBase}..${head}`], {
    encoding: "utf8",
  });
  return out.split(/\r?\n/).filter((l) => l.trim() !== "");
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const withEquals = process.argv.find((a) => a.startsWith(prefix));
  if (withEquals) return withEquals.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function emit(decision: ValidationProfileDecision): void {
  process.stdout.write(`profile=${decision.profile}\n`);
  process.stdout.write(`reason=${decision.reason}\n`);
  process.stderr.write(
    `[validation-profile] ${decision.profile}: ${decision.reason}\n` +
      (decision.disqualifyingPaths.length > 0
        ? `[validation-profile] disqualifying paths: ${decision.disqualifyingPaths.slice(0, 20).join(", ")}\n`
        : ""),
  );
}

function main(): void {
  const base = arg("base");
  const head = arg("head") ?? "HEAD";
  if (!base || base.trim() === "" || /^0{40}$/.test(base.trim())) {
    emit({
      profile: "full",
      reason: "no usable comparison base -- falling back to full validation",
      changedPaths: [],
      disqualifyingPaths: [],
    });
    return;
  }
  let paths: string[];
  try {
    paths = changedPaths(base.trim(), head);
  } catch (error) {
    emit({
      profile: "full",
      reason: `changed paths could not be computed (${(error as Error).message.split("\n")[0]}) -- falling back to full validation`,
      changedPaths: [],
      disqualifyingPaths: [],
    });
    return;
  }
  emit(classifyValidationProfile(paths));
}

main();
