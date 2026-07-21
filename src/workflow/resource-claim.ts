import type { ResourceClaim, ResourceAccess } from "../schema/execution-metadata.schema.js";
import { validatePathClaimKey, resourceClaimIdentity } from "../schema/execution-metadata.schema.js";

/**
 * M24 §6.6: the standard access matrix -- read/read is compatible; any
 * combination touching write conflicts; exclusive conflicts with
 * everything, including itself.
 */
export function accessConflicts(a: ResourceAccess, b: ResourceAccess): boolean {
  if (a === "exclusive" || b === "exclusive") return true;
  if (a === "write" || b === "write") return true;
  return false;
}

/**
 * M24 §6.4: segment-aware path overlap. "src" overlaps "src/file.ts"
 * (one is a strict prefix of the other by whole segments); "src/a" does
 * not overlap "src-ab" (no shared prefix segment); "src/A" does not
 * overlap "src/a" (case-sensitive comparison). Inputs must already be
 * normalized (validatePathClaimKey's `normalized` output) -- this
 * function does no validation of its own.
 */
export function pathsOverlap(normalizedA: string, normalizedB: string): boolean {
  const segmentsA = normalizedA.split("/");
  const segmentsB = normalizedB.split("/");
  const [shorter, longer] = segmentsA.length <= segmentsB.length ? [segmentsA, segmentsB] : [segmentsB, segmentsA];
  return shorter.every((segment, index) => segment === longer[index]);
}

/**
 * M24 §6: full pairwise resource-claim conflict determination, reusing
 * the schema-owned domain-specific normalization (validatePathClaimKey/
 * resourceClaimIdentity) rather than re-deriving it. Different domains
 * never conflict. Within the `path` domain, conflict requires segment
 * overlap AND an access-matrix conflict; every other domain requires an
 * exact normalized-key match AND an access-matrix conflict. Malformed
 * claim keys (which should already have been rejected at the schema
 * layer) are treated as non-conflicting rather than thrown on, since this
 * function must never mutate state or throw -- it is a pure, read-only
 * evaluator.
 */
export function resourceClaimsConflict(a: ResourceClaim, b: ResourceClaim): boolean {
  if (a.domain !== b.domain) return false;

  if (a.domain === "path") {
    const normalizedA = validatePathClaimKey(a.key);
    const normalizedB = validatePathClaimKey(b.key);
    if (!normalizedA.ok || !normalizedB.ok || !normalizedA.normalized || !normalizedB.normalized) {
      return false;
    }
    if (!pathsOverlap(normalizedA.normalized, normalizedB.normalized)) return false;
    return accessConflicts(a.access, b.access);
  }

  if (resourceClaimIdentity(a) !== resourceClaimIdentity(b)) return false;
  return accessConflicts(a.access, b.access);
}

/**
 * M24 §9: true when any claim in `left` conflicts with any claim in
 * `right`. Used by the pairwise eligibility evaluator (WU24-04) as one
 * building block among several -- resource-claim conflict alone does not
 * determine overall eligibility.
 */
export function anyResourceClaimsConflict(
  left: readonly ResourceClaim[],
  right: readonly ResourceClaim[],
): boolean {
  for (const a of left) {
    for (const b of right) {
      if (resourceClaimsConflict(a, b)) return true;
    }
  }
  return false;
}
