import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M40-WU01 (build spec Sec 5.6, acceptance criteria: "no publication/draft/
 * network path exists in WU40-01"; "architecture tests protect the
 * boundary"). Every WU40-01 file is contract/pure-workflow/read-only-Git
 * only -- no network, no GitHub access, no arbitrary process execution.
 * Scoped to exactly the WU40-01 file set, mirroring the established M27/
 * M28/M36-WU01 boundary-scan pattern.
 */
const M40_WU01_FILES = [
  "src/schema/release-governance.schema.ts",
  "src/workflow/release-candidate.ts",
  "src/workflow/release-provenance.ts",
  "src/workflow/release-readiness.ts",
  "src/services/release-governance-service.ts",
];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bnode:net\b/, label: "node:net" },
  { pattern: /\bnode:http\b/, label: "node:http" },
  { pattern: /\bnode:https\b/, label: "node:https" },
  { pattern: /\bnode:tls\b/, label: "node:tls" },
  { pattern: /\bnode:dgram\b/, label: "node:dgram" },
  { pattern: /\bnode:dns\b/, label: "node:dns" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bWebSocket\b/, label: "WebSocket" },
  { pattern: /\boctokit\b/i, label: "GitHub API client (octokit)" },
  { pattern: /github\.com\/repos|api\.github\.com/, label: "GitHub REST API endpoint" },
  { pattern: /\bgh\s+release\b/, label: "gh release CLI invocation" },
  { pattern: /\beval\s*\(/, label: "eval() (dynamic code execution)" },
  { pattern: /new\s+Function\s*\(/, label: "new Function() (dynamic code execution)" },
  { pattern: /\bimport\s*\(/, label: "dynamic import()" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
];

describe("M40-WU01 boundary scan: every added file is contract/pure-workflow/read-only, no network/GitHub/publication surface", () => {
  for (const relPath of M40_WU01_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("only release-governance-service.ts touches Git, and only through the existing read-only gitRevParse export", () => {
    for (const relPath of M40_WU01_FILES) {
      if (relPath === "src/services/release-governance-service.ts") continue;
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import git-command-runner.ts directly`).not.toMatch(/from\s+["'].*git-command-runner/);
    }
    const serviceText = readFileSync(join(repoRoot, "src/services/release-governance-service.ts"), "utf8");
    expect(serviceText).toMatch(/import\s*\{\s*gitRevParse,\s*GitRunnerError\s*\}\s*from\s*"\.\.\/workspaces\/git-command-runner\.js"/);
    expect(serviceText).not.toMatch(/gitWorktreeAdd|gitWorktreeRemove|gitDiffPatch/);
  });

  it("no WU40-01 file references a draft/publish/release-note-render surface (those belong to later Work Units)", () => {
    for (const relPath of M40_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not reference draft creation`).not.toMatch(/createDraft|publishRelease/i);
    }
  });

  it("package.json declares no new runtime dependency for M40-WU01 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("no CLI command file references release-governance yet (no public surface exists before WU40-03)", () => {
    const registerText = readFileSync(join(repoRoot, "src/cli/register-commands.ts"), "utf8");
    expect(registerText).not.toMatch(/release-governance-service|release-candidate\.js|release-provenance\.js|release-readiness\.js/);
  });
});
