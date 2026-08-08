import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { listSourceFiles, readRepoFileText } from "../structural-review-evidence.js";

const REGISTER_COMMANDS_PATH = "src/cli/register-commands.ts";

/**
 * Section 4.4: a command file under src/cli/commands/ that
 * register-commands.ts never imports is unreachable command wiring --
 * deterministically provable by checking whether the module's basename
 * (minus extension) appears anywhere in register-commands.ts's import
 * statements. Excludes shared, non-command helper files (no exported
 * `run*` command entry point) and files register-commands.ts itself
 * re-exports indirectly, which this bounded check cannot see -- an
 * absence here is `strong_signal`, not `proven`, precisely because a
 * command could be registered through an indirection this rule does not
 * follow.
 */
export function runUnreferencedCommandFileRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const registerText = readRepoFileText(repoRoot, REGISTER_COMMANDS_PATH);
  if (registerText === null) return [];

  const commandFiles = listSourceFiles(repoRoot).filter(
    (f) => f.startsWith("src/cli/commands/") && f.endsWith(".command.ts"),
  );

  const findings: StructuralFinding[] = [];
  for (const file of commandFiles) {
    const basename = file.slice("src/cli/commands/".length, -".ts".length);
    const importPattern = new RegExp(`["'][^"']*${basename}\\.js["']`);
    if (importPattern.test(registerText)) continue;

    findings.push(
      buildStructuralFinding({
        domain: "dead_structural_paths",
        ruleId: "unreferenced-command-file",
        title: `${file} is never imported by register-commands.ts`,
        explanation: `${file} exists under src/cli/commands/ but no import in ${REGISTER_COMMANDS_PATH} references it by its own basename. It may be dead command wiring, or referenced only through an indirection this bounded check does not follow.`,
        reviewCommit,
        affectedPaths: [file],
        evidence: [{ evidenceId: "NO-IMPORT-MATCH", description: `No "${basename}.js" import found in ${REGISTER_COMMANDS_PATH}.`, locator: file }],
        confidence: "strong_signal",
        significance: "low",
        reasonCodes: ["UNREFERENCED_COMMAND_FILE"],
        evidenceGaps: ["Indirect registration paths (re-exports, dynamic requires) were not checked."],
        disposition: "actionable",
        eligibleForIntake: true,
        recommendedNextAction: "Confirm whether this command file is still registered through another path; remove it if genuinely dead.",
        evidenceSignature: file,
      }),
    );
  }
  return findings;
}
