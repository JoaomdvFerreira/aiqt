import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M47-WU01 boundary scan (build spec Sec 14 WU47-01: "Pure contracts/
 * ownership/freshness/idempotency/state decision. No remote writes.").
 * Follows the established M27/M28/M36/M37 boundary-scan pattern: scoped to
 * exactly this Work Unit's own file set, so it cannot false-positive on
 * M25's Git command runner or M40's GitHub client, and proves only this
 * Work Unit's own "still contract-only" claim.
 */
const M47_WU01_FILES = [
  "src/schema/pull-request-integration.schema.ts",
  "src/workflow/pr-integration-identity.ts",
  "src/workflow/pr-integration-lifecycle.ts",
  "src/state/pr-integration-home.ts",
  "src/state/pr-integration-versioning.ts",
  "src/state/pr-integration-store.ts",
];

/** Only the store legitimately touches the filesystem; every other WU47-01 file is pure. */
const M47_WU01_PURE_FILES = M47_WU01_FILES.filter((f) => f !== "src/state/pr-integration-store.ts" && f !== "src/state/pr-integration-home.ts");

const codeOnly = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
    .join("\n");

describe("M47-WU01 boundary scan: contract/state files perform no remote write, no network, no process execution", () => {
  const surfaces: { pattern: RegExp; label: string }[] = [
    { pattern: /\bchild_process\b/, label: "child_process (process spawning)" },
    { pattern: /\bexecFileSync\b|\bspawnSync\b|\bexecFile\b|\bspawn\b|\bexecSync\b/, label: "a child_process execution function" },
    { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bnode:tls\b|\bnode:dns\b/, label: "a network module" },
    { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
    { pattern: /\bWebSocket\b|\bXMLHttpRequest\b/, label: "a network client" },
    { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
    { pattern: /\beval\s*\(|new\s+Function\s*\(|\bvm\.(Script|createContext|runIn)/, label: "dynamic code execution" },
    { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
  ];

  for (const relPath of M47_WU01_FILES) {
    it(`${relPath} contains none of the forbidden execution/network surfaces`, () => {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const { pattern, label } of surfaces) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("no WU47-01 file imports the Git command runner or the GitHub client (this Work Unit cannot reach either write surface)", () => {
    for (const relPath of M47_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import git-command-runner.js`).not.toMatch(/git-command-runner\.js/);
      expect(text, `${relPath} should not import github-release-client.js`).not.toMatch(/github-release-client\.js/);
    }
  });

  it("no WU47-01 file imports a CLI command module (no dispatch capability)", () => {
    for (const relPath of M47_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import a CLI command module`).not.toMatch(/from\s+["'].*cli\/commands/);
    }
  });

  it("the pure contract files perform no filesystem I/O at all -- only the store and home resolver may", () => {
    for (const relPath of M47_WU01_PURE_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import node:fs`).not.toMatch(/from\s+["']node:fs["']/);
    }
  });

  it("no WU47-01 file can merge, approve, force-push, delete a ref, push a tag, deploy, or publish a release (structural check, comments excluded)", () => {
    const forbidden: { pattern: RegExp; label: string }[] = [
      { pattern: /\bgitMerge\b|\.merge\(|\bmergePullRequest\b/i, label: "a merge operation" },
      { pattern: /\bapprovePullRequest\b|\bsubmitReview\b|["'`]APPROVE["'`]/, label: "a PR approval operation" },
      { pattern: /--force-with-lease|--force\b|\bforcePush\b/, label: "a force push" },
      { pattern: /\bdeleteRef\b|\bdeleteBranch\b/, label: "a ref/branch deletion" },
      { pattern: /\bpushTag\b|\bcreateTag\b/, label: "a tag push/creation" },
      { pattern: /\bdeploy\(|\bpublishRelease\b|\bcreateRelease\b/, label: "a deploy/release publication" },
    ];
    for (const relPath of M47_WU01_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const { pattern, label } of forbidden) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    }
  });
});

describe("M47-WU01: the state boundary is a separate, non-repository-local store", () => {
  it("pr-integration-home.ts never resolves into a target repository or into an .aiqt/ project directory of the current working directory", () => {
    const text = readFileSync(join(repoRoot, "src", "state", "pr-integration-home.ts"), "utf8");
    expect(text).toMatch(/homedir\(\)/);
    expect(text, "plans must never be stored relative to process.cwd()").not.toMatch(/process\.cwd\(\)/);
    expect(text, "plans must never reuse the repository-local .aiqt path owner").not.toMatch(/resolveAiqtPaths|AIQT_DIR_NAME/);
  });

  it("no WU47-01 file writes a parallel `.aiqt/pr*.json` state database (code only -- a doc comment naming what is deliberately NOT created does not itself violate this)", () => {
    for (const relPath of M47_WU01_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not reference a .aiqt/pr*.json path`).not.toMatch(/\.aiqt[/\\]pr[a-z-]*\.json/i);
    }
  });

  it("M47 does not change the canonical project-state schema version", () => {
    const text = readFileSync(join(repoRoot, "src", "core", "constants", "schema-version.ts"), "utf8");
    expect(text).toMatch(/AIQT_SCHEMA_VERSION = "0\.7\.0"/);
  });

  it("package.json declares no new runtime dependency for M47-WU01 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the AIQT repository root still has no .aiqt/ directory", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});
