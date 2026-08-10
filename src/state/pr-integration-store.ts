import { mkdirSync, readdirSync } from "node:fs";
import { isFile } from "../core/filesystem/file-exists.js";
import { readJsonFile, FileReadError, JsonParseError } from "../core/filesystem/file-store.js";
import { writeJsonFile } from "../core/filesystem/safe-writer.js";
import { PullRequestIntegrationPlanSchema, type PullRequestIntegrationPlan } from "../schema/pull-request-integration.schema.js";
import { assertCompatiblePrIntegrationVersion } from "./pr-integration-versioning.js";
import { resolvePrIntegrationFilePath } from "./pr-integration-home.js";
import { isValidPrIntegrationId } from "../workflow/pr-integration-identity.js";

/**
 * M47-WU01: one integration plan per file, `<integrationId>.json` under the
 * resolved integration home. Same discipline as portfolio-store.ts and
 * autonomous-run-store.ts: fixed id pattern checked before any path is
 * built (so an operator-supplied id can never traverse out of the home
 * directory), schema-validated reads, atomic writes via the shared
 * safe-writer, and fail-safe-not-fail-loud listing.
 *
 * A plan is the durable record of remote side effects, so reads are
 * fail-closed: an unreadable, malformed, or version-incompatible plan file
 * is an error the caller must surface, never an empty plan that would look
 * like "nothing has happened yet".
 */

const PLAN_LABEL = "PR integration plan";

export function writePrIntegrationPlan(integrationHome: string, plan: PullRequestIntegrationPlan): string {
  assertCompatiblePrIntegrationVersion(plan.schemaVersion, PLAN_LABEL);
  if (!isValidPrIntegrationId(plan.id)) {
    throw new Error(`"${plan.id}" is not a valid PR integration id.`);
  }
  mkdirSync(integrationHome, { recursive: true });
  const path = resolvePrIntegrationFilePath(integrationHome, plan.id);
  writeJsonFile(path, plan);
  return path;
}

export type ReadPrIntegrationPlanResult =
  | { ok: true; plan: PullRequestIntegrationPlan; path: string }
  | { ok: false; reason: string; path: string | null };

export function readPrIntegrationPlan(integrationHome: string, integrationId: string): ReadPrIntegrationPlanResult {
  if (!isValidPrIntegrationId(integrationId)) {
    return { ok: false, reason: `"${integrationId}" is not a valid PR integration id.`, path: null };
  }

  const path = resolvePrIntegrationFilePath(integrationHome, integrationId);
  if (!isFile(path)) {
    return { ok: false, reason: `PR integration "${integrationId}" does not exist.`, path };
  }

  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      return { ok: false, reason: `Unable to read PR integration "${integrationId}": ${err.message}`, path };
    }
    throw err;
  }

  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  try {
    assertCompatiblePrIntegrationVersion(version, PLAN_LABEL);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), path };
  }

  const parsed = PullRequestIntegrationPlanSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid ${PLAN_LABEL} at ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`;
    return { ok: false, reason: message, path };
  }

  // A plan file whose recorded id does not match the filename it was loaded
  // from cannot be trusted to be the plan the caller asked for.
  if (parsed.data.id !== integrationId) {
    return { ok: false, reason: `PR integration plan at ${path} declares id "${parsed.data.id}", which does not match the requested id "${integrationId}".`, path };
  }

  return { ok: true, plan: parsed.data, path };
}

/** Deterministic discovery of every plan id under `integrationHome` (sorted ascending). A missing directory is an empty registry, not an error. */
export function listPrIntegrationIds(integrationHome: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(integrationHome);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith(".json"))
    .map((e) => e.slice(0, -".json".length))
    .filter(isValidPrIntegrationId)
    .sort();
}
