import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * M18 §15: the CLI's own release version (`aiqt --version`), read once from
 * the canonical source (package.json) instead of an independently
 * maintained hard-coded literal. Distinct from AIQT_SCHEMA_VERSION (the
 * persisted .aiqt project-state schema version, in schema-version.ts),
 * which is versioned independently of CLI releases and unaffected by this.
 */
function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // This module compiles to dist/core/constants/package-version.js (three
  // levels below dist/) or runs directly from src/core/constants/ under
  // tsx (three levels below src/) -- package.json is three levels up from
  // either location, at the repository root.
  const packageJsonPath = join(here, "..", "..", "..", "package.json");
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}

export const AIQT_PACKAGE_VERSION = readPackageVersion();
