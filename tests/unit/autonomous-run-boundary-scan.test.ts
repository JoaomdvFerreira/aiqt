import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
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

  // "No CLI command registers an autonomous/maintenance-runner surface
  // yet" and "no src/cli/commands file references 'autonomous'" were true
  // M36-WU01 invariants (re-verified through every M36 Work Unit above) --
  // M37-WU01 deliberately lifts exactly this invariant (build spec:
  // "public autonomous-run CLI"). Removed here rather than left to fail
  // silently; see this file's M37-WU01 section for the narrower invariant
  // that replaces it (the CLI exists, but never reaches the real M36
  // execution surface).
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

  // "No CLI command references 'autonomous'" was true through M36-WU05;
  // M37-WU01 deliberately lifts it (see this file's M37-WU01 section).
});

/**
 * M36-WU03 (build spec Sec 7 WU36-03 Scope: "worktree creation; command-
 * policy enforcement"; threat model Sec 3.1 "default-branch mutation" /
 * Sec 3.7 "arbitrary shell execution"): the first M36 Work Unit that
 * actually creates a worktree and executes a repair-adjacent command.
 * These 4 files are the entire real-execution surface; every other file
 * in the codebase remains exactly as constrained as WU36-01/02 left it.
 */
const M36_WU03_FILES = [
  "src/workflow/autonomous-run-branch-policy.ts",
  "src/workflow/autonomous-run-agent-adapter.ts",
  "src/workspaces/autonomous-worktree-lifecycle.ts",
  "src/workspaces/autonomous-command-runner.ts",
  "src/services/autonomous-run-execution-service.ts",
];

/** Exactly the git-command-runner exports autonomous-worktree-lifecycle.ts is allowed to call -- includes the 2-function mutating allowlist (gitWorktreeAdd/gitWorktreeRemove) plus 3 read-only checks, and nothing else. */
const ALLOWED_WORKTREE_LIFECYCLE_GIT_FUNCTIONS = ["gitWorktreeAdd", "gitWorktreeRemove", "gitIsInsideWorkTree", "gitCheckRefFormatBranch", "GitRunnerError"];

