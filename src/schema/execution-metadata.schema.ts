import { z } from "zod";

/**
 * M24 §15: state-growth limits, validated before mutation. Not increased
 * without review.
 */
export const ASSIGNMENT_KEY_MAX_CHARS = 128;
export const CONCURRENCY_GROUP_MAX_CHARS = 128;
export const RESOURCE_CLAIM_KEY_MAX_CHARS = 256;
export const RESOURCE_CLAIMS_PER_WORK_UNIT_MAX = 100;
export const SERIALIZED_EXECUTION_METADATA_MAX_BYTES = 16384;
export const ELIGIBILITY_REASONS_PER_PAIR_MAX = 32;
export const CONFLICTS_PER_PAIR_MAX = 100;
export const ADVISORY_BATCH_WORK_UNITS_MAX = 5000;

export const WorkspaceModeSchema = z.enum(["shared", "isolated", "none"]);
export type WorkspaceMode = z.infer<typeof WorkspaceModeSchema>;

export const WorkspaceAccessSchema = z.enum(["read_only", "read_write"]);
export type WorkspaceAccess = z.infer<typeof WorkspaceAccessSchema>;

export const ParallelModeSchema = z.enum(["serialized", "eligible_if_no_conflict", "manual_review"]);
export type ParallelMode = z.infer<typeof ParallelModeSchema>;

export const ResourceDomainSchema = z.enum([
  "repository",
  "path",
  "database",
  "environment",
  "external_system",
  "custom",
]);
export type ResourceDomain = z.infer<typeof ResourceDomainSchema>;

export const ResourceAccessSchema = z.enum(["read", "write", "exclusive"]);
export type ResourceAccess = z.infer<typeof ResourceAccessSchema>;

/**
 * M24 §4.3/§5.3: `assignmentKey` and `concurrencyGroup` share one
 * normalization rule -- a logical token, never a path or shell/URL/
 * env-var expression. The allowed-character whitelist alone is what
 * excludes drive-letter (`C:`), UNC (`\\`), URL (`scheme://`), and
 * environment-variable (`$FOO`, `${FOO}`) forms: none of `:`, `\`, `$`,
 * `{`, `}` are in the whitelist, so those forms fail the regex before any
 * special-casing is needed. Segment-level checks (leading/trailing/
 * repeated `/`, `.`/`..` segments) are checked separately since `.`/`-`/`_`
 * are otherwise legal characters.
 */
const ASSIGNMENT_TOKEN_PATTERN = /^[A-Za-z0-9._\-/]+$/;

export interface TokenValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateAssignmentToken(value: string, maxChars: number): TokenValidationResult {
  if (value.length < 1 || value.length > maxChars) {
    return { ok: false, reason: `must be 1..${maxChars} characters` };
  }
  if (!ASSIGNMENT_TOKEN_PATTERN.test(value)) {
    return {
      ok: false,
      reason: "must contain only ASCII letters, digits, '.', '_', '-', '/'",
    };
  }
  if (value.startsWith("/") || value.endsWith("/")) {
    return { ok: false, reason: "must not start or end with '/'" };
  }
  if (value.includes("//")) {
    return { ok: false, reason: "must not contain repeated '/'" };
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return { ok: false, reason: "must not contain '.' or '..' segments" };
  }
  return { ok: true };
}

export const WorkspaceAssignmentMetadataSchema = z
  .object({
    mode: WorkspaceModeSchema,
    assignmentKey: z.string().optional(),
    access: WorkspaceAccessSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "none") {
      if (value.assignmentKey !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "assignmentKey must not be set when mode is 'none'",
          path: ["assignmentKey"],
        });
      }
      if (value.access !== "read_only") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "access must be 'read_only' when mode is 'none'",
          path: ["access"],
        });
      }
      return;
    }
    if (value.assignmentKey === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assignmentKey is required when mode is 'shared' or 'isolated'",
        path: ["assignmentKey"],
      });
      return;
    }
    const result = validateAssignmentToken(value.assignmentKey, ASSIGNMENT_KEY_MAX_CHARS);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `assignmentKey invalid: ${result.reason}`,
        path: ["assignmentKey"],
      });
    }
  });
export type WorkspaceAssignmentMetadata = z.infer<typeof WorkspaceAssignmentMetadataSchema>;

export const ResourceClaimSchema = z
  .object({
    domain: ResourceDomainSchema,
    key: z.string().min(1).max(RESOURCE_CLAIM_KEY_MAX_CHARS),
    access: ResourceAccessSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const result = validateResourceClaimKey(value.domain, value.key);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `resource claim key invalid for domain '${value.domain}': ${result.reason}`,
        path: ["key"],
      });
    }
  });
export type ResourceClaim = z.infer<typeof ResourceClaimSchema>;

export interface ResourceClaimKeyValidation {
  ok: boolean;
  reason?: string;
  normalized?: string;
}

/**
 * M24 §6.4: path keys are repository-relative POSIX paths. Backslashes in
 * the ORIGINAL input are rejected outright (never silently converted); the
 * "temporary slash-normalized copy" language in the spec refers only to
 * internally checking for absolute/UNC/drive/traversal forms consistently,
 * not to accepting backslash input. One optional trailing slash is
 * stripped; case is preserved; segments are compared exactly.
 */
