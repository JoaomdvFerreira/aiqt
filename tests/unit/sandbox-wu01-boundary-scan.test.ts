import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M38-WU01 (build spec: "WU38-01 is threat-model, platform-decision,
 * capability-contract, and pure architecture work only... Do not: launch
 * a coding agent; add execFile or spawn for live execution; create
 * containers or namespaces; configure mounts or network; run privileged
 * commands; claim cwd is a sandbox"). Every file this Work Unit added is
 * a pure contract/decision/policy-validation module -- no process spawn,
 * no container, no namespace, no network, no dynamic code execution.
 * Scoped to exactly the M38-WU01 file set, mirroring the exact pattern
 * tests/unit/autonomous-run-boundary-scan.test.ts established for
 * M36-WU01.
 */
const M38_WU01_FILES = [
  "src/schema/sandbox-backend.schema.ts",
  "src/workflow/sandbox-backend-contract.ts",
  "src/workflow/sandbox-platform-decision.ts",
  "src/workflow/sandbox-capability-evaluation.ts",
  "src/workflow/sandbox-fallback-policy.ts",
  "src/workflow/sandbox-filesystem-policy.ts",
  "src/workflow/sandbox-environment-policy.ts",
  "src/workflow/sandbox-network-policy.ts",
  "src/workflow/sandbox-process-policy.ts",
  "src/workflow/sandbox-resource-policy.ts",
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
  { pattern: /\bdockerode\b|\bDockerode\b/, label: "a container-runtime client library" },
  { pattern: /\bgitWorktreeAdd\b|\bgitWorktreeRemove\b/, label: "real worktree creation/removal (M25 git-command-runner)" },
  { pattern: /\brunAutonomousCommand\b/, label: "real bare command execution (M36)" },
  { pattern: /\bImportedResponseAgentAdapter\b/, label: "the M37 request/import execution adapter (this Work Unit must not touch M37's real execution path)" },
];

/** Strips comment-only lines before the regex check runs, so a doc comment that (correctly) names a forbidden pattern in prose -- explaining what must NOT be done -- does not itself trip the guard. Mirrors the established M36/M37 codeOnly() pattern. */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**");
    })
    .join("\n");
}

describe("M38-WU01 boundary scan: every added file is contract-only, no execution/network/container/model-invocation surface", () => {
  for (const relPath of M38_WU01_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const code = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(code), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("package.json declares no new runtime dependency for M38-WU01 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("no M38-WU01 file imports any src/cli/commands/*.ts module (no CLI dispatch capability, no AIQT self-management path)", () => {
    for (const relPath of M38_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} must not import a CLI command module`).not.toMatch(/from\s+["'].*\/cli\/commands\//);
    }
  });

  it("no M38-WU01 file references any M36/M37 real execution surface (gitWorktreeAdd/gitWorktreeRemove/runAutonomousCommand/produceAutonomousEvidencePacket)", () => {
    for (const relPath of M38_WU01_FILES) {
      const code = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(code).not.toMatch(/\bproduceAutonomousEvidencePacket\b/);
    }
  });
});

/**
 * "Guard against cwd-only live execution": the backend contract must
 * never offer a bare working-directory string as the mechanism for
 * "where a command runs" -- every process-launch-shaped type must key
 * off an opaque SandboxHandle instead (build spec Sec 2: "cwd ... is not
 * sandboxing"). Checked structurally (no `cwd` field declaration or
 * `process.cwd()` call anywhere in the contract), not just by prose
 * convention.
 */
describe("M38-WU01: guard against cwd-only live execution", () => {
  it("sandbox-backend-contract.ts declares no `cwd` field on any request/result type", () => {
    const code = codeOnly(readFileSync(join(repoRoot, "src/workflow/sandbox-backend-contract.ts"), "utf8"));
    expect(code).not.toMatch(/\bcwd\s*[:?]/);
  });

  it("no M38-WU01 file calls process.cwd()", () => {
    for (const relPath of M38_WU01_FILES) {
      const code = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(code, `${relPath} must not call process.cwd()`).not.toMatch(/process\.cwd\(/);
    }
  });

  it("SandboxProcessLaunchRequest is keyed by an opaque SandboxHandle, not a filesystem path", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/sandbox-backend-contract.ts"), "utf8");
    const match = text.match(/export interface SandboxProcessLaunchRequest \{([\s\S]*?)\}/);
    expect(match, "SandboxProcessLaunchRequest interface not found").not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/handle:\s*SandboxHandle/);
    expect(body).not.toMatch(/\bpath\s*:/i);
  });
});

/**
 * "Guard against live-process symbols in WU38-01": no symbol this Work
 * Unit defines may itself be an implementer of SandboxBackend (which
 * would imply a real, callable backend exists) -- the interface must
 * have zero classes implementing it anywhere in the repository yet.
 */
describe("M38-WU01: guard against live-process symbols", () => {
  it("no class anywhere in src/ implements SandboxBackend", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/sandbox-backend-contract.ts"), "utf8");
    expect(text).not.toMatch(/class\s+\w+\s+implements\s+SandboxBackend/);
  });

  it("sandbox-backend-contract.ts defines interfaces/types only -- no exported class, no function with a runtime body", () => {
    const code = codeOnly(readFileSync(join(repoRoot, "src/workflow/sandbox-backend-contract.ts"), "utf8"));
    expect(code).not.toMatch(/\bclass\b/);
    expect(code).not.toMatch(/\bfunction\b/);
  });
});

/**
 * "No AIQT self-management": reused directly from M37 --
 * isAiqtOwnRepository must be the guard sandbox-filesystem-policy.ts
 * calls, not a reimplementation, and it must be called unconditionally
 * for every mount, not only the worktree mount.
 */
describe("M38-WU01: no AIQT self-management path exists", () => {
  it("sandbox-filesystem-policy.ts imports and calls the existing M37 isAiqtOwnRepository guard, not a new reimplementation", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/sandbox-filesystem-policy.ts"), "utf8");
    expect(text).toMatch(/import\s*\{\s*isAiqtOwnRepository\s*\}\s*from\s*["']\.\/autonomous-run-self-management-guard\.js["']/);
    expect(text).toMatch(/isAiqtOwnRepository\(/);
  });
});
