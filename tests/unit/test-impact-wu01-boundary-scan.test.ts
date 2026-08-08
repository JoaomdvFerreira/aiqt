import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M41-WU01 (build spec Sec 12, "no broad execution or selection
 * integration yet"; acceptance criteria: "no test is removed/skipped").
 * Every WU01 file is a pure contract/inventory module -- no process
 * spawn, no network, no test execution, no mutation of vitest config or
 * any test file.
 */
const M41_WU01_FILES = ["src/schema/test-impact.schema.ts", "src/workflow/test-inventory.ts", "src/workflow/test-impact-input.ts"];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
  { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b/, label: "network module" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
  { pattern: /\bimport\s*\(/, label: "dynamic import()" },
  { pattern: /vitest\.config|testTimeout\s*[:=]|\.skip\(|\.only\(/, label: "test-runner configuration/skip/only mutation" },
];

describe("M41-WU01 boundary scan: test-impact contract/inventory files are pure, no execution/skip surface", () => {
  for (const relPath of M41_WU01_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("test-inventory.ts reuses M35's classifyAllTestFiles rather than a second discovery mechanism", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/test-inventory.ts"), "utf8");
    expect(text).toMatch(/from\s+["']\.\.\/tooling\/test-inventory-classifier\.js["']/);
  });

  it("no CLI command file references the test-impact contract yet (no public surface exists before WU41-03)", () => {
    const registerText = readFileSync(join(repoRoot, "src/cli/register-commands.ts"), "utf8");
    expect(registerText).not.toMatch(/test-impact|test-inventory\.js/);
  });
});
