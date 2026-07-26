import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M28 section 2/7/12 (M28-R05/R09/R18): every file this milestone added or
 * touched, scanned for a process/shell/PTY/network/Git/validation-
 * execution/dynamic-policy-loading surface, and for any generated
 * permission-bypass-style surface. Scoped to exactly the M28 file set (not
 * the whole repository) so this cannot false-positive on pre-existing,
 * separately reviewed surfaces elsewhere in the codebase -- only M28's own
 * boundary claim is under test here.
 */
const M28_FILES = [
  "src/cli/commands/evidence-gate-policy-activate.command.ts",
  "src/cli/commands/evidence-gate-policy-import.command.ts",
  "src/cli/commands/evidence-gate-policy-list.command.ts",
  "src/cli/commands/evidence-gate-policy-show.command.ts",
  "src/cli/commands/evidence-gate-simulate.command.ts",
  "src/cli/commands/status.command.ts",
  "src/cli/options.ts",
  "src/cli/register-commands.ts",
  "src/schema/evidence-gate-policy.schema.ts",
  "src/schema/evidence-gate-simulation.schema.ts",
  "src/schema/state.schema.ts",
  "src/services/evidence-gate-policy-service.ts",
  "src/state/runlog-store.ts",
  "src/workflow/evidence-gate-digest.ts",
  "src/workflow/evidence-gate-policy-identity.ts",
  "src/workflow/evidence-gate-simulation-engine.ts",
  "src/workflow/evidence-gate-snapshot.ts",
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
  { pattern: /\bfetch\s*\(/, label: "fetch(" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bWebSocket\b/, label: "WebSocket" },
  { pattern: /\beval\s*\(/, label: "eval() (executable policy surface)" },
  { pattern: /new\s+Function\s*\(/, label: "new Function() (executable policy surface)" },
  { pattern: /\bvm\.(Script|createContext|runIn)/, label: "node:vm sandboxed execution (executable policy surface)" },
  { pattern: /dangerously-skip-permissions/, label: "dangerously-skip-permissions flag" },
  { pattern: /bypassPermissions/, label: "bypassPermissions flag" },
  { pattern: /\bimport\s*\(/, label: "dynamic import() (dynamic policy loading)" },
  { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only; also blocks dynamic module loading)" },
  { pattern: /git\s+(commit|push|checkout|merge)/i, label: "Git command invocation text" },
];

describe("M28 boundary scan: no process/shell/PTY/network/Git/validation-execution/dynamic-policy-loading surface", () => {
  for (const relPath of M28_FILES) {
    it(`${relPath} contains none of the forbidden surfaces`, () => {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("package.json declares no new runtime dependency for M28 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the policy schema contains no script/expression/regex/template evaluation field name", () => {
    const text = readFileSync(join(repoRoot, "src/schema/evidence-gate-policy.schema.ts"), "utf8");
    for (const forbidden of ["script", "expression", "template", "regex", "jsonpath", "xpath", "plugin"]) {
      expect(text.toLowerCase()).not.toMatch(new RegExp(`${forbidden}\\s*:`, "i"));
    }
  });

  it("the simulation engine never imports the runlog store, atomic-write helper, or state writer (structurally read-only)", () => {
    const text = readFileSync(join(repoRoot, "src/workflow/evidence-gate-simulation-engine.ts"), "utf8");
    expect(text).not.toMatch(/runlog-store|atomic-write|workflow-state-store|writeStateModel|appendRunlogEvent/);
  });
});
