import type { ParsedStreamJsonSummary } from "./claude-code-stream-json-parser.js";
import type { ClaudeProviderResultClass, ClaudeProviderInvocationSummary } from "../schema/execution-adapter-request.schema.js";
import { RECOGNIZED_ERROR_CATEGORIES } from "../schema/claude-code-stream-json.schema.js";
import { MAX_BOUNDED_TEXT_CHARS } from "../schema/execution-session.schema.js";

const UNAVAILABLE_ERROR_CATEGORIES: ReadonlySet<string> = new Set(["authentication", "billing", "rate_limit", "service_unavailable"]);

/**
 * M27 §5.4.1 (Gate G-approved, mutually exclusive result matrix -- see
 * M27_Gate_G_Record.md): reads only structured fields (`subtype`,
 * `is_error`, a bounded `error_category` enum). Never inspects free-text
 * resultSummary/message content to choose a class.
 */
export function classifyClaudeCodeResult(summary: ParsedStreamJsonSummary): ClaudeProviderResultClass {
  const { result } = summary;
  if (result.subtype === "success" && !result.isError) return "success";
  if (result.subtype === "error_max_turns") return "limited";
  if (result.subtype === "error_during_execution") {
    if (result.errorCategory && RECOGNIZED_ERROR_CATEGORIES.includes(result.errorCategory as (typeof RECOGNIZED_ERROR_CATEGORIES)[number]) && UNAVAILABLE_ERROR_CATEGORIES.has(result.errorCategory)) {
      return "unavailable";
    }
    return "failed";
  }
  // Unreachable given parseClaudeCodeStreamJson already rejects unrecognized
  // subtypes before a summary is ever produced; failed is the safe default.
  return "failed";
}

function resultSummaryText(resultClass: ClaudeProviderResultClass, summary: ParsedStreamJsonSummary): string {
  const base = `Claude Code invocation classified as "${resultClass}" (subtype: ${summary.result.subtype}).`;
  return base.length > MAX_BOUNDED_TEXT_CHARS ? base.slice(0, MAX_BOUNDED_TEXT_CHARS) : base;
}

/** M27 §5.5: builds the bounded, non-billing invocation summary persisted alongside the M26 session. */
export function buildClaudeProviderInvocationSummary(
  requestId: string,
  summary: ParsedStreamJsonSummary,
): ClaudeProviderInvocationSummary {
  const resultClass = classifyClaudeCodeResult(summary);
  return {
    requestId,
    providerVersion: summary.providerVersion,
    messageCount: summary.messageCount,
    assistantMessageCount: summary.assistantMessageCount,
    toolUseCount: summary.toolUseCount,
    apiRetryCount: summary.apiRetryCount,
    reportedTokens:
      summary.result.inputTokens !== undefined || summary.result.outputTokens !== undefined
        ? (summary.result.inputTokens ?? 0) + (summary.result.outputTokens ?? 0)
        : undefined,
    reportedDurationSeconds: summary.result.durationMs !== undefined ? Math.round(summary.result.durationMs / 1000) : undefined,
    resultClass,
    resultSummary: resultSummaryText(resultClass, summary),
  };
}
