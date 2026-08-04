import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(here, "..", "..", "src", "cli", "commands");

function listCommandFiles(): string[] {
  return readdirSync(commandsDir)
    .filter((f) => f.endsWith(".command.ts"))
    .sort();
}

function readCommandFile(name: string): string {
  return readFileSync(join(commandsDir, name), "utf8");
}

/**
 * M33-WU01 Contradiction B: exit code 10 must invariantly mean
 * `status: "needs_input"` and `requiresHumanInput: true` (M33 spec Sec 5.2).
 * This is a textual/static classification (grepping for the two literal
 * markers in the same file), not a semantic guarantee -- consistent with
 * this repository's existing boundary-scan test convention. It records
 * today's KNOWN, ALREADY-INCONSISTENT baseline as a change detector: if a
 * new command starts using HumanInputRequired without adopting the correct
 * body-field pairing, or if an existing violation is fixed, this list must
 * be updated deliberately (by WU33-02+), not silently. Per the M33-WU01
 * spec, this test intentionally preserves the current inconsistency rather
 * than normalizing it.
 */
const FILES_USING_EXIT_10 = [
  "checkpoint.command.ts",
  "evidence-gate-advisory-feedback.command.ts",
  "evidence-gate-advisory-refresh.command.ts",
  "evidence-gate-enforcement-activation-activate.command.ts",
  "evidence-gate-enforcement-activation-deactivate.command.ts",
  "evidence-gate-enforcement-activation-prepare.command.ts",
  "evidence-gate-enforcement-profile-import.command.ts",
  "evidence-gate-enforcement-profile-show.command.ts",
  "evidence-gate-enforcement-recovery-import.command.ts",
  "evidence-gate-exception-create.command.ts",
  "evidence-gate-exception-revoke.command.ts",
  "evidence-gate-policy-activate.command.ts",
  "evidence-gate-policy-import.command.ts",
  "evidence-gate-policy-show.command.ts",
  "evidence-gate-simulate.command.ts",
  "evidence-import.command.ts",
  "execution-adapter-claude-code-import.command.ts",
  "execution-adapter-claude-code-request.command.ts",
  "execution-external-import.command.ts",
  "execution-external-request.command.ts",
  "execution-import.command.ts",
  "export.command.ts",
  "import.command.ts",
  "issue-update.command.ts",
  "plan.command.ts",
  "update.command.ts",
  "workspace.command.ts",
].sort();

/** The 5 files that correctly pair exit 10 with status: "needs_input". */
const EXIT_10_COMPLIANT_FILES = [
  "checkpoint.command.ts",
  "export.command.ts",
  "import.command.ts",
  "plan.command.ts",
  "update.command.ts",
].sort();

/**
 * The 22 files that use exit 10 but never write `status: "needs_input"`
 * anywhere in the file -- i.e. every emission of ExitCode.HumanInputRequired
 * in these files pairs with `status: "failed"` (via each file's local
 * `failure()` helper, which hardcodes that status unconditionally).
 */
const EXIT_10_NONCOMPLIANT_FILES = FILES_USING_EXIT_10.filter(
  (f) => !EXIT_10_COMPLIANT_FILES.includes(f),
).sort();

/**
 * Every command file that declares its own private `function failure(...)`
 * result-construction helper instead of using the shared makeResult/
 * errorToResult pipeline (M33 spec LOW-011). Recorded here as the WU33-01
 * baseline so WU33-02's migration can be measured by this list shrinking to
 * zero, and so a new command added before WU33-02 lands doesn't silently
 * grow the count without deliberate review.
 */
const LOCAL_FAILURE_HELPER_FILES = [
  "evidence-gate-advisory-feedback.command.ts",
  "evidence-gate-advisory-refresh.command.ts",
  "evidence-gate-enforcement-activation-activate.command.ts",
  "evidence-gate-enforcement-activation-deactivate.command.ts",
  "evidence-gate-enforcement-activation-prepare.command.ts",
  "evidence-gate-enforcement-profile-import.command.ts",
  "evidence-gate-enforcement-profile-list.command.ts",
  "evidence-gate-enforcement-profile-show.command.ts",
  "evidence-gate-enforcement-recovery-import.command.ts",
  "evidence-gate-enforcement-status.command.ts",
  "evidence-gate-exception-create.command.ts",
  "evidence-gate-exception-list.command.ts",
  "evidence-gate-exception-revoke.command.ts",
  "evidence-gate-policy-activate.command.ts",
  "evidence-gate-policy-import.command.ts",
  "evidence-gate-policy-list.command.ts",
  "evidence-gate-policy-show.command.ts",
  "evidence-gate-simulate.command.ts",
  "evidence-import.command.ts",
  "execution-adapter-claude-code-import.command.ts",
  "execution-adapter-claude-code-request.command.ts",
  "execution-adapter-claude-code-status.command.ts",
  "execution-external-import.command.ts",
  "execution-external-request.command.ts",
  "execution-external-status.command.ts",
  "execution-import.command.ts",
  "execution-stale.command.ts",
  "execution-status.command.ts",
  "workspace.command.ts",
].sort();

