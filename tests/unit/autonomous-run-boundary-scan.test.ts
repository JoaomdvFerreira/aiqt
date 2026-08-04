import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M36-WU01 (build spec: "no execution path can modify a repository
 * autonomously yet"; "architecture tests prevent accidental
 * enablement"): every file this Work Unit added is a pure contract/
 * decision module -- no process spawn, no network, no model call, no
 * dynamic code execution. Scoped to exactly the M36-WU01 file set (not
 * the whole codebase) so this cannot false-positive on M25's Git
 * command runner or other legitimate, separately-reviewed process usage
 * elsewhere -- only this Work Unit's own "still contract-only" claim is
 * under test here, matching the established M27/M27R/M28 boundary-scan
 * pattern.
 */
const M36_WU01_FILES = [
  "src/schema/autonomous-run.schema.ts",
  "src/workflow/autonomous-run-lifecycle.ts",
  "src/workflow/autonomous-run-safety-classifier.ts",
  "src/workflow/autonomous-run-budget.ts",
  "src/workflow/autonomous-run-command-policy.ts",
];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bchild_process\b/, label: "child_process (process spawning)" },
  { pattern: /\bnode:net\b/, label: "node:net" },
  { pattern: /\bnode:http\b/, label: "node:http" },
  { pattern: /\bnode:https\b/, label: "node:https" },
  { pattern: /\bnode:tls\b/, label: "node:tls" },
  { pattern: /\bnode:dgram\b/, label: "node:dgram" },
  { pattern: /\bnode:dns\b/, label: "node:dns" },
  { pattern: /\bnode-pty\b/, label: "node-pty (PTY)" },
  { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bWebSocket\b/, label: "WebSocket" },
  { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
  { pattern: /\beval\s*\(/, label: "eval() (dynamic code execution)" },
  { pattern: /new\s+Function\s*\(/, label: "new Function() (dynamic code execution)" },
  { pattern: /\bvm\.(Script|createContext|runIn)/, label: "node:vm sandboxed execution" },
  { pattern: /\bimport\s*\(/, label: "dynamic import()" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
  { pattern: /\bexecFileSync\b|\bspawnSync\b|\bexecFile\b|\bspawn\b|\bexecSync\b/, label: "a child_process execution function" },
  { pattern: /\bgitWorktreeAdd\b|\bgitWorktreeRemove\b/, label: "real worktree creation/removal (M25 git-command-runner)" },
  { pattern: /\bprepareIsolatedWorkspace\b|\breleaseIsolatedWorkspace\b/, label: "real workspace lifecycle orchestration (M25)" },
];

describe("M36-WU01 boundary scan: every added file is contract-only, no execution/network/model-invocation surface", () => {
  for (const relPath of M36_WU01_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("package.json declares no new runtime dependency for M36-WU01 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("no CLI command registers an autonomous/maintenance-runner surface yet (register-commands.ts / options.ts unchanged in that respect)", () => {
    const registerCommands = readFileSync(join(repoRoot, "src", "cli", "register-commands.ts"), "utf8");
    const options = readFileSync(join(repoRoot, "src", "cli", "options.ts"), "utf8");
    for (const text of [registerCommands, options]) {
      expect(text).not.toMatch(/autonomous/i);
      expect(text).not.toMatch(/maintenance.runner/i);
    }
  });

  it("no src/cli/commands file references 'autonomous' (no command surface exists to invoke a run yet)", () => {
    const commandsDir = join(repoRoot, "src", "cli", "commands");
    const offenders = readdirSync(commandsDir).filter((f) => {
      const text = readFileSync(join(commandsDir, f), "utf8");
      return /autonomous/i.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

/**
 * "no AIQT self-management path": AIQT's own workflow logic must never
 * spawn `aiqt` against its own repository, and this Work Unit's new
 * modules must never call any of the workspace/execution/checkpoint
 * orchestration functions that could, if wired to a real run, cause
 * AIQT to manage itself. Combined with the boundary scan above (no
 * process-spawn surface exists in the new files at all), this closes
 * both halves of the requirement: no capability to self-manage, and no
 * wiring that would invoke it even if the capability existed elsewhere.
 */
describe("M36-WU01: no AIQT self-management path exists", () => {
  it("none of the M36-WU01 files import any src/cli/commands/*.ts module (no CLI dispatch capability)", () => {
    for (const relPath of M36_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import a CLI command module`).not.toMatch(/from\s+["'].*cli\/commands/);
    }
  });

  it("none of the M36-WU01 files import src/workspaces/* (no workspace/worktree creation capability)", () => {
    for (const relPath of M36_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import a workspace module`).not.toMatch(/from\s+["'].*\/workspaces\//);
    }
  });

  it("the AIQT repository root has no .aiqt/ directory as a result of this Work Unit (this Work Unit added no code that could create one)", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M36-WU02 (build spec Sec "Scope": "repository preflight"; acceptance
 * criteria: "no workspace mutation occurs before approval"): unlike
 * WU36-01's files, autonomous-run-preflight.ts DOES import from
 * src/workspaces/ -- a deliberate, reviewed exception, since real
 * preflight requires real (but read-only) repository inspection. This
 * guard proves the exception stays exactly what it claims: read-only.
 */
const M36_WU02_SRC_FILES = ["src/workflow/autonomous-run-preflight.ts", "src/services/autonomous-candidate-intake-service.ts"];

const WU02_MUTATING_SURFACES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bgitWorktreeAdd\b|\bgitWorktreeRemove\b/, label: "real worktree creation/removal (M25 git-command-runner)" },
  { pattern: /\bprepareIsolatedWorkspace\b|\breleaseIsolatedWorkspace\b/, label: "real workspace lifecycle orchestration (M25)" },
  { pattern: /from\s+["'].*cli\/commands/, label: "a CLI command module import (no CLI dispatch capability)" },
  { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
  { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bfetch\s*\(/, label: "a network surface" },
  { pattern: /\beval\s*\(|new\s+Function\s*\(/, label: "dynamic code execution" },
];

/** Exactly the read-only Git functions autonomous-run-preflight.ts is allowed to call -- any OTHER git-command-runner export appearing in these files is unexpected and must be reviewed. */
const ALLOWED_GIT_FUNCTIONS = ["gitDiffQuietIsClean", "gitIsInsideWorkTree", "gitRevParse", "gitStatusPorcelain", "GitRunnerError"];

describe("M36-WU02 boundary scan: real repository preflight stays read-only, no workspace mutation before approval", () => {
  for (const relPath of M36_WU02_SRC_FILES) {
    it(`${relPath} contains no mutating/network/model-invocation/CLI-dispatch surface`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of WU02_MUTATING_SURFACES) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("autonomous-run-preflight.ts imports only the allowed read-only Git functions from git-command-runner.ts", () => {
    const text = readFileSync(join(repoRoot, "src", "workflow", "autonomous-run-preflight.ts"), "utf8");
    const importMatch = text.match(/import\s*\{([^}]*)\}\s*from\s*["'].*git-command-runner\.js["']/);
    expect(importMatch, "autonomous-run-preflight.ts should import from git-command-runner.js").not.toBeNull();
    const imported = importMatch![1].split(",").map((s) => s.trim());
    const unexpected = imported.filter((name) => !ALLOWED_GIT_FUNCTIONS.includes(name));
    expect(unexpected, `autonomous-run-preflight.ts imports unexpected git-command-runner exports: ${unexpected.join(", ")}`).toEqual([]);
  });

  it("neither WU36-02 file imports src/workspaces/workspace-service.ts, git-worktree-provider.ts, or workspace-operation-lock.ts (no orchestration/locking capability, only the one allowlisted read-only runner)", () => {
    for (const relPath of M36_WU02_SRC_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text).not.toMatch(/workspace-service\.js|git-worktree-provider\.js|workspace-operation-lock\.js/);
    }
  });

  it("no CLI command references 'autonomous' after WU36-02 either (re-verified, not just at WU36-01)", () => {
    const commandsDir = join(repoRoot, "src", "cli", "commands");
    const offenders = readdirSync(commandsDir).filter((f) => /autonomous/i.test(readFileSync(join(commandsDir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