export function validatePathClaimKey(key: string): ResourceClaimKeyValidation {
  if (key.length === 0) return { ok: false, reason: "must not be empty" };
  if (key.includes("\\")) {
    return { ok: false, reason: "must not contain backslashes; use forward-slash repository-relative paths" };
  }
  if (key.startsWith("/")) return { ok: false, reason: "must not be an absolute path" };
  if (/^[A-Za-z]:/.test(key)) return { ok: false, reason: "must not be a drive-letter path" };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key) || key.includes("://")) {
    return { ok: false, reason: "must not be a URL or scheme-prefixed value" };
  }
  const stripped = key.endsWith("/") && key.length > 1 ? key.slice(0, -1) : key;
  const segments = stripped.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { ok: false, reason: "must not contain empty, '.', or '..' segments" };
  }
  return { ok: true, normalized: stripped };
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** M24 §6.5: database/environment/external_system/custom domains: NFC-normalized, trimmed, 1..256 chars, no control characters or line breaks. */
export function validateTextClaimKey(key: string): ResourceClaimKeyValidation {
  const normalized = key.normalize("NFC").trim();
  if (normalized.length < 1 || normalized.length > 256) {
    return { ok: false, reason: "must be 1..256 characters after trim" };
  }
  if (hasControlCharacters(normalized)) {
    return { ok: false, reason: "must not contain control characters or line breaks" };
  }
  return { ok: true, normalized };
}

/** M24 §6.3: only `project` is a valid repository-domain key. */
export function validateRepositoryClaimKey(key: string): ResourceClaimKeyValidation {
  return key === "project" ? { ok: true, normalized: "project" } : { ok: false, reason: "must be exactly 'project'" };
}

export function validateResourceClaimKey(domain: ResourceDomain, key: string): ResourceClaimKeyValidation {
  switch (domain) {
    case "repository":
      return validateRepositoryClaimKey(key);
    case "path":
      return validatePathClaimKey(key);
    case "database":
    case "environment":
    case "external_system":
    case "custom":
      return validateTextClaimKey(key);
  }
}

/**
 * M24 §6: the true domain-aware normalized identity, used both for
 * in-Work-Unit duplicate-claim rejection here and reused verbatim by
 * WU24-03's conflict engine (src/workflow/resource-claim.ts) for exact-key
 * comparison -- one owner, never duplicated.
 */
export function resourceClaimIdentity(claim: ResourceClaim): string {
  const validation = validateResourceClaimKey(claim.domain, claim.key);
  const normalizedKey = validation.normalized ?? claim.key;
  return `${claim.domain}:${normalizedKey}`;
}

export const ParallelPolicyMetadataSchema = z
  .object({
    mode: ParallelModeSchema,
    concurrencyGroup: z.string().optional(),
    resourceClaims: z.array(ResourceClaimSchema).max(RESOURCE_CLAIMS_PER_WORK_UNIT_MAX).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.concurrencyGroup !== undefined) {
      const result = validateAssignmentToken(value.concurrencyGroup, CONCURRENCY_GROUP_MAX_CHARS);
      if (!result.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `concurrencyGroup invalid: ${result.reason}`,
          path: ["concurrencyGroup"],
        });
      }
    }
    const seen = new Set<string>();
    value.resourceClaims.forEach((claim, index) => {
      const identity = resourceClaimIdentity(claim);
      if (seen.has(identity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate resource claim for ${identity}`,
          path: ["resourceClaims", index],
        });
      }
      seen.add(identity);
    });
  });
export type ParallelPolicyMetadata = z.infer<typeof ParallelPolicyMetadataSchema>;

/**
 * M24 §2.1: additive, optional Work Unit metadata. Both child objects are
 * independently optional; a Work Unit may declare workspace assignment
 * without a parallel policy, or vice versa. Missing metadata is never
 * materialized here -- conservative defaults are derived on read by
 * src/workflow/execution-metadata-defaults.ts, never written back.
 */
export const ExecutionMetadataSchema = z
  .object({
    workspaceAssignment: WorkspaceAssignmentMetadataSchema.optional(),
    parallelPolicy: ParallelPolicyMetadataSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // M24 §4.3 "Critical intrinsic validation rule": mode "none" is
    // self-contradictory with any repository/path write-or-exclusive
    // resource claim declared under the SAME Work Unit's parallelPolicy.
    // This is an intrinsic, single-Work-Unit consistency error -- never
    // deferred to pairwise evaluation.
    if (value.workspaceAssignment?.mode === "none") {
      const claims = value.parallelPolicy?.resourceClaims ?? [];
      const contradicting = claims.some(
        (claim) =>
          (claim.domain === "repository" || claim.domain === "path") &&
          (claim.access === "write" || claim.access === "exclusive"),
      );
      if (contradicting) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "workspaceAssignment.mode 'none' is incompatible with a repository/path resource claim that has write or exclusive access",
          path: ["workspaceAssignment"],
        });
      }
    }

    if (JSON.stringify(value).length > SERIALIZED_EXECUTION_METADATA_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `executionMetadata exceeds serialized_execution_metadata_max_bytes (${SERIALIZED_EXECUTION_METADATA_MAX_BYTES})`,
      });
    }
  });
export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;
