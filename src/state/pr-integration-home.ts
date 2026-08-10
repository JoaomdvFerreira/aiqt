import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * M47-WU01: PR integration plans are persisted OUTSIDE every repository
 * they act on. A plan describes writes against a target repository; storing
 * it inside that repository would make the plan itself part of the tree
 * whose cleanliness the push gate checks, and would require AIQT to write
 * into a repository it is only supposed to push an already-prepared branch
 * from. It is equally never written into this repository (the AIQT
 * product), which must never gain a `.aiqt/` of its own -- build spec Sec
 * 19 "no AIQT self-management".
 *
 * Deliberately mirrors M46's portfolio-home.ts (user-level registry, single
 * env override for tests/operators) instead of inventing a third
 * persistence convention. There is no `.aiqt/pr.json` and no other parallel
 * state database anywhere in this milestone.
 */
export function resolvePrIntegrationHome(): string {
  const override = process.env.AIQT_PR_INTEGRATION_HOME;
  if (override && override.trim().length > 0) return resolve(override);
  return join(homedir(), ".aiqt", "pr-integrations");
}

export function resolvePrIntegrationFilePath(integrationHome: string, integrationId: string): string {
  return join(integrationHome, `${integrationId}.json`);
}
