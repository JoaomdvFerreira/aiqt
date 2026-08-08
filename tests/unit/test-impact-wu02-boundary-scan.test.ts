import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M41-WU02 (build spec Sec 12, acceptance criteria: "no arbitrary
 * caller-provided confidence/selection can override the owner"). The
 * selection algorithm stays pure -- no process spawn, no network, no
 * test execution.
 */
const M41_WU02_FILES = ["src/workflow/test-impact-selection.ts", "src/workflow/test-impact-blast-radius.ts"];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
  { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b/, label: "network module" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /\.skip\(|\.only\(/, label: "test skip/only mutation" },
];

describe("M41-WU02 boundary scan: selection algorithm is pure, no execution/network surface", () => {
  for (const relPath of M41_WU02_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("selectTestImpact's TestImpactInput parameter type carries no confidence/selectedTargets/escalation field a caller could set directly", () => {
    const text = readFileSync(join(repoRoot, "src/schema/test-impact.schema.ts"), "utf8");
    const inputBlock = text.match(/export interface TestImpactInput \{[\s\S]*?\n\}/);
    expect(inputBlock).not.toBeNull();
    const body = inputBlock?.[0] ?? "";
    expect(body).not.toMatch(/confidence|selectedTargets|escalation/i);
  });

  it("no CLI command file references the selection function yet (no public surface exists before WU41-03)", () => {
    const registerText = readFileSync(join(repoRoot, "src/cli/register-commands.ts"), "utf8");
    expect(registerText).not.toMatch(/test-impact-selection\.js/);
  });
});
