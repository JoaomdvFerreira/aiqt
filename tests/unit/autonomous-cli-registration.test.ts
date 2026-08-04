import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProgram } from "../../src/cli/register-commands.js";

/**
 * M37-WU01 (build spec acceptance criteria: "CLI help complete"; "all
 * commands support --json"; required tests: "CLI help and registration";
 * "no raw-output bypass"). Introspects the real commander.js program
 * built by register-commands.ts -- no subprocess spawn needed for this
 * class of check (buildProgram() runs entirely in-process).
 */
const EXPECTED_SUBCOMMANDS = ["inspect", "classify", "approve", "run", "status", "cancel", "result", "cleanup"];

describe("aiqt autonomous CLI registration (M37-WU01)", () => {
  it("registers the autonomous command family with exactly the 8 required subcommands", () => {
    const program = buildProgram();
    const autonomousCommand = program.commands.find((c) => c.name() === "autonomous");
    expect(autonomousCommand).toBeDefined();
    const subNames = autonomousCommand!.commands.map((c) => c.name()).sort();
    expect(subNames).toEqual([...EXPECTED_SUBCOMMANDS].sort());
  });

  it("every autonomous subcommand declares a --json option", () => {
    const program = buildProgram();
    const autonomousCommand = program.commands.find((c) => c.name() === "autonomous")!;
    for (const sub of autonomousCommand.commands) {
      const optionNames = sub.options.map((o) => o.long);
      expect(optionNames, `aiqt autonomous ${sub.name()} should declare --json`).toContain("--json");
    }
  });

  it("every autonomous subcommand has a non-empty description (CLI help complete)", () => {
    const program = buildProgram();
    const autonomousCommand = program.commands.find((c) => c.name() === "autonomous")!;
    expect(autonomousCommand.description().length).toBeGreaterThan(0);
    for (const sub of autonomousCommand.commands) {
      expect(sub.description().length, `aiqt autonomous ${sub.name()} should have a description`).toBeGreaterThan(0);
    }
  });

  it("no raw-output bypass: every autonomous subcommand's action routes its result through the shared emit() helper, not a direct process.stdout.write of an unwrapped payload", () => {
    const text = readFileSync(join(process.cwd(), "src", "cli", "register-commands.ts"), "utf8");
    const autonomousSectionMatch = text.match(/const autonomousCommand[\s\S]*?return program;/);
    expect(autonomousSectionMatch, "could not locate the autonomous command registration section").not.toBeNull();
    const section = autonomousSectionMatch![0];
    // Every .action(...) block in this section ends with an emit(result, ctx.json) call, and none of
    // them writes directly to stdout/stderr (the raw-output-bypass pattern used only by the
    // --example commands elsewhere in this file, which autonomous has none of).
    const actionBlockCount = (section.match(/\.action\(/g) ?? []).length;
    const emitCallCount = (section.match(/emit\(result, ctx\.json\)/g) ?? []).length;
    expect(emitCallCount).toBe(actionBlockCount);
    expect(section).not.toMatch(/process\.stdout\.write/);
  });
});
