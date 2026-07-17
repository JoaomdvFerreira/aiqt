import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseSemver,
  isNormalizedSemver,
  compareSemver,
  classifyIncrement,
  type VersionIncrement,
} from "./semver.js";
import { classifyChangedPaths } from "./relevant-paths.js";
import { resolveRef, mergeBase, changedPathsSince, readFileAtRevision, GitCommandError } from "./git-utils.js";

/**
 * M19: repository release-governance tool. Deliberately independent of the
 * AIQT product's own CommandResult/ExitCode machinery (workflow exit codes
 * 0/2/3/10) -- this is a repo-tooling command, not an AIQT workflow
 * command, and reuses none of that envelope's semantics.
 */

export type CheckMode = "local" | "comparison";

export interface VersionCheckChecks {
  semverValid: boolean;
  runtimeMatchesPackage: boolean;
  builtRuntimeMatchesPackage: boolean | null;
  lockfileMatchesPackage: boolean;
  monotonic: boolean | null;
  requiredBumpPresent: boolean | null;
}

export interface VersionCheckResult {
  status: "passed" | "failed";
  mode: CheckMode;
  baseRef: string | null;
  baseVersion: string | null;
  currentVersion: string | null;
  versionChanged: boolean | null;
  increment: VersionIncrement | null;
  relevantChangesDetected: boolean | null;
  relevantPaths: string[];
  ignoredPaths: string[];
  checks: VersionCheckChecks;
  errors: string[];
  exitCode: number;
}

export interface VersionSourceReadResult {
  version: string | null;
  error?: string;
}

export interface VersionCheckOptions {
  /** Repository working directory. Defaults to the current process cwd. */
  cwd: string;
  /** Explicit base git ref for comparison mode. Omit for local consistency mode. */
  base?: string;
  /**
   * Test-only overrides for the process-spawning runtime checks (M19
   * §22.2). Production callers never set these -- the real implementations
   * spawn `tsx`/`node` against this tool's own repository. Tests inject a
   * fake reader instead of spinning up a full fake repository just to
   * exercise the comparison/consistency logic.
   */
  devRuntimeVersionReader?: (cwd: string) => VersionSourceReadResult;
  builtRuntimeVersionReader?: (cwd: string) => VersionSourceReadResult | null;
}

function repoRootFromHere(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // This module compiles to dist/tooling/version-check.js (two levels
  // below dist/) or runs directly from src/tooling/ under tsx (two levels
  // below src/) -- the repository root is two levels up from either.
  return join(here, "..", "..");
}

function readPackageVersionFromWorkingTree(cwd: string): { version: string | null; error?: string } {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return { version: null, error: `package.json not found at ${path}.` };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    if (typeof parsed.version !== "string") {
      return { version: null, error: "package.json has no string \"version\" field." };
    }
    return { version: parsed.version };
  } catch (err) {
    return { version: null, error: `Unable to parse package.json: ${(err as Error).message}` };
  }
}

function readPackageVersionAtRevision(
  revision: string,
  cwd: string,
): { version: string | null; error?: string } {
  try {
    const raw = readFileAtRevision(revision, "package.json", cwd);
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version !== "string") {
      return { version: null, error: `package.json at ${revision} has no string "version" field.` };
    }
    return { version: parsed.version };
  } catch (err) {
    const message = err instanceof GitCommandError ? err.message : (err as Error).message;
    return { version: null, error: `Unable to read package.json at ${revision}: ${message}` };
  }
}

/** Spawn `node <cliEntry> --version` and return its trimmed stdout, or null with an error message on failure. */
function runCliVersion(cliEntryArgs: string[], cwd: string): { version: string | null; error?: string } {
  const result = spawnSync(process.execPath, cliEntryArgs, { cwd, encoding: "utf8", shell: false });
  if (result.error) return { version: null, error: result.error.message };
  if (result.status !== 0) {
    return { version: null, error: `exited with code ${result.status}: ${result.stderr.trim()}` };
  }
  return { version: result.stdout.trim() };
}

