import { mkdirSync, readdirSync } from "node:fs";
import { isFile } from "../core/filesystem/file-exists.js";
import { readJsonFile, FileReadError, JsonParseError } from "../core/filesystem/file-store.js";
import { writeJsonFile } from "../core/filesystem/safe-writer.js";
import { PortfolioManifestSchema, type PortfolioManifest } from "../schema/portfolio.schema.js";
import { assertCompatiblePortfolioVersion } from "./portfolio-versioning.js";
import { resolvePortfolioFilePath } from "./portfolio-home.js";

/**
 * M46-WU01: one portfolio manifest per file, named `<portfolioId>.json`
 * under the resolved portfolio home directory (build spec Sec 3). Mirrors
 * release-decision-store.ts's split (mkdirSync before write, readdirSync
 * for discovery, fail-safe-not-fail-loud listing) rather than introducing a
 * new persistence pattern.
 */

const PORTFOLIO_LABEL = "portfolio manifest";

export function writePortfolioManifest(portfolioHome: string, manifest: PortfolioManifest): string {
  assertCompatiblePortfolioVersion(manifest.schemaVersion, PORTFOLIO_LABEL);
  mkdirSync(portfolioHome, { recursive: true });
  const path = resolvePortfolioFilePath(portfolioHome, manifest.id);
  writeJsonFile(path, manifest);
  return path;
}

export type ReadPortfolioManifestResult =
  | { ok: true; manifest: PortfolioManifest; path: string }
  | { ok: false; reason: string; path: string };

export function readPortfolioManifest(portfolioHome: string, portfolioId: string): ReadPortfolioManifestResult {
  const path = resolvePortfolioFilePath(portfolioHome, portfolioId);
  if (!isFile(path)) {
    return { ok: false, reason: `Portfolio "${portfolioId}" does not exist.`, path };
  }

  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      return { ok: false, reason: `Unable to read portfolio "${portfolioId}": ${err.message}`, path };
    }
    throw err;
  }

  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  try {
    assertCompatiblePortfolioVersion(version, PORTFOLIO_LABEL);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), path };
  }

  const parsed = PortfolioManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid ${PORTFOLIO_LABEL} at ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`;
    return { ok: false, reason: message, path };
  }

  return { ok: true, manifest: parsed.data, path };
}

/**
 * Deterministic discovery of every portfolio id under `portfolioHome`
 * (sorted ascending). A missing directory is an empty registry, not an
 * error -- the same "nothing registered yet" outcome as a freshly-created
 * one. Non-`.json` entries are ignored.
 */
export function listPortfolioIds(portfolioHome: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(portfolioHome);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith(".json"))
    .map((e) => e.slice(0, -".json".length))
    .sort();
}

export type PortfolioListEntry =
  | { ok: true; manifest: PortfolioManifest }
  | { ok: false; id: string; reason: string };

/**
 * Build spec dogfood scenario 17: a malformed portfolio manifest fails
 * safely -- reading every registered id, but a single bad file becomes one
 * `{ ok: false }` entry rather than aborting the whole listing (Sec 2.4
 * "partial failure is first-class").
 */
export function listPortfolioManifests(portfolioHome: string): PortfolioListEntry[] {
  return listPortfolioIds(portfolioHome).map((id) => {
    const result = readPortfolioManifest(portfolioHome, id);
    return result.ok ? { ok: true, manifest: result.manifest } : { ok: false, id, reason: result.reason };
  });
}
