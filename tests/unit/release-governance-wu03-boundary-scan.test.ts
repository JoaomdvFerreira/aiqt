import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M40-WU03 (build spec Sec 10, 11; acceptance criteria: "local preparation
 * does not create/publish a GitHub Release"). The CLI surface this Work
 * Unit adds (assess/validate/notes/prepare/status) must stay read-only or
 * bounded-local-only -- no network, no GitHub, no draft/publish path.
 * That boundary is WU40-04's alone to cross.
 */
const M40_WU03_FILES = [
  "src/schema/release-request.schema.ts",
  "src/cli/commands/release-shared.ts",
  "src/cli/commands/release-assess.command.ts",
  "src/cli/commands/release-validate.command.ts",
  "src/cli/commands/release-notes.command.ts",
  "src/cli/commands/release-prepare.command.ts",
  "src/cli/commands/release-status.command.ts",
  "src/state/release-decision-store.ts",
  "src/workflow/release-notes.ts",
];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bnode:tls\b/, label: "network module" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /\boctokit\b/i, label: "GitHub API client (octokit)" },
  { pattern: /github\.com\/repos|api\.github\.com/, label: "GitHub REST API endpoint" },
  { pattern: /\bgh\s+release\b/, label: "gh release CLI invocation" },
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
  { pattern: /createDraft|publishRelease/i, label: "draft/publish surface (WU40-04 scope)" },
];

describe("M40-WU03 boundary scan: release CLI stays read-only/bounded-local, no GitHub/network/draft surface", () => {
  for (const relPath of M40_WU03_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("release-decision-store.ts writes only under a local evidence directory, never .aiqt/ canonical state paths", () => {
    const text = readFileSync(join(repoRoot, "src/state/release-decision-store.ts"), "utf8");
    expect(text).not.toMatch(/writeStateModel|writeProjectModel|resolveAiqtPaths/);
  });

  it("aiqt release commands never import an evidence-gate-policy-import-style external network transport", () => {
    for (const relPath of M40_WU03_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not reference a GitHub token/credential surface (WU40-04 scope)`).not.toMatch(/GITHUB_TOKEN|githubToken|Authorization:\s*Bearer/i);
    }
  });

  it("register-commands.ts registers the 5 build-spec WU40-03 release subcommands (assess/validate/notes/prepare/status)", () => {
    const registerText = readFileSync(join(repoRoot, "src/cli/register-commands.ts"), "utf8");
    const releaseSection = registerText.slice(registerText.indexOf('.command("release")'));
    expect(releaseSection).toMatch(/\.command\("assess"\)/);
    expect(releaseSection).toMatch(/\.command\("validate"\)/);
    expect(releaseSection).toMatch(/\.command\("notes"\)/);
    expect(releaseSection).toMatch(/\.command\("prepare"\)/);
    expect(releaseSection).toMatch(/\.command\("status"\)/);
  });
});
