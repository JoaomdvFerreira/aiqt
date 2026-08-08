import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { listSourceFiles, readRepoFileText } from "../structural-review-evidence.js";

/**
 * Section 4.7/9's M36-M38 precedent: every real process-spawn call site
 * is a deliberately narrow, reviewed allowlist (autonomous-command-
 * runner.ts, sandbox-docker-command-runner.ts, git-command-runner.ts).
 * A new `child_process` call site outside this allowlist is exactly the
 * "duplicate execution-authority path" Section 4.7 describes.
 */
const ALLOWLISTED_EXECUTION_OWNERS = new Set([
  "src/workspaces/autonomous-command-runner.ts",
  "src/workspaces/sandbox-docker-command-runner.ts",
  "src/workspaces/git-command-runner.ts",
]);

/**
 * Section 6.2's "isolated by design" false-positive control: repository
 * governance/release tooling (version-check, repeated-run validation,
 * git plumbing for CI) is a separate, already-legitimate category from
 * the product's agent-facing autonomous/sandbox execution authority this
 * domain actually governs. Flagging every `spawnSync` in a build script
 * would just be noise, not a structural safety concern -- confirmed by
 * reading src/tooling/git-utils.ts, version-check.ts, and
 * repeated-run-validation-cli.ts (M19/M35-era, already reviewed).
 */
const EXCLUDED_PATH_PREFIXES = ["src/tooling/"];

const CHILD_PROCESS_PATTERN = /\b(?:execFileSync|execSync|spawnSync|spawn|exec|execFile)\s*\(/;
const CHILD_PROCESS_IMPORT_PATTERN = /from\s+["']node:child_process["']|require\(["']child_process["']\)/;

/**
 * Section 4.7: a duplicate/unreviewed execution-authority path -- a
 * source file (outside the reviewed allowlist) that imports
 * `node:child_process` and calls a spawn/exec-shaped function.
 * Deterministically greppable; `proven` when both signals are present
 * in the same file.
 */
export function runDuplicateExecutionAuthorityRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const files = listSourceFiles(repoRoot).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const findings: StructuralFinding[] = [];

  for (const file of files) {
    if (ALLOWLISTED_EXECUTION_OWNERS.has(file)) continue;
    if (EXCLUDED_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    const text = readRepoFileText(repoRoot, file);
    if (text === null) continue;
    if (!CHILD_PROCESS_IMPORT_PATTERN.test(text)) continue;
    if (!CHILD_PROCESS_PATTERN.test(text)) continue;

    findings.push(
      buildStructuralFinding({
        domain: "execution_safety_boundary",
        ruleId: "duplicate-execution-authority-path",
        title: `${file} spawns a process outside the reviewed execution-authority allowlist`,
        explanation: `${file} imports node:child_process and calls a spawn/exec-shaped function, but is not one of the reviewed execution owners (${[...ALLOWLISTED_EXECUTION_OWNERS].join(", ")}). This may be a legitimate new owner pending governance review, or a bypass of the established command-policy/sandbox gate.`,
        reviewCommit,
        affectedPaths: [file],
        evidence: [{ evidenceId: "CHILD-PROCESS-CALL", description: "node:child_process import plus a spawn/exec-shaped call in the same file.", locator: file }],
        confidence: "strong_signal",
        significance: "high",
        reasonCodes: ["DUPLICATE_EXECUTION_AUTHORITY"],
        evidenceGaps: ["Whether this call site enforces the same command/network/budget policy as the reviewed owners was not verified."],
        disposition: "actionable",
        eligibleForIntake: true,
        recommendedNextAction: "Route this call through the existing reviewed command-runner owner, or justify and register it as a new governed execution owner.",
        evidenceSignature: file,
      }),
    );
  }
  return findings;
}
