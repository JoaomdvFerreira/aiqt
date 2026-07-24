import { assertSafeParsedJson } from "../schema/external-evidence/limits.js";
import {
  STREAM_JSON_MAX_LINES,
  STREAM_JSON_MAX_LINE_BYTES,
  STREAM_JSON_MAX_JSON_DEPTH,
  STREAM_JSON_MAX_DISTINCT_SESSION_IDS,
  RECOGNIZED_MESSAGE_TYPES,
  RECOGNIZED_SYSTEM_SUBTYPES,
  RECOGNIZED_RESULT_SUBTYPES,
  SystemLineSchema,
  AssistantOrUserLineSchema,
  StreamEventLineSchema,
  ResultLineSchema,
  StreamJsonLineTypeSchema,
} from "../schema/claude-code-stream-json.schema.js";

export interface ParsedResultLine {
  subtype: string;
  isError: boolean;
  errorCategory?: string;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * M27 §4.3/§5.5: the bounded, content-discarded summary of one complete
 * Claude Code stream-json invocation. No message text, tool input/output,
 * thinking, or other raw content is ever retained here -- only counts,
 * the terminal result's structural fields, and the provider version
 * string (if the producer reported one on `system/init`).
 */
export interface ParsedStreamJsonSummary {
  sessionId: string;
  providerVersion?: string;
  messageCount: number;
  assistantMessageCount: number;
  toolUseCount: number;
  apiRetryCount: number;
  apiRetryCategories: Record<string, number>;
  result: ParsedResultLine;
}

export type ParseStreamJsonResult = { ok: true; summary: ParsedStreamJsonSummary } | { ok: false; error: string };

function toolUseCountInMessage(message: unknown): number {
  if (message === null || typeof message !== "object") return 0;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return 0;
  return content.filter((block) => block !== null && typeof block === "object" && (block as { type?: unknown }).type === "tool_use").length;
}

/**
 * M27 §4.2/§4.3/§5.1: parses bounded Claude Code stream-json (already-read
 * raw text) line by line, enforcing max_lines/max_line_bytes/max_json_depth/
 * max_distinct_session_ids before any content is interpreted, recognizing
 * only the Gate-G-approved message families and subtypes, and discarding
 * every field except bounded counts and the terminal result's structural
 * fields. Never mutates state; the caller (M27 §5.1 step 1-6) owns hashing
 * the raw bytes and applying the resulting summary through the existing
 * M26 envelope engine.
 */
export function parseClaudeCodeStreamJson(rawText: string): ParseStreamJsonResult {
  const lines = rawText.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return { ok: false, error: "Input contains no stream-json lines." };
  }
  if (lines.length > STREAM_JSON_MAX_LINES) {
    return { ok: false, error: `Input exceeds max_lines (${STREAM_JSON_MAX_LINES}).` };
  }

