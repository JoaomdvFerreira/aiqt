#!/usr/bin/env node
import { runVersionCheck, type VersionCheckResult } from "./version-check.js";

/**
 * M19 §8/§15/§16: the `pnpm version:check` entrypoint. A repository-tooling
 * command, not an AIQT workflow command -- its exit codes (0/1/3) are its
 * own contract, unrelated to AIQT's workflow ExitCode enum (0/2/3/10).
 */

interface ParsedArgs {
  base?: string;
  json: boolean;
  error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let base: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--base") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { json, error: "--base requires a value (a git ref)." };
      }
      base = value;
      i++;
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length);
      if (base === "") return { json, error: "--base requires a non-empty value." };
    } else {
      return { json, error: `Unknown argument "${arg}". Supported: --base <ref>, --json.` };
    }
  }
  return { base, json };
}

function renderHuman(result: VersionCheckResult): string {
  const lines: string[] = [];
  lines.push(`version:check (${result.mode}) -- ${result.status.toUpperCase()}`);
  lines.push(`  currentVersion: ${result.currentVersion ?? "(unreadable)"}`);
  if (result.mode === "comparison") {
    lines.push(`  baseRef: ${result.baseRef}`);
    lines.push(`  baseVersion: ${result.baseVersion ?? "(unreadable)"}`);
    lines.push(`  versionChanged: ${String(result.versionChanged)}`);
    lines.push(`  increment: ${result.increment ?? "(n/a)"}`);
    lines.push(`  relevantChangesDetected: ${String(result.relevantChangesDetected)}`);
    if (result.relevantPaths.length > 0) {
      lines.push(`  relevantPaths (${result.relevantPaths.length}):`);
      for (const p of result.relevantPaths) lines.push(`    - ${p}`);
    }
  }
  lines.push("  checks:");
  for (const [key, value] of Object.entries(result.checks)) {
    lines.push(`    ${key}: ${value === null ? "n/a" : String(value)}`);
  }
  if (result.errors.length > 0) {
    lines.push("  errors:");
    for (const e of result.errors) lines.push(`    - ${e}`);
  }
  return lines.join("\n");
}

function main(): void {
  const { base, json, error } = parseArgs(process.argv.slice(2));
  if (error) {
    if (json) {
      process.stdout.write(JSON.stringify({ status: "failed", errors: [error] }, null, 2) + "\n");
    } else {
      process.stderr.write(`version:check: ${error}\n`);
    }
    process.exitCode = 3;
    return;
  }

  let result: VersionCheckResult;
  try {
    result = runVersionCheck({ cwd: process.cwd(), base });
  } catch (err) {
    const message = (err as Error).message;
    if (json) {
      process.stdout.write(JSON.stringify({ status: "failed", errors: [message] }, null, 2) + "\n");
    } else {
      process.stderr.write(`version:check: unexpected failure: ${message}\n`);
    }
    process.exitCode = 3;
    return;
  }

  const text = json ? JSON.stringify(result, null, 2) : renderHuman(result);
  if (result.status === "passed") {
    process.stdout.write(text + "\n");
  } else {
    process.stderr.write(text + "\n");
  }
  process.exitCode = result.exitCode;
}

main();
