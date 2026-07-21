import { sha256Hex } from "../../core/util/hash.js";
import { canonicalTupleEncode } from "./canonical-json.js";

export type ImportIdentityMode = "external_id" | "content_addressed";

export interface ImportIdentityResult {
  importIdentityKey: string;
  mode: ImportIdentityMode;
}

export interface DeriveImportIdentityKeyParams {
  adapterId: string;
  providerId: string;
  externalId?: string | null;
  sourcePayloadDigest: string;
}

/** M23 §9: providerId normalization avoids duplicate identity keys arising purely from casing/whitespace differences in the same logical provider. */
function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase();
}

/**
 * M23 §9 Critical rule 1: `importIdentityKey` is owned exclusively by M23
 * and is never reused as an issue/transition/escalation/promotion/
 * repair-WU key. With an `externalId`, identity is scoped to
 * `[adapterId, normalizedProviderId, externalId]` (same scoped external ID
 * always resolves to the same key, regardless of payload content changes
 * -- conflict/no-op resolution against the stored digest happens
 * separately, in the caller). Without an `externalId`, identity falls back
 * to content-addressing via `[adapterId, normalizedProviderId,
 * sourcePayloadDigest]`, so a changed payload with no external ID always
 * mints a distinct identity rather than colliding with the prior one.
 */
export function deriveImportIdentityKey(params: DeriveImportIdentityKeyParams): ImportIdentityResult {
  const normalizedProviderId = normalizeProviderId(params.providerId);
  const trimmedExternalId = params.externalId?.trim();
  if (trimmedExternalId) {
    const tuple = canonicalTupleEncode([params.adapterId, normalizedProviderId, trimmedExternalId]);
    return { importIdentityKey: sha256Hex(tuple), mode: "external_id" };
  }
  const tuple = canonicalTupleEncode([params.adapterId, normalizedProviderId, params.sourcePayloadDigest]);
  return { importIdentityKey: sha256Hex(tuple), mode: "content_addressed" };
}