  let sessionId: string | undefined;
  const sessionIdsSeen = new Set<string>();
  let providerVersion: string | undefined;
  let messageCount = 0;
  let assistantMessageCount = 0;
  let toolUseCount = 0;
  let apiRetryCount = 0;
  const apiRetryCategories: Record<string, number> = {};
  let result: ParsedResultLine | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (Buffer.byteLength(line, "utf8") > STREAM_JSON_MAX_LINE_BYTES) {
      return { ok: false, error: `Line ${i + 1} exceeds max_line_bytes (${STREAM_JSON_MAX_LINE_BYTES}).` };
    }

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      return { ok: false, error: `Line ${i + 1} is not valid JSON.` };
    }
    try {
      assertSafeParsedJson(parsedLine, { maxDepth: STREAM_JSON_MAX_JSON_DEPTH });
    } catch (err) {
      return { ok: false, error: `Line ${i + 1}: ${(err as Error).message}.` };
    }

    const typeCheck = StreamJsonLineTypeSchema.safeParse(parsedLine);
    if (!typeCheck.success) {
      return { ok: false, error: `Line ${i + 1} is not a recognized message object.` };
    }
    const type = typeCheck.data.type;
    if (!RECOGNIZED_MESSAGE_TYPES.includes(type as (typeof RECOGNIZED_MESSAGE_TYPES)[number])) {
      return { ok: false, error: `Line ${i + 1} has an unsupported message type "${type}".` };
    }

    const lineSessionId = (parsedLine as { session_id?: unknown }).session_id;
    if (typeof lineSessionId === "string" && lineSessionId.length > 0) {
      sessionIdsSeen.add(lineSessionId);
      if (sessionIdsSeen.size > STREAM_JSON_MAX_DISTINCT_SESSION_IDS) {
        return { ok: false, error: "Input references more than one distinct session_id (mixed-session output)." };
      }
      sessionId = lineSessionId;
    }

    if (type === "system") {
      const parsed = SystemLineSchema.safeParse(parsedLine);
      if (!parsed.success) {
        return { ok: false, error: `Line ${i + 1} is not a valid system message.` };
      }
      if (!RECOGNIZED_SYSTEM_SUBTYPES.includes(parsed.data.subtype as (typeof RECOGNIZED_SYSTEM_SUBTYPES)[number])) {
        return { ok: false, error: `Line ${i + 1} has an unsupported system subtype "${parsed.data.subtype}".` };
      }
      if (parsed.data.subtype === "init") {
        providerVersion = parsed.data.claude_code_version;
      } else if (parsed.data.subtype === "api_retry") {
        apiRetryCount += 1;
        const category = (parsedLine as { category?: unknown }).category;
        if (typeof category === "string") {
          apiRetryCategories[category] = (apiRetryCategories[category] ?? 0) + 1;
        }
      }
      continue;
    }

    if (type === "assistant" || type === "user") {
      const parsed = AssistantOrUserLineSchema.safeParse(parsedLine);
      if (!parsed.success) {
        return { ok: false, error: `Line ${i + 1} is not a valid ${type} message.` };
      }
      messageCount += 1;
      if (type === "assistant") {
        assistantMessageCount += 1;
        toolUseCount += toolUseCountInMessage(parsed.data.message);
      }
      continue;
    }

    if (type === "stream_event") {
      const parsed = StreamEventLineSchema.safeParse(parsedLine);
      if (!parsed.success) {
        return { ok: false, error: `Line ${i + 1} is not a valid stream_event record.` };
      }
      // Approved ignorable observability record (§4.3): counted implicitly
      // via messageCount omission -- discarded beyond structural validation.
      continue;
    }

    // type === "result"
    if (i !== lines.length - 1) {
      return { ok: false, error: `Line ${i + 1}: a "result" record must be the final line of the input.` };
    }
    const parsed = ResultLineSchema.safeParse(parsedLine);
    if (!parsed.success) {
      return { ok: false, error: `Line ${i + 1} is not a valid result record.` };
    }
    if (!RECOGNIZED_RESULT_SUBTYPES.includes(parsed.data.subtype as (typeof RECOGNIZED_RESULT_SUBTYPES)[number])) {
      return { ok: false, error: `Line ${i + 1} has an unsupported result subtype "${parsed.data.subtype}".` };
    }
    result = {
      subtype: parsed.data.subtype,
      isError: parsed.data.is_error,
      errorCategory: parsed.data.error_category,
      durationMs: parsed.data.duration_ms,
      numTurns: parsed.data.num_turns,
      inputTokens: parsed.data.usage?.input_tokens,
      outputTokens: parsed.data.usage?.output_tokens,
    };
  }

  if (!result) {
    return { ok: false, error: "Input has no terminal result record (incomplete or truncated capture)." };
  }
  if (!sessionId) {
    return { ok: false, error: "Input has no session_id on any line." };
  }

  return {
    ok: true,
    summary: {
      sessionId,
      providerVersion,
      messageCount,
      assistantMessageCount,
      toolUseCount,
      apiRetryCount,
      apiRetryCategories,
      result,
    },
  };
}
