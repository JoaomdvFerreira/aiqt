import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * M37 build spec Sec 8 Cross-Work-Unit Invariant 1: "AIQT never targets
 * its own repository." Detects the AIQT product's own repository by its
 * package.json's exact `name` field -- a simple, deterministic, testable
 * marker, deliberately not a comparison against `process.cwd()` or this
 * module's own install location (which would wrongly forbid running the
 * CLI FROM WITHIN the AIQT repository against some OTHER `--repository`
 * path, a legitimate and expected way to invoke it during this project's
 * own development). Every autonomous-run CLI command that accepts a
 * `--repository`/candidate `repository` path must call this before doing
 * anything else with that path.
 */
export function isAiqtOwnRepository(repositoryPath: string): boolean {
  const packageJsonPath = join(repositoryPath, "package.json");
  if (!existsSync(packageJsonPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
    return parsed.name === "aiqt";
  } catch {
    return false;
  }
}
