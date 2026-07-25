import { z } from "zod";
import { ExecutionWorkspaceRefSchema, MAX_BOUNDED_KEY_CHARS, MAX_BOUNDED_TEXT_CHARS } from "./execution-session.schema.js";
import { AdapterIdSchema as StaticAdapterIdSchema, CLAUDE_ADAPTER_ID } from "./adapter-registry.js";
import { ExternalAgentRefSchema } from "./external-agent-ref.schema.js";

/**
 * M27 §4.2/§7: state-growth and input limits, validated before mutation.
 * Not increased without review, mirroring M26's execution-session.schema.ts
 * convention.
 */
export const MAX_ADAPTER_REQUESTS = 2000;
export const MAX_ADAPTER_REQUESTS_PER_SESSION = 200;

/**
 * M27R §3.1: `adapterId` widens additively to the static registry union
 * (generic-json@1 | claude-code-stream-json@1) -- historical M27 records
 * (adapterId always claude-code-stream-json@1) remain valid unchanged.
 * `ADAPTER_ID` is kept as a back-compatible alias of the Claude adapter's
 * own ID for existing importers; new code should prefer
 * CLAUDE_ADAPTER_ID/GENERIC_ADAPTER_ID from adapter-registry.ts directly.
 */
export const ADAPTER_ID = CLAUDE_ADAPTER_ID;
export const AdapterIdSchema = StaticAdapterIdSchema;

export const AdapterRequestModeSchema = z.enum(["start", "resume"]);
export type AdapterRequestMode = z.infer<typeof AdapterRequestModeSchema>;

/**
 * M27 §3.1: requested is the only "active" state; imported/expired/invalid
 * are terminal for that request record and are never reactivated. `expired`
 * and `invalid` are reserved for explicit future recovery paths -- every
 * M27 command in this milestone either persists `requested` (created),
 * `imported` (successful import), or leaves the record entirely unchanged
 * (every rejection disposition in §5.4.2/§9 is zero-mutation), so those two
 * values are schema-complete but not reachable through any command in this
 * milestone. Expiry itself is evaluated live from `expiresAt` wherever it
 * matters (status reporting, conflict checks) rather than written back, so
 * a read-only `status` command never mutates state.
 */
export const AdapterRequestStatusSchema = z.enum(["requested", "imported", "expired", "invalid"]);
export type AdapterRequestStatus = z.infer<typeof AdapterRequestStatusSchema>;

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/**
 * M27 §3.1: canonical adapter-request metadata record. Bounded and
 * immutable except for the lifecycle fields (`status`, `importedSourceDigest`,
 * `importedAt`). No credentials, raw prompts, or provider transcript content
 * is ever persisted here -- only identity, sequence, and digest metadata.
 */
export const ExecutionAdapterRequestSchema = z
  .object({
    id: z.string().min(1),
    adapterId: AdapterIdSchema,
    executionSessionId: z.string().min(1),
    /** M27R §3.2/§4: AIQT-owned generic session identity (`external/<uuid>`). Required for every new generic-session request; absent on historical pre-M27R Claude compatibility records. */
    sessionClientKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS).optional(),
    workUnitId: z.string().min(1),
    packetId: z.string().min(1),
    workspaceRef: ExecutionWorkspaceRefSchema,
    requestSequence: z.number().int().positive(),
    /** M27: Claude adapter's own native provider session UUID -- optional; absent for generic-json@1 requests. */
    externalSessionId: z.string().uuid().optional(),
    mode: AdapterRequestModeSchema,
    status: AdapterRequestStatusSchema,
    requestDigest: Sha256DigestSchema,
    importedSourceDigest: Sha256DigestSchema.optional(),
    /** M27: Claude-specific provider-version band; optional -- generic-json@1 requests never set it. */
    providerVersionConstraint: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS).optional(),
    createdAt: z.string(),
    expiresAt: z.string(),
    importedAt: z.string().optional(),
    /** M27R §4: the M26 iteration this request's import produced, once imported. */
    importedIterationId: z.string().min(1).optional(),
    /** M27R §4/§6.4: which agent actually produced the imported result -- opaque, per-request metadata. */
    importedAgent: ExternalAgentRefSchema.optional(),
    /** M27 §5.5: Claude-adapter-only, set once at import time by the Claude adapter path. Never raw provider content -- bounded counts/enums only. */
    invocationSummary: z.lazy(() => ClaudeProviderInvocationSummarySchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "imported" && value.importedAt === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "importedAt is required once status is 'imported'", path: ["importedAt"] });
    }
    if (value.status !== "imported" && value.importedAt !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "importedAt must only be set once status is 'imported'", path: ["importedAt"] });
    }
  });
export type ExecutionAdapterRequest = z.infer<typeof ExecutionAdapterRequestSchema>;

/** M27 §5.5: bounded, non-billing provider health/usage summary. */
export const ClaudeProviderResultClassSchema = z.enum(["success", "limited", "unavailable", "failed"]);
export type ClaudeProviderResultClass = z.infer<typeof ClaudeProviderResultClassSchema>;

export const ClaudeProviderInvocationSummarySchema = z
  .object({
    requestId: z.string().min(1),
    providerVersion: z.string().max(MAX_BOUNDED_KEY_CHARS).optional(),
    messageCount: z.number().int().min(0),
    assistantMessageCount: z.number().int().min(0),
    toolUseCount: z.number().int().min(0),
    apiRetryCount: z.number().int().min(0),
    reportedTokens: z.number().int().min(0).optional(),
    reportedDurationSeconds: z.number().int().min(0).optional(),
    resultClass: ClaudeProviderResultClassSchema,
    resultSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS),
  })
  .strict();
export type ClaudeProviderInvocationSummary = z.infer<typeof ClaudeProviderInvocationSummarySchema>;
