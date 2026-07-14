import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { runExport } from "../../src/cli/commands/export.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

async function makeInProgressProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

/** Count non-empty "- " bullet lines directly under a markdown heading, up to the next heading. */
function countBulletsUnderHeading(content: string, heading: string): number {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) throw new Error(`Heading not found: ${heading}`);
  let count = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    if (line.startsWith("- ") && line.trim() !== "- None.") count++;
  }
  return count;
}

describe("aiqt manage and final-review.md classification consistency (M10 §9)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("produce identical developmentComplete/productionReady/releaseBlockerCount/userActionRequiredCount/externalVerificationGapCount/agentFixableIssueCount", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);

    const checkpointResult = runCheckpoint(contextFor(dir), {
      input: {
        summary: "Implemented with mixed issue classifications.",
        completed: ["Implemented the unit."],
        notCompleted: [],
        filesChanged: ["src/example.ts"],
        validationResult: "passed",
        acceptanceCriteriaResult: "passed",
        validationCommands: [{ command: "pnpm test", result: "passed" }],
        acceptanceCriteria: [{ criterion: "Works", result: "passed" }],
        issues: [
          {
            title: "User must configure Clerk webhook secret in the dashboard",
            severity: "high",
            status: "open",
            agentCanFix: false,
          },
          {
            title: "Refactor helper function for clarity",
            severity: "medium",
            status: "open",
            agentCanFix: true,
          },
          {
            title: "Scope note: mobile styling deferred to a later unit",
            severity: "low",
            status: "open",
            agentCanFix: false,
          },
          {
            title: "Branch protection must be enabled before release",
            severity: "critical",
            status: "open",
            agentCanFix: false,
          },
        ],
        targetStatus: "needs_review",
        notes: [],
      },
    });
    expect(checkpointResult.exitCode).toBe(ExitCode.Success);

    const manageResult = runManage(contextFor(dir));
    expect(manageResult.exitCode).toBe(ExitCode.Success);
    const manageData = manageResult.data as {
      developmentComplete: boolean;
      productionReady: boolean;
      releaseBlockerCount: number;
      userActionRequiredCount: number;
      externalVerificationGapCount: number;
      agentFixableIssueCount: number;
    };

    const exportResult = runExport(contextFor(dir), { target: "all" });
    expect(exportResult.exitCode).toBe(ExitCode.Success);
    const content = readFileSync(join(dir, ".aiqt", "exports", "final-review.md"), "utf8");

    expect(content).toContain(`Development complete: ${manageData.developmentComplete ? "yes" : "no"}`);
    expect(content).toContain(`Production ready: ${manageData.productionReady ? "yes" : "no"}`);

    expect(countBulletsUnderHeading(content, "## Release Blockers")).toBe(manageData.releaseBlockerCount);
    expect(countBulletsUnderHeading(content, "## User-Action-Required Checklist")).toBe(
      manageData.userActionRequiredCount,
    );
    expect(countBulletsUnderHeading(content, "## External Verification Gaps")).toBe(
      manageData.externalVerificationGapCount,
    );
    expect(countBulletsUnderHeading(content, "## Agent-Fixable Unresolved Issues")).toBe(
      manageData.agentFixableIssueCount,
    );

    // Sanity: the counts are non-trivial (the test actually exercises each bucket).
    expect(manageData.releaseBlockerCount).toBeGreaterThan(0);
    expect(manageData.userActionRequiredCount).toBeGreaterThan(0);
    expect(manageData.externalVerificationGapCount).toBeGreaterThan(0);
    expect(manageData.agentFixableIssueCount).toBeGreaterThan(0);
  });

  it("excludes the scope-note issue from User-Action-Required but still allows it to surface as a backlog candidate", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    runCheckpoint(contextFor(dir), {
      input: {
        summary: "s",
        completed: [],
        notCompleted: [],
        filesChanged: [],
        validationResult: "passed",
        acceptanceCriteriaResult: "passed",
        validationCommands: [],
        acceptanceCriteria: [],
        issues: [
          {
            title: "Scope note: mobile styling deferred to a later unit",
            severity: "low",
            status: "open",
            agentCanFix: false,
          },
        ],
        targetStatus: "needs_review",
        notes: [],
      },
    });

    const manageResult = runManage(contextFor(dir));
    const data = manageResult.data as { userActionRequired: string[]; postMvpBacklogCandidates: string[] };
    expect(data.userActionRequired.some((s) => s.includes("Scope note"))).toBe(false);
    expect(data.postMvpBacklogCandidates.some((s) => s.includes("Scope note"))).toBe(true);
  });
});
