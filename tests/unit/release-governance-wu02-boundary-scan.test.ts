import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M40-WU02 (build spec Sec 7, acceptance criteria: "no caller-supplied
 * arbitrary final score can override the assessor"). Mirrors the WU40-01
 * boundary-scan pattern for the two files this Work Unit adds.
 */
const M40_WU02_FILES = ["src/workflow/release-risk.ts", "src/workflow/release-approval.ts"];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b/, label: "network module" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
  { pattern: /\bimport\s*\(/, label: "dynamic import()" },
];

describe("M40-WU02 boundary scan: risk/approval modules are pure, no I/O, no fabricated approval", () => {
  for (const relPath of M40_WU02_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("ReleaseRiskSignals accepts only bounded enum/boolean signals, never a raw numeric score field", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/release-risk.ts"), "utf8");
    const interfaceMatch = text.match(/export interface ReleaseRiskSignals \{([\s\S]*?)\}/);
    expect(interfaceMatch).not.toBeNull();
    const body = interfaceMatch?.[1] ?? "";
    expect(body).not.toMatch(/:\s*number/);
  });

  it("buildInitialApprovalEvidence never sets humanApprovedBy/humanApprovedAt/waiver to anything but null", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/release-approval.ts"), "utf8");
    expect(text).toMatch(/humanApprovedBy:\s*null/);
    expect(text).toMatch(/humanApprovedAt:\s*null/);
    expect(text).toMatch(/waiver:\s*null/);
  });

  it("no CLI command file references the risk/approval modules yet (no public surface exists before WU40-03)", () => {
    const registerText = readFileSync(join(repoRoot, "src/cli/register-commands.ts"), "utf8");
    expect(registerText).not.toMatch(/release-risk\.js|release-approval\.js/);
  });
});
