import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const commandsDir = join(repoRoot, "src", "cli", "commands");

/**
 * M34-WU03 (LOW-014): the `execution-adapter-claude-code-*` and
 * `execution-import.command.ts` command files are discovered dynamically --
 * readdirSync over src/cli/commands/ -- rather than trusted to stay correct
 * in a frozen literal. A file matching this domain's naming convention
 * added after M27 closed now makes the drift-detector test below fail
 * loudly (forcing a reviewed addition to M27_FILES/FORBIDDEN_PATTERNS
 * scanning) instead of silently never being scanned. The non-command files
 * below (schema, workflow, state, options/register-commands) are not
 * filename-convention discoverable the same way and remain a reviewed
 * static list.
 */
function listExecutionAdapterCommandFiles(): string[] {
  return readdirSync(commandsDir)
    .filter((f) => f.startsWith("execution-adapter-claude-code-") || f === "execution-import.command.ts")
    .sort()
    .map((f) => join("src", "cli", "commands", f).replace(/\\/g, "/"));
}

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

describe("M34-WU03: execution-adapter-claude-code-*/execution-import command files cannot silently escape the M27 boundary scan (LOW-014)", () => {
  it("the dynamically discovered set of execution-adapter-claude-code-*/execution-import.command.ts files matches the reviewed M27_FILES baseline exactly", () => {
    const discovered = listExecutionAdapterCommandFiles();
    const reviewedCommandFiles = M27_FILES.filter((f) => discovered.includes(f)).sort();
    expect(
      discovered,
      "A file matching the execution-adapter-claude-code-*/execution-import.command.ts naming convention " +
        "was added to or removed from src/cli/commands/ since M27 closed. Update M27_FILES (and its " +
        "FORBIDDEN_PATTERNS scan coverage) as part of a reviewed change -- do not let a new file in this " +
        "domain silently skip the boundary scan.",
    ).toEqual(reviewedCommandFiles);
  });
});
