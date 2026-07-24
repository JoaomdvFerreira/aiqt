import { z } from "zod";
import { EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH } from "./external-evidence/limits.js";

/**
 * M27 §4.2: bounded, line-oriented input limits for the Claude Code
 * stream-json transport. Adopted at the exact Gate G ceiling (see
 * M27_Gate_G_Record.md); not raised without review. Distinct from (and
 * larger than) M23/M26's single-JSON-document EXTERNAL_INPUT_MAX_PAYLOAD_BYTES,
 * because NDJSON transcripts are materially larger and differently shaped.
 * max_json_depth is numerically identical to and reuses
 * EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH.
 */
export const STREAM_JSON_MAX_TOTAL_BYTES = 16777216;
export const STREAM_JSON_MAX_LINES = 20000;
export const STREAM_JSON_MAX_LINE_BYTES = 1048576;
export const STREAM_JSON_MAX_JSON_DEPTH = EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH;
export const STREAM_JSON_MAX_DISTINCT_SESSION_IDS = 1;

/**
 * M27 §4.3: the six recognized top-level message families. Any other
 * `type` is an unsupported critical message type and rejects the whole
 * import. `stream_event` is the explicit "approved ignorable observability
 * record" class -- counted and discarded, never required for a valid
 * import.
 */
export const RECOGNIZED_MESSAGE_TYPES = ["system", "assistant", "user", "stream_event", "result"] as const;
export type RecognizedMessageType = (typeof RECOGNIZED_MESSAGE_TYPES)[number];

/** M27 §1.3 Gate G decision: only these two `system` subtypes are recognized; any other subtype rejects the import. */
export const RECOGNIZED_SYSTEM_SUBTYPES = ["init", "api_retry"] as const;

/** M27 §1.3 Gate G decision: only these `result` subtypes are recognized; any other subtype rejects the import. */
export const RECOGNIZED_RESULT_SUBTYPES = ["success", "error_max_turns", "error_during_execution"] as const;

/** M27 §5.4.1 Gate G decision: a bounded, structural enum -- never inferred from free text. */
export const RECOGNIZED_ERROR_CATEGORIES = ["authentication", "billing", "rate_limit", "service_unavailable", "invalid_input", "internal"] as const;

const SessionIdSchema = z.string().min(1).max(200);

/** Loose content schema for message bodies whose content is always discarded -- only shape-checked enough to count tool_use blocks, never persisted. */
const LooseContentBlockSchema = z.object({ type: z.string().optional() }).passthrough();
const LooseMessageSchema = z
  .object({
    role: z.string().optional(),
    content: z.union([z.string(), z.array(LooseContentBlockSchema)]).optional(),
  })
  .passthrough();

export const SystemLineSchema = z
  .object({
    type: z.literal("system"),
    subtype: z.string(),
    session_id: SessionIdSchema.optional(),
    claude_code_version: z.string().max(200).optional(),
  })
  .passthrough();

export const AssistantOrUserLineSchema = z
  .object({
    type: z.enum(["assistant", "user"]),
    session_id: SessionIdSchema.optional(),
    parent_tool_use_id: z.string().max(200).nullable().optional(),
    message: LooseMessageSchema.optional(),
  })
  .passthrough();

export const StreamEventLineSchema = z
  .object({
    type: z.literal("stream_event"),
    session_id: SessionIdSchema.optional(),
  })
  .passthrough();

export const ResultLineSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string(),
    session_id: SessionIdSchema.optional(),
    is_error: z.boolean(),
    error_category: z.string().max(100).optional(),
    duration_ms: z.number().int().min(0).optional(),
    num_turns: z.number().int().min(0).optional(),
    usage: z
      .object({
        input_tokens: z.number().int().min(0).optional(),
        output_tokens: z.number().int().min(0).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Discriminates a parsed line by its `type` field only; per-family field validation happens after the discriminant match. */
export const StreamJsonLineTypeSchema = z.object({ type: z.string() }).passthrough();
