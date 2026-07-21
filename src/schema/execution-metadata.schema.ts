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
  .strict();
export type ResourceClaim = z.infer<typeof ResourceClaimSchema>;

/**
 * M24 §6: a placeholder, domain-generic identity used only to reject
 * verbatim-duplicate claims at the schema layer. WU24-03 (resource claim
 * normalization and conflict engine) owns true domain-aware normalization
 * (path trailing-slash stripping, NFC-trim for text domains, etc.) and
 * reuses this exact call site rather than introducing a second dedup
 * mechanism.
 */
export function resourceClaimIdentity(claim: ResourceClaim): string {
  return `${claim.domain}:${claim.key}`;
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