/** M19 §9.8: static scan for a hard-coded literal `.version("x.y.z")` in the CLI entrypoint that diverges from package.json. */
function checkNoHardcodedDrift(cwd: string, packageVersion: string): { ok: boolean; error?: string } {
  const path = join(cwd, "src", "cli", "register-commands.ts");
  if (!existsSync(path)) return { ok: true }; // nothing to scan is not a failure.
  const source = readFileSync(path, "utf8");
  const match = /\.version\(\s*"([^"]+)"\s*\)/.exec(source);
  if (!match) return { ok: true }; // no literal call -- expected, it should be a variable reference.
  if (match[1] !== packageVersion) {
    return {
      ok: false,
      error: `src/cli/register-commands.ts calls .version("${match[1]}") as a hard-coded literal, which diverges from package.json's "${packageVersion}".`,
    };
  }
  return { ok: false, error: `src/cli/register-commands.ts still hard-codes .version("${match[1]}") instead of deriving it from package.json.` };
}

/**
 * M19 §9.7/§5: pnpm-lock.yaml root package version metadata, when present.
 * No pnpm lockfile format in current use by this repository (lockfileVersion
 * 5.4's flat `dependencies:`/`devDependencies:` blocks, or the newer
 * `importers:` layout) actually records the root package's *own* version --
 * only its dependencies' versions. This check looks specifically for a
 * `version:` line that is a direct sibling of the `.` importer's
 * `dependencies:`/`devDependencies:` keys (not nested inside them, which
 * would be a dependency's own version and must never be confused with the
 * root package's version). Absence of such a field is "not applicable", not
 * a failure -- line-based parsing is used deliberately instead of a
 * multi-line regex, which previously matched the wrong nested field.
 */
function checkLockfileVersion(cwd: string, packageVersion: string): { ok: boolean; error?: string } {
  const path = join(cwd, "pnpm-lock.yaml");
  if (!existsSync(path)) return { ok: true };
  const lines = readFileSync(path, "utf8").split(/\r?\n/);

  const importersIndex = lines.findIndex((line) => /^importers:\s*$/.test(line));
  if (importersIndex === -1) return { ok: true };
  const rootImporterIndex = lines
    .slice(importersIndex + 1)
    .findIndex((line) => /^\s{2}\.\s*:\s*$/.test(line));
  if (rootImporterIndex === -1) return { ok: true };
  const rootStart = importersIndex + 1 + rootImporterIndex;

  // The root importer's own direct children are indented exactly 4 spaces
  // (one level deeper than the 2-space `.  :` key itself). Stop scanning at
  // the first line indented 2 spaces or less after rootStart (the next
  // importer, or the end of the importers block).
  for (let i = rootStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{0,2}\S/.test(line)) break; // dedented past the root importer block.
    const directChildMatch = /^\s{4}version:\s*(\S+)\s*$/.exec(line);
    if (directChildMatch) {
      const lockfileVersion = directChildMatch[1];
      if (lockfileVersion !== packageVersion) {
        return {
          ok: false,
          error: `pnpm-lock.yaml root version "${lockfileVersion}" does not match package.json version "${packageVersion}".`,
        };
      }
      return { ok: true };
    }
  }
  return { ok: true };
}

