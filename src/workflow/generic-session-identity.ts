import { randomUUID } from "node:crypto";
import type { ExecutionSession } from "../schema/execution-session.schema.js";

/**
 * M27R §3.2/§7.1: every new generic and native-adapter M26 session uses
 * this fixed provider ID. Historical pre-M27R Claude sessions keep
 * `anthropic/claude-code` and are never migrated (§7.2).
 */
export const GENERIC_PROVIDER_ID = "external/agent" as const;

const GENERIC_SESSION_CLIENT_KEY_PATTERN = /^external\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M27R §3.2: AIQT is the sole generator of this value. Users and adapters
 * cannot supply or override it -- callers never accept a user-provided
 * sessionClientKey anywhere in the generic or Claude-adapter request
 * paths. `node:crypto.randomUUID` is a pure, synchronous, local
 * computation -- no network, process, or filesystem I/O.
 */
export function generateGenericSessionClientKey(): string {
  return `external/${randomUUID()}`;
}

export function isGenericSessionClientKey(key: string): boolean {
  return GENERIC_SESSION_CLIENT_KEY_PATTERN.test(key);
}

/**
 * M27R §7.2: a session created before M27R (or, after M27R, still
 * provider-specific for any other reason) that must remain excluded from
 * cross-agent continuity -- reported as `legacy_provider_specific_session`
 * in bounded status/review metadata.
 */
export function isLegacyProviderSpecificSession(session: Pick<ExecutionSession, "provider">): boolean {
  return session.provider.providerId !== GENERIC_PROVIDER_ID;
}
