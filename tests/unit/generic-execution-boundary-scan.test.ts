import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M27R section 2/9/12 (M27R-R02, R09, R18): every file this milestone
 * added or touched, scanned for a process/shell/PTY/network/auth/
 * permission-bypass/dynamic-adapter-loading surface. Scoped to exactly
 * the M27R file set (not the whole repository) so this cannot
 * false-positive on M25's pre-existing, separately reviewed Git command
 * runner or other legitimate process usage elsewhere in the codebase --
 * only M27R's own boundary claim is under test here.
 */
const M27R_FILES = [
  "src/cli/commands/execution-adapter-claude-code-import.command.ts",
  "src/cli/commands/execution-adapter-claude-code-request.command.ts",
  "src/cli/commands/execution-adapter-claude-code-status.command.ts",
  "src/cli/commands/execution-external-example.ts",
  "src/cli/commands/execution-external-import.command.ts",
  "src/cli/commands/execution-external-request.command.ts",
  "src/cli/commands/execution-external-status.command.ts",
  "src/cli/options.ts",
  "src/cli/register-commands.ts",
  "src/schema/adapter-registry.ts",
  "src/schema/execution-adapter-request.schema.ts",
  "src/schema/external-agent-ref.schema.ts",
  "src/schema/external-execution-request.schema.ts",
  "src/schema/external-execution-result.schema.ts",
  "src/schema/normalized-execution-result.schema.ts",
  "src/workflow/execution-adapter-request-identity.ts",
  "src/workflow/execution-adapter-review-findings.ts",
  "src/workflow/generic-request-resolution.ts",
  "src/workflow/generic-result-application-service.ts",
  "src/workflow/generic-session-identity.ts",
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
  { pattern: /\bimport\s*\(/, label: "dynamic import() (dynamic adapter loading)" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only; also blocks dynamic module loading)" },
];

describe("M27R boundary scan: no process/shell/PTY/network/auth/dynamic-loading surface", () => {
  for (const relPath of M27R_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("the request command's only node:crypto import is randomUUID", () => {
    for (const relPath of ["src/cli/commands/execution-external-request.command.ts", "src/cli/commands/execution-adapter-claude-code-request.command.ts"]) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      const match = text.match(/import\s*\{([^}]*)\}\s*from\s*"node:crypto"/);
      if (match) {
        const imported = match[1].split(",").map((s) => s.trim());
        expect(imported.every((i) => i === "randomUUID"), relPath).toBe(true);
      }
    }
  });

  it("package.json declares no new runtime dependency for M27R (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the static adapter registry is exactly two entries -- no dynamic registration surface exists in the schema layer", () => {
    const text = readFileSync(join(repoRoot, "src/schema/adapter-registry.ts"), "utf8");
    expect(text).not.toMatch(/\bregister\w*\s*\(/i);
    expect(text).not.toMatch(/\.push\(/);
  });
});
