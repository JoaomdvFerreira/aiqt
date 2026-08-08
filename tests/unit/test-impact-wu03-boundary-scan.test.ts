import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M41-WU03 (build spec Sec 8, acceptance criteria: "one selection owner
 * is reused everywhere"; "no new generic shell/test-runner execution
 * path is introduced"). validation select/explain must stay read-only,
 * and the only selection computation path must be
 * buildExecutionGuidanceForWorkUnit / selectTestImpact -- no second
 * decision owner.
 */
const M41_WU03_FILES = ["src/cli/commands/validation-shared.ts", "src/cli/commands/validation-select.command.ts", "src/cli/commands/validation-explain.command.ts"];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:execFileSync|spawnSync|execFile|spawn|execSync)\s*\(/, label: "a direct child_process execution call" },
  { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b/, label: "network module" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /writeStateModel|writeProjectModel|appendRunlogEvent/, label: "a canonical-state mutation call (validation must never mutate)" },
];

describe("M41-WU03 boundary scan: validation select/explain stay read-only, one shared selection owner", () => {
  for (const relPath of M41_WU03_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("both select and explain resolve guidance through the shared lookupExecutionGuidanceForCommand helper, not a private duplicate", () => {
    const selectText = readFileSync(join(repoRoot, "src/cli/commands/validation-select.command.ts"), "utf8");
    const explainText = readFileSync(join(repoRoot, "src/cli/commands/validation-explain.command.ts"), "utf8");
    expect(selectText).toMatch(/lookupExecutionGuidanceForCommand/);
    expect(explainText).toMatch(/lookupExecutionGuidanceForCommand/);
  });

  it("validation-shared.ts calls buildExecutionGuidanceForWorkUnit -- the same function next/next-preview call -- not a second selection path", () => {
    const text = readFileSync(join(repoRoot, "src/cli/commands/validation-shared.ts"), "utf8");
    expect(text).toMatch(/from\s+["']\.\/next-selection-helpers\.js["']/);
    expect(text).toMatch(/buildExecutionGuidanceForWorkUnit/);
  });

  it("register-commands.ts registers exactly select/explain under 'validation', no third command", () => {
    const registerText = readFileSync(join(repoRoot, "src/cli/register-commands.ts"), "utf8");
    const section = registerText.slice(registerText.indexOf('.command("validation")'));
    expect(section).toMatch(/\.command\("select"\)/);
    expect(section).toMatch(/\.command\("explain"\)/);
  });
});
