import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { familyFailureResult, missingProjectResult } from "../../src/core/output/result.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";

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
 * M33-WU02: familyFailureResult() is now the single authoritative owner of
 * the exit-10 invariant (M33 spec Sec 5.2). These are direct unit tests of
 * that function -- the real, durable regression proof -- rather than a
 * textual grep, since callers now delegate to it instead of inlining the
 * status-derivation logic themselves (M33-WU01's original characterization
 * grepped for the literal "needs_input" string, which no longer appears at
 * each of the ~26 call sites now that they're centralized here).
 */
describe("M33-WU02: familyFailureResult enforces the exit-10 invariant centrally", () => {
  it("exitCode 10 always yields status:needs_input and requiresHumanInput:true", () => {
    const result = familyFailureResult({
      action: "evidence",
      area: "input",
      summary: "no input",
      exitCode: ExitCode.HumanInputRequired,
      issueId: "SOME-NO-INPUT",
    });
    expect(result.status).toBe("needs_input");
    expect(result.requiresHumanInput).toBe(true);
    expect(result.exitCode).toBe(10);
  });

  it("exitCode WorkflowBlocked yields status:blocked, not failed", () => {
    const result = familyFailureResult({
      action: "workspace",
      area: "workspace",
      summary: "blocked",
      exitCode: ExitCode.WorkflowBlocked,
      issueId: "SOME-BLOCKED",
    });
    expect(result.status).toBe("blocked");
    expect(result.requiresHumanInput).toBe(false);
  });

  it("any other exitCode yields status:failed with requiresHumanInput:false", () => {
    const result = familyFailureResult({
      action: "execution",
      area: "execution",
      summary: "invalid",
      exitCode: ExitCode.InvalidInput,
      issueId: "SOME-INVALID",
    });
    expect(result.status).toBe("failed");
    expect(result.requiresHumanInput).toBe(false);
  });

  it("an issueId matching the NO-PROJECT/DIR-MISSING convention automatically gets nextRecommendedCommand: \"aiqt init\" (closes Contradiction E for every local failure() call site)", () => {
    const result = familyFailureResult({
      action: "evidence",
      area: "evidence-gate",
      summary: "missing",
      exitCode: ExitCode.InvalidInput,
      issueId: "EVIDENCE-GATE-POLICY-SHOW-NO-PROJECT",
    });
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("an issueId NOT matching that convention leaves nextRecommendedCommand null (unchanged from pre-M33 behavior for ordinary failures)", () => {
    const result = familyFailureResult({
      action: "evidence",
      area: "evidence-gate",
      summary: "not found",
      exitCode: ExitCode.InvalidInput,
      issueId: "EVIDENCE-GATE-POLICY-SHOW-NOT-FOUND",
    });
    expect(result.nextRecommendedCommand).toBeNull();
  });

  it("retains pointers when the caller supplies them, and defaults to null when it does not", () => {
    const withPointers = familyFailureResult({
      action: "evidence",
      area: "evidence-gate",
      summary: "x",
      exitCode: ExitCode.InvalidInput,
      issueId: "X",
      projectStatus: "planned",
      currentMilestoneId: "M001",
      currentWorkUnitId: "WU001",
    });
    expect(withPointers.projectStatus).toBe("planned");
    expect(withPointers.currentMilestoneId).toBe("M001");
    expect(withPointers.currentWorkUnitId).toBe("WU001");

    const withoutPointers = familyFailureResult({
      action: "evidence",
      area: "evidence-gate",
      summary: "x",
      exitCode: ExitCode.InvalidInput,
      issueId: "X",
    });
    expect(withoutPointers.projectStatus).toBeNull();
    expect(withoutPointers.currentMilestoneId).toBeNull();
  });
});

describe("M33-WU02: missingProjectResult (bespoke pre-check pattern)", () => {
  it("produces a consistent, actionable missing-project result", () => {
    const result = missingProjectResult("status", "STATUS");
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
    expect(result.blockingIssues[0].id).toBe("STATUS-NO-PROJECT");
    expect(result.blockingIssues[0].area).toBe("workflow");
    expect(result.blockingIssues[0].severity).toBe("high");
  });
});

/**
 * Every command file that declares its own private `function failure(...)`
 * result-construction helper. As of M33-WU02, all 29 delegate their body to
 * the shared familyFailureResult() (see next describe block) rather than
 * inlining status-derivation logic -- but the thin per-file wrapper
 * functions themselves are intentionally NOT yet removed (that is WU33-05's
 * "remove or deprecate obsolete local failure helpers" scope). This list is
 * therefore still expected to match the M33-WU01 baseline exactly; only the
 * *implementation* of each wrapper has changed.
 */
const LOCAL_FAILURE_HELPER_FILES = [
  "defects-discover.command.ts",
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

/**
 * Of LOCAL_FAILURE_HELPER_FILES, exactly which ones actually emit
 * ExitCode.HumanInputRequired anywhere (so their failure() delegation to
 * familyFailureResult is what fixes their exit-10 pairing). The other
 * local-failure()-helper files (list/show/status-only families) never emit
 * exit 10 at all, so they had no exit-10 contradiction to begin with.
 */
const LOCAL_FAILURE_HELPER_FILES_USING_EXIT_10 = LOCAL_FAILURE_HELPER_FILES.filter((f) =>
  readCommandFile(f).includes("ExitCode.HumanInputRequired"),
);

describe("M33-WU02: unauthorized new result-owner architecture guard", () => {
  it("the set of command files with a local failure() helper matches the recorded M33-WU01 baseline exactly (wrapper functions retained by design until WU33-05)", () => {
    const actual = listCommandFiles()
      .filter((f) => /^function failure\(/m.test(readCommandFile(f)))
      .sort();
    expect(
      actual,
      "A command file gained or lost a local failure() helper since the M33-WU01/WU02 baseline. " +
        "This is expected to shrink toward zero starting in WU33-05 (deliberate migration) -- " +
        "it must not grow silently. Update LOCAL_FAILURE_HELPER_FILES here and the inventory " +
        "in docs/engineering/m33-wu01-command-result-contract.md only as part of a reviewed change.",
    ).toEqual(LOCAL_FAILURE_HELPER_FILES);
  });

  it("every local failure() helper that uses ExitCode.HumanInputRequired delegates its body to familyFailureResult (proves WU33-02's exit-10 fix reaches every real call site, not just a sample)", () => {
    expect(LOCAL_FAILURE_HELPER_FILES_USING_EXIT_10.length).toBeGreaterThan(0);
    for (const file of LOCAL_FAILURE_HELPER_FILES_USING_EXIT_10) {
      const text = readCommandFile(file);
      const fnMatch = text.match(/function failure\([^)]*\): CommandResult \{[\s\S]*?\n\}/);
      expect(fnMatch, `${file} should still declare a failure() function`).not.toBeNull();
      expect(
        fnMatch![0],
        `${file}'s failure() should delegate to familyFailureResult(), not hardcode status derivation inline`,
      ).toContain("familyFailureResult(");
      expect(
        fnMatch![0],
        `${file}'s failure() should no longer hardcode status: "failed" unconditionally`,
      ).not.toMatch(/status:\s*"failed"/);
    }
  });

  it("the raw-text stream bypass sites in register-commands.ts match the recorded WU33-01 baseline exactly (untouched in WU33-02)", () => {
    const registerCommandsPath = join(
      here,
      "..",
      "..",
      "src",
      "cli",
      "register-commands.ts",
    );
    const text = readFileSync(registerCommandsPath, "utf8");
    const occurrences = text
      .split("\n")
      .filter((line) => line.includes("!ctx.json") && line.includes("result.exitCode === ExitCode.Success"))
      .length;
    expect(
      occurrences,
      "The number of raw-text emit() bypass sites in register-commands.ts changed. " +
        "Update the WU33-01 inventory (Sec 1.3) deliberately if this is an intentional " +
        "new specialized renderer; do not let it drift silently.",
    ).toBe(7);
  });

  it("no command file outside result.ts reimplements the exit-10/blocked status-derivation logic familyFailureResult owns (M33-WU05: no undocumented local result owner)", () => {
    // The exact anti-pattern familyFailureResult replaced: a local ternary
    // deriving status from exitCode instead of delegating. A NEW command
    // written after WU33-02 that copies this pattern instead of calling
    // familyFailureResult would defeat the whole point of centralizing it --
    // this guard catches that regardless of which file it appears in, not
    // just the 29 already known about.
    const antiPattern = /status:\s*exitCode\s*===\s*ExitCode\.\w+\s*\?\s*"blocked"\s*:\s*"failed"/;
    const offenders = listCommandFiles().filter((f) => antiPattern.test(readCommandFile(f)));
    expect(
      offenders,
      "A command file constructs a result by inlining the exact status-derivation " +
        "ternary familyFailureResult() exists to centralize. Call familyFailureResult() " +
        "instead of reimplementing it.",
    ).toEqual([]);
  });

  it("every local failure() helper is marked @deprecated M33-WU05 (documents that new code should call familyFailureResult directly)", () => {
    for (const file of LOCAL_FAILURE_HELPER_FILES) {
      expect(
        readCommandFile(file),
        `${file}'s failure() helper should carry the M33-WU05 @deprecated marker`,
      ).toContain("@deprecated M33-WU05");
    }
  });
});