export function runVersionCheck(options: VersionCheckOptions): VersionCheckResult {
  const cwd = options.cwd;
  const errors: string[] = [];
  const repoRoot = repoRootFromHere();
  const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const indexTs = join(repoRoot, "src", "index.ts");
  const builtIndex = join(cwd, "dist", "index.js");

  const currentRead = readPackageVersionFromWorkingTree(cwd);
  if (currentRead.error) errors.push(currentRead.error);
  const currentVersion = currentRead.version;

  const parsedCurrent = currentVersion ? parseSemver(currentVersion) : null;
  const semverValid = currentVersion !== null && parsedCurrent !== null && isNormalizedSemver(currentVersion);
  if (currentVersion !== null && !semverValid) {
    errors.push(`package.json version "${currentVersion}" is not valid, normalized SemVer.`);
  }

  // Structural failure: cannot proceed further without a valid current version.
  if (currentVersion === null || parsedCurrent === null || !semverValid) {
    return {
      status: "failed",
      mode: options.base ? "comparison" : "local",
      baseRef: options.base ?? null,
      baseVersion: null,
      currentVersion,
      versionChanged: null,
      increment: null,
      relevantChangesDetected: null,
      relevantPaths: [],
      ignoredPaths: [],
      checks: {
        semverValid: false,
        runtimeMatchesPackage: false,
        builtRuntimeMatchesPackage: null,
        lockfileMatchesPackage: false,
        monotonic: null,
        requiredBumpPresent: null,
      },
      errors,
      exitCode: 3,
    };
  }

  const devRun = options.devRuntimeVersionReader
    ? options.devRuntimeVersionReader(cwd)
    : runCliVersion([tsxCli, indexTs, "--version"], cwd);
  const runtimeMatchesPackage = devRun.version === currentVersion;
  if (devRun.error) errors.push(`Development CLI version check failed to run: ${devRun.error}`);
  else if (!runtimeMatchesPackage) {
    errors.push(`Development CLI reports "${devRun.version}", package.json declares "${currentVersion}".`);
  }

  let builtRuntimeMatchesPackage: boolean | null = null;
  const builtRun = options.builtRuntimeVersionReader
    ? options.builtRuntimeVersionReader(cwd)
    : existsSync(builtIndex)
      ? runCliVersion([builtIndex, "--version"], cwd)
      : null;
  if (builtRun !== null) {
    builtRuntimeMatchesPackage = builtRun.version === currentVersion;
    if (builtRun.error) errors.push(`Built CLI version check failed to run: ${builtRun.error}`);
    else if (!builtRuntimeMatchesPackage) {
      errors.push(`Built CLI reports "${builtRun.version}", package.json declares "${currentVersion}".`);
    }
  }

  const hardcodedCheck = checkNoHardcodedDrift(cwd, currentVersion);
  if (!hardcodedCheck.ok && hardcodedCheck.error) errors.push(hardcodedCheck.error);

  const lockfileCheck = checkLockfileVersion(cwd, currentVersion);
  if (!lockfileCheck.ok && lockfileCheck.error) errors.push(lockfileCheck.error);

  if (!options.base) {
    const checks: VersionCheckChecks = {
      semverValid,
      runtimeMatchesPackage,
      builtRuntimeMatchesPackage,
      lockfileMatchesPackage: lockfileCheck.ok,
      monotonic: null,
      requiredBumpPresent: null,
    };
    const passed =
      semverValid &&
      runtimeMatchesPackage &&
      builtRuntimeMatchesPackage !== false &&
      lockfileCheck.ok &&
      hardcodedCheck.ok;
    return {
      status: passed ? "passed" : "failed",
      mode: "local",
      baseRef: null,
      baseVersion: null,
      currentVersion,
      versionChanged: null,
      increment: null,
      relevantChangesDetected: null,
      relevantPaths: [],
      ignoredPaths: [],
      checks,
      errors,
      exitCode: passed ? 0 : 1,
    };
  }

  // Comparison mode.
  let baseSha: string;
  try {
    baseSha = resolveRef(options.base, cwd);
  } catch (err) {
    const message = err instanceof GitCommandError ? err.message : (err as Error).message;
    errors.push(`Unable to resolve base ref "${options.base}": ${message}`);
    return {
      status: "failed",
      mode: "comparison",
      baseRef: options.base,
      baseVersion: null,
      currentVersion,
      versionChanged: null,
      increment: null,
      relevantChangesDetected: null,
      relevantPaths: [],
      ignoredPaths: [],
      checks: {
        semverValid,
        runtimeMatchesPackage,
        builtRuntimeMatchesPackage,
        lockfileMatchesPackage: lockfileCheck.ok,
        monotonic: null,
        requiredBumpPresent: null,
      },
      errors,
      exitCode: 3,
    };
  }

  let mergeBaseSha: string;
  let changedPaths: string[];
  try {
    mergeBaseSha = mergeBase(baseSha, "HEAD", cwd);
    changedPaths = changedPathsSince(baseSha, "HEAD", cwd);
  } catch (err) {
    const message = err instanceof GitCommandError ? err.message : (err as Error).message;
    errors.push(`Git comparison could not be performed safely: ${message}`);
    return {
      status: "failed",
      mode: "comparison",
      baseRef: options.base,
      baseVersion: null,
      currentVersion,
      versionChanged: null,
      increment: null,
      relevantChangesDetected: null,
      relevantPaths: [],
      ignoredPaths: [],
      checks: {
        semverValid,
        runtimeMatchesPackage,
        builtRuntimeMatchesPackage,
        lockfileMatchesPackage: lockfileCheck.ok,
        monotonic: null,
        requiredBumpPresent: null,
      },
      errors,
      exitCode: 3,
    };
  }

  const baseVersionRead = readPackageVersionAtRevision(mergeBaseSha, cwd);
  if (baseVersionRead.error) errors.push(baseVersionRead.error);
  const baseVersion = baseVersionRead.version;
  const parsedBase = baseVersion ? parseSemver(baseVersion) : null;

  if (baseVersion === null || parsedBase === null) {
    return {
      status: "failed",
      mode: "comparison",
      baseRef: options.base,
      baseVersion,
      currentVersion,
      versionChanged: null,
      increment: null,
      relevantChangesDetected: null,
      relevantPaths: [],
      ignoredPaths: [],
      checks: {
        semverValid,
        runtimeMatchesPackage,
        builtRuntimeMatchesPackage,
        lockfileMatchesPackage: lockfileCheck.ok,
        monotonic: null,
        requiredBumpPresent: null,
      },
      errors,
      exitCode: 3,
    };
  }

  const classification = classifyChangedPaths(changedPaths);
  const cmp = compareSemver(parsedCurrent, parsedBase);
  const monotonic = cmp >= 0;
  const versionChanged = cmp !== 0;
  const increment = classifyIncrement(parsedBase, parsedCurrent);
  const requiredBumpPresent = classification.relevantChangesDetected ? versionChanged : true;

  if (!monotonic) {
    errors.push(`Current version "${currentVersion}" is not greater than or equal to base version "${baseVersion}".`);
  }
  if (classification.relevantChangesDetected && !versionChanged) {
    errors.push(
      `Relevant product changes were detected (${classification.relevantPaths.length} path(s)) but the version was not incremented from "${baseVersion}".`,
    );
  }

  const checks: VersionCheckChecks = {
    semverValid,
    runtimeMatchesPackage,
    builtRuntimeMatchesPackage,
    lockfileMatchesPackage: lockfileCheck.ok,
    monotonic,
    requiredBumpPresent,
  };
  const passed =
    semverValid &&
    runtimeMatchesPackage &&
    builtRuntimeMatchesPackage !== false &&
    lockfileCheck.ok &&
    hardcodedCheck.ok &&
    monotonic &&
    requiredBumpPresent;

  return {
    status: passed ? "passed" : "failed",
    mode: "comparison",
    baseRef: options.base,
    baseVersion,
    currentVersion,
    versionChanged,
    increment,
    relevantChangesDetected: classification.relevantChangesDetected,
    relevantPaths: classification.relevantPaths,
    ignoredPaths: classification.ignoredPaths,
    checks,
    errors,
    // monotonic failure and required-bump failure are both policy failures (exit 1);
    // everything that reaches this point already passed the structural gates above.
    exitCode: passed ? 0 : 1,
  };
}
