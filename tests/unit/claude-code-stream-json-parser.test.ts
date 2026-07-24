import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeCodeStreamJson } from "../../src/workflow/claude-code-stream-json-parser.js";
import { classifyClaudeCodeResult, buildClaudeProviderInvocationSummary } from "../../src/workflow/claude-code-result-normalizer.js";
import { STREAM_JSON_MAX_LINES, STREAM_JSON_MAX_LINE_BYTES } from "../../src/schema/claude-code-stream-json.schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "claude-code");

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("M27-WU03: parseClaudeCodeStreamJson", () => {
  it("fixture 01 (success, first invocation) parses to a success summary with counts", () => {
    const result = parseClaudeCodeStreamJson(fixture("01-success-first-invocation.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.sessionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.summary.messageCount).toBe(2);
    expect(result.summary.assistantMessageCount).toBe(1);
    expect(result.summary.toolUseCount).toBe(0);
    expect(classifyClaudeCodeResult(result.summary)).toBe("success");
  });

  it("fixture 02 (resumed) parses successfully with the same session_id semantics", () => {
    const result = parseClaudeCodeStreamJson(fixture("02-success-resumed-invocation.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(classifyClaudeCodeResult(result.summary)).toBe("success");
  });

  it("fixture 03 (multi-turn tool cycle) counts exactly one tool_use block", () => {
    const result = parseClaudeCodeStreamJson(fixture("03-multi-turn-tool-cycle.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.toolUseCount).toBe(1);
    expect(result.summary.assistantMessageCount).toBe(3);
  });

  it("fixture 04 (API retry then success) counts two api_retry records and still succeeds", () => {
    const result = parseClaudeCodeStreamJson(fixture("04-api-retry-then-success.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.apiRetryCount).toBe(2);
    expect(result.summary.apiRetryCategories).toEqual({ rate_limit: 2 });
    expect(classifyClaudeCodeResult(result.summary)).toBe("success");
  });

  it("fixture 05 (max-turn/budget stop) classifies as limited", () => {
    const result = parseClaudeCodeStreamJson(fixture("05-max-turn-budget-stop.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(classifyClaudeCodeResult(result.summary)).toBe("limited");
  });

  it("fixture 06 (auth/availability failure) classifies as unavailable", () => {
    const result = parseClaudeCodeStreamJson(fixture("06-auth-availability-failure.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(classifyClaudeCodeResult(result.summary)).toBe("unavailable");
  });

  it("fixture 07 (malformed/truncated) is rejected: no terminal result", () => {
    const result = parseClaudeCodeStreamJson(fixture("07-malformed-truncated.jsonl"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/terminal result/);
  });

  it("fixture 08 (mixed-session) is rejected atomically", () => {
    const result = parseClaudeCodeStreamJson(fixture("08-mixed-session.jsonl"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/mixed-session/);
  });

  it("fixture 09 (subagent records) parses successfully; subagent-marked lines still count as messages, content still discarded", () => {
    const result = parseClaudeCodeStreamJson(fixture("09-subagent-records.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.assistantMessageCount).toBe(2);
    expect(result.summary.messageCount).toBe(3);
    expect(result.summary.toolUseCount).toBe(1);
    expect(classifyClaudeCodeResult(result.summary)).toBe("success");
  });

  it("fixture 10 (partial stream events) parses successfully; stream_event lines are ignorable", () => {
    const result = parseClaudeCodeStreamJson(fixture("10-partial-stream-events.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.messageCount).toBe(1);
    expect(classifyClaudeCodeResult(result.summary)).toBe("success");
  });

  it("rejects an unsupported top-level message type", () => {
    const result = parseClaudeCodeStreamJson('{"type":"system","subtype":"init","session_id":"x"}\n{"type":"tool_call","session_id":"x"}\n{"type":"result","subtype":"success","session_id":"x","is_error":false}\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unsupported message type/);
  });

  it("rejects an unsupported result subtype", () => {
    const result = parseClaudeCodeStreamJson('{"type":"system","subtype":"init","session_id":"x"}\n{"type":"result","subtype":"error_unknown_case","session_id":"x","is_error":true}\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unsupported result subtype/);
  });

  it("rejects an unsupported system subtype", () => {
    const result = parseClaudeCodeStreamJson('{"type":"system","subtype":"unexpected","session_id":"x"}\n{"type":"result","subtype":"success","session_id":"x","is_error":false}\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unsupported system subtype/);
  });

  it("rejects a result line that is not the final line", () => {
    const result = parseClaudeCodeStreamJson('{"type":"result","subtype":"success","session_id":"x","is_error":false}\n{"type":"assistant","session_id":"x","message":{"role":"assistant","content":[{"type":"text","text":"late"}]}}\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/final line/);
  });

  it("rejects malformed JSON on any line", () => {
    const result = parseClaudeCodeStreamJson('{"type":"system","subtype":"init","session_id":"x"}\nnot json\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not valid JSON/);
  });

  it("rejects empty input", () => {
    const result = parseClaudeCodeStreamJson("");
    expect(result.ok).toBe(false);
  });

  it("rejects input exceeding max_lines", () => {
    const lines = Array.from({ length: STREAM_JSON_MAX_LINES + 1 }, () => '{"type":"stream_event","session_id":"x"}').join("\n");
    const result = parseClaudeCodeStreamJson(lines);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/max_lines/);
  });

  it("rejects a single line exceeding max_line_bytes", () => {
    const hugeLine = `{"type":"stream_event","session_id":"x","padding":"${"a".repeat(STREAM_JSON_MAX_LINE_BYTES)}"}`;
    const result = parseClaudeCodeStreamJson(hugeLine + '\n{"type":"result","subtype":"success","session_id":"x","is_error":false}\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/max_line_bytes/);
  });

  it("rejects a prohibited key (__proto__) even nested inside discarded content", () => {
    const result = parseClaudeCodeStreamJson('{"type":"assistant","session_id":"x","message":{"role":"assistant","content":[{"type":"text","__proto__":{"polluted":true}}]}}\n{"type":"result","subtype":"success","session_id":"x","is_error":false}\n');
    expect(result.ok).toBe(false);
  });

  it("classifies error_during_execution with a non-unavailable category as failed", () => {
    const result = parseClaudeCodeStreamJson('{"type":"system","subtype":"init","session_id":"x"}\n{"type":"result","subtype":"error_during_execution","session_id":"x","is_error":true,"error_category":"internal"}\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(classifyClaudeCodeResult(result.summary)).toBe("failed");
  });

  it("classifies error_during_execution with no error_category as failed (never inferred from free text)", () => {
    const result = parseClaudeCodeStreamJson('{"type":"system","subtype":"init","session_id":"x"}\n{"type":"result","subtype":"error_during_execution","session_id":"x","is_error":true}\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(classifyClaudeCodeResult(result.summary)).toBe("failed");
  });
});

describe("M27-WU03: buildClaudeProviderInvocationSummary", () => {
  it("never includes raw message content, only bounded counts/digests/enums", () => {
    const result = parseClaudeCodeStreamJson(fixture("03-multi-turn-tool-cycle.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = buildClaudeProviderInvocationSummary("REQ-001", result.summary);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toMatch(/Synthetic/);
    expect(serialized).not.toMatch(/toolu_example/);
    expect(summary.resultClass).toBe("success");
    expect(summary.reportedTokens).toBe(1200 + 900);
    expect(summary.reportedDurationSeconds).toBe(25);
  });

  it("reportedCost is never stored (M26 does not own billing data)", () => {
    const result = parseClaudeCodeStreamJson(fixture("01-success-first-invocation.jsonl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = buildClaudeProviderInvocationSummary("REQ-001", result.summary);
    expect("reportedCost" in summary).toBe(false);
  });
});
