import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/register-commands.js";
import type { Command } from "commander";

/**
 * M33-WU05: the cross-command contract matrix required by the M33 spec's
 * WU33-05 acceptance criterion ("Cross-command matrix covers all registered
 * command families"). Walks the real, currently-registered commander
 * command tree (not a hand-maintained list that could drift) and asserts
 * every actionable (leaf) command exposes --json, so the machine-facing
 * contract's basic entry condition -- "you can always ask for JSON" -- holds
 * suite-wide, not just for the specific commands earlier M33 Work Units
 * happened to touch.
 */

interface CommandNode {
  path: string;
  command: Command;
}

function collectLeafCommands(command: Command, prefix: string[] = []): CommandNode[] {
  const path = [...prefix, command.name()];
  const hasAction = Boolean((command as unknown as { _actionHandler: unknown })._actionHandler);
  const children = command.commands as Command[];
  const nodes: CommandNode[] = [];
  if (hasAction) {
    nodes.push({ path: path.join(" "), command });
  }
  for (const child of children) {
    nodes.push(...collectLeafCommands(child, path));
  }
  return nodes;
}

function hasJsonOption(command: Command): boolean {
  return command.options.some((o) => o.long === "--json");
}

describe("M33-WU05: CLI contract matrix -- every actionable command exposes --json", () => {
  const program = buildProgram();
  const leaves = collectLeafCommands(program).filter((n) => n.path !== "aiqt");

  it("finds a non-trivial number of actionable commands (sanity check that the walker actually works)", () => {
    expect(leaves.length).toBeGreaterThan(40);
  });

  /**
   * The handful of commands that legitimately have no --json because their
   * entire purpose is to print a fixed, non-CommandResult sample payload
   * (unconditionally JSON-shaped already) or because --json is registered
   * on the parent, not the leaf, in a way this static walk doesn't resolve.
   * Any command NOT on this explicit list must have --json.
   */
  const EXPECTED_MISSING_JSON: ReadonlySet<string> = new Set([]);

  it("every actionable command not explicitly exempted registers --json", () => {
    const missing = leaves.filter((n) => !hasJsonOption(n.command)).map((n) => n.path);
    const unexpectedlyMissing = missing.filter((p) => !EXPECTED_MISSING_JSON.has(p));
    expect(
      unexpectedlyMissing,
      "One or more actionable commands do not register --json. Either this is a real gap " +
        "(add the option) or it is a deliberate exception (add it to EXPECTED_MISSING_JSON " +
        "here with a comment explaining why, and document it in the machine-facing CLI " +
        "contract doc).",
    ).toEqual([]);
  });

  it("records the full actionable command surface (fails loudly if a command is added or removed, forcing this matrix to be reviewed)", () => {
    const paths = leaves.map((n) => n.path).sort();
    // This is intentionally a change detector, not a fixed contract -- see
    // docs/engineering/m33-wu01-command-result-contract.md Sec 8 for the
    // full list this snapshot was taken against. Update deliberately.
    expect(paths.length).toBe(EXPECTED_COMMAND_COUNT);
  });
});

// 75 actionable (leaf) commands as of M41-WU03 (73 as of M40-WU04, +2 for
// the M41-WU03 `aiqt validation select|explain` family), 88 as of M44-WU04
// (+2 for `aiqt release history`/`release reconstruct`), 97 as of M45-WU02
// (+9 for the `aiqt maintenance` family: schedule add/list/inspect/update/
// enable/disable/remove, status, history) -- distinct from the
// *.command.ts file count (some files export multiple registered
// commands, e.g. workspace.command.ts covers prepare/status/release/
// recover).
const EXPECTED_COMMAND_COUNT = 97;