describe("M33-WU01: exit-10 invariant characterization (Contradiction B)", () => {
  it("identifies exactly which command files invoke ExitCode.HumanInputRequired", () => {
    const actual = listCommandFiles().filter((f) =>
      readCommandFile(f).includes("HumanInputRequired"),
    );
    expect(actual.sort()).toEqual(FILES_USING_EXIT_10);
  });

  it("confirms the 5 core-family files correctly pair exit 10 with status: \"needs_input\"", () => {
    for (const file of EXIT_10_COMPLIANT_FILES) {
      const text = readCommandFile(file);
      expect(text, `${file} should reference HumanInputRequired`).toContain(
        "HumanInputRequired",
      );
      expect(text, `${file} should pair it with needs_input`).toContain(
        '"needs_input"',
      );
    }
  });

  it("characterizes the 22 non-core-family files as NOT pairing exit 10 with needs_input (known inconsistency, not yet normalized)", () => {
    for (const file of EXIT_10_NONCOMPLIANT_FILES) {
      const text = readCommandFile(file);
      expect(text, `${file} should reference HumanInputRequired`).toContain(
        "HumanInputRequired",
      );
      expect(
        text,
        `${file} was expected to still lack "needs_input" as of the M33-WU01 baseline -- if this now fails, either the file was fixed (update this list and the inventory doc) or a new command copied the old pattern (do not update the list; fix the command instead)`,
      ).not.toContain('"needs_input"');
    }
    // The invariant genuinely does not hold suite-wide at this baseline.
    expect(EXIT_10_NONCOMPLIANT_FILES.length).toBeGreaterThan(0);
    expect(EXIT_10_NONCOMPLIANT_FILES.length + EXIT_10_COMPLIANT_FILES.length).toBe(
      FILES_USING_EXIT_10.length,
    );
  });
});

describe("M33-WU01: unauthorized new result-owner architecture guard", () => {
  it("the set of command files with a local failure() helper matches the recorded WU33-01 baseline exactly", () => {
    const actual = listCommandFiles()
      .filter((f) => /^function failure\(/m.test(readCommandFile(f)))
      .sort();
    expect(
      actual,
      "A command file gained or lost a local failure() helper since the M33-WU01 baseline. " +
        "This is expected to shrink toward zero starting in WU33-02 (deliberate migration) -- " +
        "it must not grow silently. Update LOCAL_FAILURE_HELPER_FILES here and the inventory " +
        "in docs/engineering/m33-wu01-command-result-contract.md only as part of a reviewed change.",
    ).toEqual(LOCAL_FAILURE_HELPER_FILES);
  });

  it("the raw-text stream bypass sites in register-commands.ts match the recorded WU33-01 baseline exactly", () => {
    const registerCommandsPath = join(
      here,
      "..",
      "..",
      "src",
      "cli",
      "register-commands.ts",
    );
    const text = readFileSync(registerCommandsPath, "utf8");
    // Each of the 7 bypass sites gates its raw-text write on an `if` line
    // containing both `!ctx.json` and `result.exitCode === ExitCode.Success`
    // (sometimes with an extra clause in between, e.g. `next`'s `!raw.preview`
    // and `prompt`'s `!raw.out`); `emit()`'s own unconditional stream router
    // (line ~140) contains the exitCode check but not `!ctx.json`, so it is
    // correctly excluded by requiring both substrings on the same line.
    const occurrences = text
      .split("\n")
      .filter((line) => line.includes("!ctx.json") && line.includes("result.exitCode === ExitCode.Success"))
      .length;
    // status --parallel, next packet, prompt, manage, skills plan,
    // issue list, repair plan -- see docs/engineering/m33-wu01-command-result-contract.md Sec 1.3.
    expect(
      occurrences,
      "The number of raw-text emit() bypass sites in register-commands.ts changed. " +
        "Update the WU33-01 inventory (Sec 1.3) deliberately if this is an intentional " +
        "new specialized renderer; do not let it drift silently.",
    ).toBe(7);
  });
});
