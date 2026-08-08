import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M41-WU04 (build spec Sec 12, acceptance criteria: "no new validation-
 * history database is introduced"). Feedback filtering/extraction/
 * adaptation stays pure and reuses the existing Checkpoint owner -- no
 * process spawn, no network, no new persistence/store.
 */
const M41_WU04_FILES = ["src/workflow/test-impact-feedback.ts", "src/workflow/test-impact-adaptive-selection.ts"];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
  { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b/, label: "network module" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /writeJsonFile|writeTextFile|atomicWriteFileSync|appendRunlogEvent/, label: "a canonical-state/new-persistence write call (no new validation-history database)" },
];

describe("M41-WU04 boundary scan: feedback trust/adaptation is pure, no new persistence, no execution surface", () => {
  for (const relPath of M41_WU04_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("loadValidationFeedbackFromCheckpoints reads the existing Checkpoint schema, not a new store", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/test-impact-feedback.ts"), "utf8");
    expect(text).toMatch(/from\s+["']\.\.\/schema\/checkpoint\.schema\.js["']/);
  });

  it("execution-guidance.ts calls the WU04 feedback-aware wrapper, not the bare WU02 selector directly", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/execution-guidance.ts"), "utf8");
    expect(text).toMatch(/selectTestImpactWithFeedback/);
    expect(text).not.toMatch(/\bselectTestImpact\(/);
  });
});
