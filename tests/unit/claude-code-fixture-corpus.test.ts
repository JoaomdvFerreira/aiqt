import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "claude-code");

const REQUIRED_CASES = [
  "01-success-first-invocation.jsonl",
  "02-success-resumed-invocation.jsonl",
  "03-multi-turn-tool-cycle.jsonl",
  "04-api-retry-then-success.jsonl",
  "05-max-turn-budget-stop.jsonl",
  "06-auth-availability-failure.jsonl",
  "07-malformed-truncated.jsonl",
  "08-mixed-session.jsonl",
  "09-subagent-records.jsonl",
  "10-partial-stream-events.jsonl",
];

describe("M27 Gate G fixture corpus (§1.2 minimum ten cases)", () => {
  it("contains exactly the ten required fixture files", () => {
    const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".jsonl")).sort();
    expect(files).toEqual(REQUIRED_CASES);
  });

  it("every fixture except the truncated case parses as line-delimited JSON with no real-looking secrets", () => {
    for (const name of REQUIRED_CASES) {
      const text = readFileSync(join(fixturesDir, name), "utf8");
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(typeof parsed).toBe("object");
        expect(parsed).not.toBeNull();
      }
      // Scrubbed-content guard: no absolute user home paths, API-key-shaped
      // tokens, or "sk-" prefixed secrets anywhere in the raw fixture text.
      expect(text).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(text).not.toMatch(/\/Users\/[^/]+\//);
      expect(text).not.toMatch(/C:\\Users\\/);
    }
  });

  it("fixture 07 (malformed/truncated) has no terminal result line", () => {
    const text = readFileSync(join(fixturesDir, "07-malformed-truncated.jsonl"), "utf8");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    const hasResult = lines.some((l) => (JSON.parse(l) as { type?: string }).type === "result");
    expect(hasResult).toBe(false);
  });

  it("fixture 08 (mixed-session) contains more than one distinct session_id", () => {
    const text = readFileSync(join(fixturesDir, "08-mixed-session.jsonl"), "utf8");
    const lines = text.split("\n").filter((l) => l.trim() !== "");
    const sessionIds = new Set(lines.map((l) => (JSON.parse(l) as { session_id?: string }).session_id));
    expect(sessionIds.size).toBeGreaterThan(1);
  });

  it("every non-truncated fixture has exactly one terminal result line", () => {
    for (const name of REQUIRED_CASES) {
      if (name === "07-malformed-truncated.jsonl") continue;
      const text = readFileSync(join(fixturesDir, name), "utf8");
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      const resultCount = lines.filter((l) => (JSON.parse(l) as { type?: string }).type === "result").length;
      expect(resultCount).toBe(1);
    }
  });
});
