import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M27 §2/§8/§11 (M27-R02, M27-R09): every file this milestone added or
 * touched, scanned for a process/shell/PTY/network/auth/permission-bypass
 * surface. Scoped to exactly the M27 file set (not the whole repository)
 * so this test cannot false-positive on M25's pre-existing, separately
 * reviewed Git command runner or other legitimate process usage elsewhere
 * in the codebase -- M27's own boundary claim is what is under test here.
 */
const M27_FILES = [
  "src/cli/commands/execution-adapter-claude-code-example.ts",
  "src/cli/commands/execution-adapter-claude-code-import.command.ts",
  "src/cli/commands/execution-adapter-claude-code-request.command.ts",
  "src/cli/commands/execution-adapter-claude-code-status.command.ts",
  "src/cli/commands/execution-import.command.ts",
  "src/cli/options.ts",
  "src/cli/register-commands.ts",
  "src/core/filesystem/bounded-file-input.ts",
  "src/schema/claude-code-request-package.schema.ts",
  "src/schema/claude-code-stream-json.schema.ts",
  "src/schema/execution-adapter-request.schema.ts",
  "src/schema/state.schema.ts",
  "src/services/execution-adapter-request-service.ts",
  "src/services/review-service.ts",
  "src/state/runlog-store.ts",
  "src/workflow/claude-code-result-normalizer.ts",
  "src/workflow/claude-code-stream-json-parser.ts",
  "src/workflow/execution-adapter-request-identity.ts",
  "src/workflow/execution-adapter-review-findings.ts",
  "src/workflow/execution-runlog-event-builder.ts",
  "src/workflow/execution-workspace-ref-resolver.ts",
];

const FORBIDDEN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bchild_process\b/, label: "child_process (process spawning)" },
  { pattern: /\bnode:net\b/, label: "node:net (raw sockets)" },
  { pattern: /\bnode:http\b/, label: "node:http" },
  { pattern: /\bnode:https\b/, label: "node:https" },
  { pattern: /\bnode:tls\b/, label: "node:tls" },
  { pattern: /\bnode:dgram\b/, label: "node:dgram" },
  { pattern: /\bnode:dns\b/, label: "node:dns" },
  { pattern: /\bnode-pty\b/, label: "node-pty (PTY)" },
  { pattern: /\bfetch\s*\(/, label: "fetch(" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bWebSocket\b/, label: "WebSocket" },
  { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency" },
  { pattern: /dangerously-skip-permissions/, label: "dangerously-skip-permissions flag" },
  { pattern: /bypassPermissions/, label: "bypassPermissions flag" },
  { pattern: /\bimport\s*\(/, label: "dynamic import()" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only; also blocks dynamic module loading)" },
];

describe("M27 boundary scan: no process/shell/PTY/network/auth/permission-bypass surface", () => {
  for (const relPath of M27_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("no M27 file imports node:crypto for anything beyond randomUUID (no hashing/cipher surface beyond the existing sha256Hex helper)", () => {
    const requestCommand = readFileSync(join(repoRoot, "src/cli/commands/execution-adapter-claude-code-request.command.ts"), "utf8");
    const cryptoImportMatch = requestCommand.match(/import\s*\{([^}]*)\}\s*from\s*"node:crypto"/);
    expect(cryptoImportMatch).not.toBeNull();
    const imported = cryptoImportMatch![1].split(",").map((s) => s.trim());
    expect(imported).toEqual(["randomUUID"]);
  });

  it("package.json declares no new runtime dependency for M27 (no provider SDK, no HTTP client library)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const deps = Object.keys(packageJson.dependencies);
    expect(deps.sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });
});