describe("M36-WU03 boundary scan: real worktree creation and command execution stay exactly as bounded as designed", () => {
  it("no M36-WU03 file references a model-invocation, network, or dynamic-code-execution surface", () => {
    const surfaces: { pattern: RegExp; label: string }[] = [
      { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
      { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bfetch\s*\(|\bWebSocket\b/, label: "a network surface" },
      { pattern: /\beval\s*\(|new\s+Function\s*\(|\bvm\.(Script|createContext|runIn)/, label: "dynamic code execution" },
      { pattern: /\bimport\s*\(/, label: "dynamic import()" },
      { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
    ];
    for (const relPath of M36_WU03_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of surfaces) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    }
  });

  it("no M36-WU03 file imports a CLI command module (no CLI dispatch capability -- still no command surface to invoke a run)", () => {
    for (const relPath of M36_WU03_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import a CLI command module`).not.toMatch(/from\s+["'].*cli\/commands/);
    }
  });

  it("autonomous-worktree-lifecycle.ts is the ONLY M36-WU03 file that imports gitWorktreeAdd/gitWorktreeRemove (the mutating allowlist stays confined to exactly one module)", () => {
    for (const relPath of M36_WU03_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      const usesMutating = /\bgitWorktreeAdd\b|\bgitWorktreeRemove\b/.test(text);
      if (relPath === "src/workspaces/autonomous-worktree-lifecycle.ts") {
        expect(usesMutating, `${relPath} should import the mutating worktree functions`).toBe(true);
      } else {
        expect(usesMutating, `${relPath} should NOT import the mutating worktree functions`).toBe(false);
      }
    }
  });

  it("autonomous-worktree-lifecycle.ts imports only the allowed git-command-runner exports", () => {
    const text = readFileSync(join(repoRoot, "src", "workspaces", "autonomous-worktree-lifecycle.ts"), "utf8");
    const importMatch = text.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/git-command-runner\.js["']/);
    expect(importMatch, "autonomous-worktree-lifecycle.ts should import from ./git-command-runner.js").not.toBeNull();
    const imported = importMatch![1].split(",").map((s) => s.trim());
    const unexpected = imported.filter((name) => !ALLOWED_WORKTREE_LIFECYCLE_GIT_FUNCTIONS.includes(name));
    expect(unexpected, `autonomous-worktree-lifecycle.ts imports unexpected git-command-runner exports: ${unexpected.join(", ")}`).toEqual([]);
  });

  it("autonomous-command-runner.ts never sets shell: true anywhere (the one real command-execution call site stays shell-free, matching git-command-runner.ts's own established pattern)", () => {
    const text = readFileSync(join(repoRoot, "src", "workspaces", "autonomous-command-runner.ts"), "utf8");
    expect(text).toMatch(/shell:\s*false/);
    expect(text).not.toMatch(/shell:\s*true/);
  });

  it("autonomous-command-runner.ts exposes no generic string-command passthrough (execFileSync's first two arguments are always the structured request's own command/args fields, never a caller-supplied joined string)", () => {
    const text = readFileSync(join(repoRoot, "src", "workspaces", "autonomous-command-runner.ts"), "utf8");
    expect(text).toMatch(/execFileSync\(request\.command,\s*\[\.\.\.request\.args\]/);
  });

  it("no function anywhere in the M36-WU03 call graph can merge a branch (structural check: no git-merge invocation or gitMerge-style function, comments excluded)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of M36_WU03_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a git merge or a merge-capable function`).not.toMatch(/["'`]merge["'`]|\.merge\(|gitMerge/i);
    }
  });

  // "No CLI command references 'autonomous'" was true through M36-WU05;
  // M37-WU01 deliberately lifts it (see this file's M37-WU01 section).

  it("the AIQT repository root still has no .aiqt/ directory as a result of any M36 Work Unit so far", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M36-WU04 (build spec Sec 7 WU36-04 Scope: "diff limits; changed-file
 * checks; targeted validation; authoritative validation integration;
 * self-review; evidence packet assembly"). None of these 6 files spawn a
 * new execution surface -- diff-summary.ts and self-review.ts perform no
 * process execution at all (self-review is pure; diff-summary only calls
 * git-command-runner.ts's already-reviewed read-only exports), and
 * validation-service.ts / evidence-binding-service.ts only reuse WU36-03's
 * already-bounded runAutonomousCommand/runAutonomousCommandLoop, never
 * calling execFileSync or the mutating git-worktree functions directly.
 */
const M36_WU04_FILES = [
  "src/workflow/autonomous-run-diff-summary.ts",
  "src/services/autonomous-run-validation-service.ts",
  "src/workflow/autonomous-run-self-review.ts",
  "src/services/autonomous-run-evidence-binding-service.ts",
  "src/services/autonomous-run-command-result.ts",
];

describe("M36-WU04 boundary scan: diff/validation/review/evidence-binding stay within WU36-03's already-bounded execution surface", () => {
  it("no M36-WU04 file references a model-invocation, network, or dynamic-code-execution surface", () => {
    const surfaces: { pattern: RegExp; label: string }[] = [
      { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
      { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bfetch\s*\(|\bWebSocket\b/, label: "a network surface" },
      { pattern: /\beval\s*\(|new\s+Function\s*\(|\bvm\.(Script|createContext|runIn)/, label: "dynamic code execution" },
      { pattern: /\bimport\s*\(/, label: "dynamic import()" },
      { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
    ];
    for (const relPath of M36_WU04_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of surfaces) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    }
  });

  it("no M36-WU04 file imports a CLI command module (no CLI dispatch capability -- still no command surface to invoke a run)", () => {
    for (const relPath of M36_WU04_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import a CLI command module`).not.toMatch(/from\s+["'].*cli\/commands/);
    }
  });

  it("none of the M36-WU04 files import node:child_process directly (diff-summary and self-review perform no process execution at all; validation/evidence-binding only go through the already-reviewed WU36-03 runner, never spawning a process themselves)", () => {
    for (const relPath of M36_WU04_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import node:child_process`).not.toMatch(/from\s+["']node:child_process["']/);
    }
  });

  it("none of the M36-WU04 files import gitWorktreeAdd/gitWorktreeRemove directly -- worktree mutation stays confined to autonomous-worktree-lifecycle.ts alone, even for the evidence-binding service that triggers cleanup", () => {
    for (const relPath of M36_WU04_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import the mutating worktree functions directly`).not.toMatch(/\bgitWorktreeAdd\b|\bgitWorktreeRemove\b/);
    }
  });

  it("autonomous-run-self-review.ts performs no I/O at all (no fs, no child_process, no git-command-runner import) -- a pure evaluator over already-collected evidence", () => {
    const text = readFileSync(join(repoRoot, "src", "workflow", "autonomous-run-self-review.ts"), "utf8");
    expect(text).not.toMatch(/from\s+["']node:fs["']|from\s+["']node:child_process["']|git-command-runner\.js/);
  });

  it("no function anywhere in the M36-WU04 call graph can merge a branch (structural check: no git-merge invocation or gitMerge-style function, comments excluded)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of M36_WU04_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a git merge or a merge-capable function`).not.toMatch(/["'`]merge["'`]|\.merge\(|gitMerge/i);
    }
  });

  it("evidence-binding-service.ts calls removeAutonomousWorktree (the WU36-03 wrapper) exactly once in a finally block, never gitWorktreeRemove directly", () => {
    const text = readFileSync(join(repoRoot, "src", "services", "autonomous-run-evidence-binding-service.ts"), "utf8");
    expect(text).toMatch(/removeAutonomousWorktree/);
    expect(text).not.toMatch(/\bgitWorktreeRemove\b/);
  });

  // "No CLI command references 'autonomous'" was true through M36-WU05;
  // M37-WU01 deliberately lifts it (see this file's M37-WU01 section).

  it("the AIQT repository root still has no .aiqt/ directory as a result of any M36 Work Unit so far", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M36-WU05 (build spec Sec 7 WU36-05 Scope: "dogfood pilot, recovery, and
 * closure"; acceptance criterion: "AIQT repository never self-managed by
 * the runner"). WU36-05 added no new src/ files -- the dogfood pilot
 * (tests/integration/autonomous-run-dogfood-pilot.test.ts) exercises the
 * already-reviewed WU36-01..04 pipeline end-to-end against a disposable,
 * non-AIQT target repository. This guard is the structural half of the
 * self-management proof; the dogfood suite's own "AIQT repository is
 * never self-managed" test is the behavioral half (asserts the target
 * directory is never this repository's own working tree and no .aiqt/
 * appears here as a result of running it).
 */
describe("M36-WU05: closure -- still no .aiqt/ as a result of any M36 Work Unit", () => {
  // "No CLI command references 'autonomous'" was a true M36-closure
  // invariant (re-verified after every M36 Work Unit above) -- M37-WU01
  // deliberately and explicitly lifts exactly that invariant (build spec:
  // "public autonomous-run CLI"), so this file's M37-WU01 section below
  // asserts the NARROWER invariant that actually still holds after
  // M37-WU01: the new CLI commands exist, but none of them reaches the
  // real M36 execution surface (worktree creation, command execution, a
  // model). Removing the now-obsolete blanket "no CLI references
  // autonomous" assertion here rather than leaving it to fail silently
  // documents the change explicitly, matching this codebase's established
  // "record a correction honestly" pattern.
  it("the AIQT repository root has no .aiqt/ directory at the close of M36", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M37-WU01 (build spec: "Public CLI and Operator Configuration Contract";
 * operating constraints: "do not invoke a coding model," "do not execute
 * autonomous code changes," "do not create a real autonomous worktree,"
 * "do not add network access," "do not add merge, push, or deployment
 * behavior"). The public `aiqt autonomous ...` CLI now exists -- these
 * guards prove it never reaches the real M36 execution surface, never
 * invokes a model, and never merges/pushes, even though the command
 * surface itself is now real and public.
 */
const M37_WU01_CLI_FILES = [
  "src/cli/commands/autonomous-shared.ts",
  "src/cli/commands/autonomous-inspect.command.ts",
  "src/cli/commands/autonomous-classify.command.ts",
  "src/cli/commands/autonomous-approve.command.ts",
  "src/cli/commands/autonomous-run.command.ts",
  "src/cli/commands/autonomous-status.command.ts",
  "src/cli/commands/autonomous-cancel.command.ts",
  "src/cli/commands/autonomous-result.command.ts",
  "src/cli/commands/autonomous-cleanup.command.ts",
];

const M37_WU01_SERVICE_FILES = [
  "src/schema/autonomous-run-operator.schema.ts",
  "src/schema/autonomous-run-record.schema.ts",
  "src/workflow/autonomous-run-config-resolution.ts",
  "src/services/autonomous-run-operator-config-file.ts",
  "src/workflow/autonomous-run-approval.ts",
  "src/services/autonomous-run-store.ts",
  "src/workflow/autonomous-run-self-management-guard.ts",
  "src/services/autonomous-run-simulation-service.ts",
];

const M37_WU01_FILES = [...M37_WU01_CLI_FILES, ...M37_WU01_SERVICE_FILES];

/**
 * The real M36 execution surface -- none of it may be imported or
 * referenced by any M37-WU01 file. This is the direct, structural proof
 * behind "do not create a real autonomous worktree" / "do not execute
 * autonomous code changes": `aiqt autonomous run` (autonomous-run.command.ts)
 * is the one command an operator might expect to do real work, and this
 * guard proves it cannot reach any of these functions even transitively
 * through this file list.
 */
const FORBIDDEN_REAL_EXECUTION_SYMBOLS = [
  "produceAutonomousEvidencePacket",
  "executeAutonomousRun",
  "runAutonomousCommandLoop",
  "createAutonomousWorktree",
  "removeAutonomousWorktree",
  "gitWorktreeAdd",
  "gitWorktreeRemove",
  "runAutonomousCommand",
  "DeterministicStubAgentAdapter",
];

describe("M37-WU01 boundary scan: public CLI never reaches the real M36 execution surface, no model/network/merge path", () => {
  it("no M37-WU01 file references any real M36 execution-surface symbol (code only -- a doc comment naming what is deliberately NOT called does not itself violate this)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of M37_WU01_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const symbol of FORBIDDEN_REAL_EXECUTION_SYMBOLS) {
        expect(text.includes(symbol), `${relPath} unexpectedly references real M36 execution symbol: ${symbol}`).toBe(false);
      }
    }
  });

  it("no M37-WU01 file references a model-invocation, network, or dynamic-code-execution surface", () => {
    const surfaces: { pattern: RegExp; label: string }[] = [
      { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
      { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bfetch\s*\(|\bWebSocket\b/, label: "a network surface" },
      { pattern: /\beval\s*\(|new\s+Function\s*\(|\bvm\.(Script|createContext|runIn)/, label: "dynamic code execution" },
      { pattern: /\bimport\s*\(/, label: "dynamic import()" },
      { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
      { pattern: /\bexecFileSync\b|\bspawnSync\b|\bexecFile\b|\bspawn\b|\bexecSync\b/, label: "a child_process execution function" },
    ];
    for (const relPath of M37_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of surfaces) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    }
  });

  it("no function anywhere in the M37-WU01 call graph can merge, push, or deploy a branch (structural check, comments excluded)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of M37_WU01_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a git merge/push/deploy or a merge/push/deploy-capable function`).not.toMatch(
        /["'`]merge["'`]|\.merge\(|gitMerge|["'`]push["'`]|\.push\(\s*origin|gitPush|\bdeploy\(/i,
      );
    }
  });

  // "autonomous-run.command.ts requires --simulate and never defaults to
  // a real-execution path" was a true WU37-01 invariant (this file's own
  // literal `if (!options.simulate)` fail-closed refusal). M37-WU03
  // deliberately replaces that refusal with the real (request/import,
  // still-no-worktree) orchestration path -- see this file's WU37-03
  // section below for the invariant that replaces it.

  it("autonomous-inspect.command.ts and autonomous-classify.command.ts both call the self-management guard before using a repository path", () => {
    for (const relPath of ["src/cli/commands/autonomous-inspect.command.ts", "src/cli/commands/autonomous-classify.command.ts"]) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should call isAiqtOwnRepository`).toMatch(/isAiqtOwnRepository/);
    }
  });

  it("package.json declares no new runtime dependency for M37-WU01 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the AIQT repository root still has no .aiqt/ directory as a result of the M37-WU01 CLI existing (structural -- behavioral proof is in the integration tests)", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M37-WU02 (build spec: "Bounded Coding-Agent Adapter"; operating
 * decision recorded in docs/engineering/m37-wu02-agent-adapter-design-
 * note.md: the request/import pattern, AIQT never spawns the agent
 * process itself). This is THE critical guard for this Work Unit: it
 * structurally proves the design-note decision was actually followed,
 * not merely described in a doc comment -- no file in this Work Unit
 * spawns a subprocess, touches the network, or invokes a model SDK.
 */
const M37_WU02_FILES = [
  "src/schema/autonomous-agent-request.schema.ts",
  "src/workflow/autonomous-agent-request-builder.ts",
  "src/workflow/autonomous-agent-request-lifecycle.ts",
  "src/services/autonomous-agent-response-import-service.ts",
  "src/services/autonomous-agent-response-import-result.ts",
];

describe("M37-WU02 boundary scan: the coding-agent adapter never spawns a process itself (request/import pattern, not live execution)", () => {
  it("no M37-WU02 file references a process-spawn, network, model-invocation, or dynamic-code-execution surface (code only -- a doc comment explaining what is deliberately NOT called does not itself violate this)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    const surfaces: { pattern: RegExp; label: string }[] = [
      { pattern: /\bexecFileSync\b|\bspawnSync\b|\bexecFile\b|\bspawn\b|\bexecSync\b/, label: "a child_process execution function" },
      { pattern: /from\s+["']node:child_process["']/, label: "node:child_process import" },
      { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
      { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bfetch\s*\(|\bWebSocket\b/, label: "a network surface" },
      { pattern: /\beval\s*\(|new\s+Function\s*\(|\bvm\.(Script|createContext|runIn)/, label: "dynamic code execution" },
      { pattern: /\bimport\s*\(/, label: "dynamic import()" },
      { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
    ];
    for (const relPath of M37_WU02_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const { pattern, label } of surfaces) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    }
  });

  it("importing an agent response never executes a proposed command -- no function in this Work Unit calls runAutonomousCommand, executeAutonomousRun, or produceAutonomousEvidencePacket", () => {
    const forbidden = ["runAutonomousCommand", "executeAutonomousRun", "produceAutonomousEvidencePacket", "createAutonomousWorktree", "gitWorktreeAdd"];
    for (const relPath of M37_WU02_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const symbol of forbidden) {
        expect(text.includes(symbol), `${relPath} unexpectedly references execution symbol: ${symbol}`).toBe(false);
      }
    }
  });

  it("environment projection defaults to empty and is never a full process.env spread", () => {
    const text = readFileSync(join(repoRoot, "src", "workflow", "autonomous-agent-request-builder.ts"), "utf8");
    expect(text).not.toMatch(/\.\.\.process\.env/);
  });

  it("only one fixed provider id exists -- no arbitrary provider plugin surface (build spec Sec 5 Out of Scope)", () => {
    const text = readFileSync(join(repoRoot, "src", "schema", "autonomous-agent-request.schema.ts"), "utf8");
    expect(text).toMatch(/AUTONOMOUS_AGENT_PROVIDER_ID\s*=\s*"external-coding-agent-manual@1"/);
    expect(text).not.toMatch(/providerId:\s*z\.string\(\)/); // must be a fixed literal, not a free-form string
  });

  // "No CLI command wires the agent adapter yet" was a true WU37-02
  // invariant -- M37-WU03 deliberately lifts it (see this file's
  // M37-WU03 section below).

  it("no function anywhere in the M37-WU02 call graph can merge, push, or deploy", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of M37_WU02_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a git merge/push/deploy or a merge/push/deploy-capable function`).not.toMatch(
        /["'`]merge["'`]|\.merge\(|gitMerge|["'`]push["'`]|\.push\(\s*origin|gitPush|\bdeploy\(/i,
      );
    }
  });

  it("the AIQT repository root still has no .aiqt/ directory as a result of the M37-WU02 adapter existing", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M37-WU03 (build spec: "End-to-End CLI Orchestration and Resumability").
 * This is the first Work Unit in which any CLI command performs a real
 * `git worktree add`/executes a real command -- deliberately, via
 * M36-WU04's already-reviewed produceAutonomousEvidencePacket, invoked
 * from exactly one command file (autonomous-agent-import.command.ts).
 * These guards prove the real-execution surface stays confined to that
 * one file, no other M37 command reaches it directly, and every other
 * established invariant (self-management guard, no merge/push, no new
 * runtime dependency) still holds.
 */
const M37_WU03_REAL_EXECUTION_FILE = "src/cli/commands/autonomous-agent-import.command.ts";

const M37_WU03_NON_EXECUTION_FILES = [
  "src/cli/commands/autonomous-classify.command.ts",
  "src/cli/commands/autonomous-run.command.ts",
  "src/cli/commands/autonomous-cancel.command.ts",
  "src/cli/commands/autonomous-cleanup.command.ts",
  "src/services/autonomous-agent-request-store.ts",
  "src/workflow/autonomous-imported-response-agent-adapter.ts",
];

describe("M37-WU03 boundary scan: real worktree creation/command execution stays confined to exactly one command file", () => {
  it("produceAutonomousEvidencePacket/createAutonomousWorktree/runAutonomousCommand are referenced ONLY by autonomous-agent-import.command.ts, never by any other M37 command file (code only -- a doc comment explaining what is deliberately NOT called does not itself violate this)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    const realExecutionSymbols = ["produceAutonomousEvidencePacket", "createAutonomousWorktree", "runAutonomousCommand", "gitWorktreeAdd", "gitWorktreeRemove"];
    const importText = readFileSync(join(repoRoot, M37_WU03_REAL_EXECUTION_FILE), "utf8");
    expect(importText).toMatch(/produceAutonomousEvidencePacket/);

    for (const relPath of M37_WU03_NON_EXECUTION_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const symbol of realExecutionSymbols) {
        expect(text.includes(symbol), `${relPath} unexpectedly references real-execution symbol: ${symbol}`).toBe(false);
      }
    }
  });

  it("autonomous-imported-response-agent-adapter.ts never invokes a model, network, or dynamic-code-execution surface -- it only replays an already-imported command list", () => {
    const text = readFileSync(join(repoRoot, "src", "workflow", "autonomous-imported-response-agent-adapter.ts"), "utf8");
    const surfaces = [/@anthropic-ai\//, /\bfetch\s*\(/, /\bexecFileSync\b|\bspawnSync\b|\bexecFile\b|\bspawn\b|\bexecSync\b/, /\beval\s*\(/];
    for (const pattern of surfaces) expect(pattern.test(text)).toBe(false);
  });

  it("autonomous-run.command.ts's real (non-simulate) path never itself creates a worktree or executes a command -- it only builds and persists an agent request (code only)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    const text = codeOnly(readFileSync(join(repoRoot, "src", "cli", "commands", "autonomous-run.command.ts"), "utf8"));
    expect(text).toMatch(/buildAutonomousAgentRequest/);
    expect(text).not.toMatch(/produceAutonomousEvidencePacket|createAutonomousWorktree|runAutonomousCommand/);
  });

  it("autonomous-agent-import.command.ts and autonomous-run.command.ts both call the self-management guard before real execution / real request creation", () => {
    for (const relPath of [M37_WU03_REAL_EXECUTION_FILE, "src/cli/commands/autonomous-run.command.ts"]) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should call isAiqtOwnRepository`).toMatch(/isAiqtOwnRepository/);
    }
  });

  it("autonomous-agent-import.command.ts refuses a non-absolute worktreeRoot before any real execution occurs", () => {
    const text = readFileSync(join(repoRoot, M37_WU03_REAL_EXECUTION_FILE), "utf8");
    expect(text).toMatch(/isAbsolute\(config\.worktreeRoot\)/);
  });

  it("no function anywhere in the M37-WU03 call graph can merge, push, or deploy (structural check, comments excluded)", () => {
    const codeOnly = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
        .join("\n");
    for (const relPath of [M37_WU03_REAL_EXECUTION_FILE, ...M37_WU03_NON_EXECUTION_FILES]) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a git merge/push/deploy or a merge/push/deploy-capable function`).not.toMatch(
        /["'`]merge["'`]|\.merge\(|gitMerge|["'`]push["'`]|\.push\(\s*origin|gitPush|\bdeploy\(/i,
      );
    }
  });

  it("package.json declares no new runtime dependency for M37-WU03 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the AIQT repository root still has no .aiqt/ directory as a result of the M37-WU03 real-execution wiring existing", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});
