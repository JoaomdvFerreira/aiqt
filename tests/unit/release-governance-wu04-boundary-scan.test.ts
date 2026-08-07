import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M40-WU04 (build spec Sec 11.3, acceptance criteria: "no publication
 * endpoint/path is introduced"; "no automatic merge/deploy/version
 * bump"). The GitHub network surface is deliberately narrow: exactly one
 * file may call `fetch`, exactly one hardcoded `draft: true`, no `PATCH`/
 * publish-shaped endpoint, no retry loop, no generic shell/process
 * execution anywhere in this Work Unit's files.
 */
const M40_WU04_FILES = [
  "src/workflow/release-draft-policy.ts",
  "src/services/github-release-client.ts",
  "src/cli/commands/release-draft.command.ts",
];

const FORBIDDEN_EVERYWHERE: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
  { pattern: /\bimport\s*\(/, label: "dynamic import()" },
  { pattern: /method:\s*["']PATCH["']/, label: "PATCH method (used by GitHub's API to publish/edit an existing release)" },
  { pattern: /\bmerge\b/i, label: "merge behavior (out of M40 scope entirely)" },
  { pattern: /"published"\s*:\s*true|draft:\s*false/, label: "a non-draft release payload" },
];

describe("M40-WU04 boundary scan: GitHub draft integration stays narrow, bounded, non-publishing", () => {
  for (const relPath of M40_WU04_FILES) {
    it(`${relPath} contains none of the universally-forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_EVERYWHERE) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("only github-release-client.ts calls fetch, and calls it exactly 3 times (one per operation)", () => {
    for (const relPath of M40_WU04_FILES) {
      if (relPath === "src/services/github-release-client.ts") continue;
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not call fetch directly`).not.toMatch(/\bfetch\s*\(/);
    }
    const clientText = readFileSync(join(repoRoot, "src/services/github-release-client.ts"), "utf8");
    const fetchCalls = clientText.match(/\bfetch\s*\(/g) ?? [];
    expect(fetchCalls.length).toBe(1); // single shared githubFetch() helper, not one per operation
    const githubFetchCalls = clientText.match(/\bgithubFetch\s*\(/g) ?? [];
    // 1 definition + exactly 3 call sites (getRepository, getReleaseByTag, createReleaseDraft).
    expect(githubFetchCalls.length).toBe(4);
  });

  it("the actual request payload hardcodes draft: true and never reads it from a caller-supplied variable", () => {
    const clientText = readFileSync(join(repoRoot, "src/services/github-release-client.ts"), "utf8");
    expect(clientText).toMatch(/JSON\.stringify\(\{[^}]*draft:\s*true[^}]*\}\)/);
    expect(clientText).not.toMatch(/params\.draft|options\.draft|draft:\s*params/);
  });

  it("CreateReleaseDraftParams exposes no draft field, and no CLI option can flip draft to false", () => {
    const clientText = readFileSync(join(repoRoot, "src/services/github-release-client.ts"), "utf8");
    const paramsBlockMatch = clientText.match(/interface CreateReleaseDraftParams \{[\s\S]*?\n\}/);
    expect(paramsBlockMatch).not.toBeNull();
    expect(paramsBlockMatch?.[0] ?? "").not.toMatch(/draft/);
    const commandText = readFileSync(join(repoRoot, "src/cli/commands/release-draft.command.ts"), "utf8");
    expect(commandText).not.toMatch(/--publish|publish:\s*true|draft:\s*false/);
  });

  it("no retry loop exists around any GitHub network call (no while/for around a fetch/githubFetch call in the client)", () => {
    const clientText = readFileSync(join(repoRoot, "src/services/github-release-client.ts"), "utf8");
    expect(clientText).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
  });

  it("release-shared.ts is not imported by github-release-client.ts (network client has no CLI/result-contract coupling)", () => {
    const clientText = readFileSync(join(repoRoot, "src/services/github-release-client.ts"), "utf8");
    expect(clientText).not.toMatch(/release-shared/);
  });

  it("register-commands.ts registers exactly one new subcommand, 'release draft', for this Work Unit", () => {
    const registerText = readFileSync(join(repoRoot, "src/cli/register-commands.ts"), "utf8");
    const releaseSection = registerText.slice(registerText.indexOf('.command("release")'));
    expect(releaseSection).toMatch(/\.command\("draft"\)/);
  });

  it("credentials are read only from an environment variable name, never accepted as a literal token CLI flag", () => {
    const commandText = readFileSync(join(repoRoot, "src/cli/commands/release-draft.command.ts"), "utf8");
    expect(commandText).toMatch(/env\[tokenEnvName\]/);
    expect(commandText).not.toMatch(/options\.token\b/);
  });
});
