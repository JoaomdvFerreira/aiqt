import { resolve } from "node:path";

/**
 * M14 §8/§10: working-directory and recovery-discipline guidance. Addresses
 * F054 (nested-folder/root drift) and F055 (external tools such as
 * Playwright MCP using the wrong cwd) by explicitly distinguishing the AIQT
 * control root from the configured implementation root, and F057 (agent used
 * reset/reimport instead of M11/M12 repair controls) with static recovery
 * guidance. This module never calls or changes M12 graph validate/repair
 * behavior -- it only tells the external agent to prefer those commands.
 */

export interface WorkingDirectoryDisciplineInput {
  /** The folder containing .aiqt -- always known, even before aiqt init. */
  controlRoot: string;
  /** project.project.existingRepositoryPath, or null when not configured. */
  existingRepositoryPath: string | null;
}

/**
 * §8.2: only true when a distinct implementation root is actually
 * configured. If existingRepositoryPath resolves to the same folder as the
 * control root, there is nothing to distinguish and the full block is not
 * rendered.
 */
export function shouldIncludeWorkingDirectoryDiscipline(
  input: WorkingDirectoryDisciplineInput,
): boolean {
  if (!input.existingRepositoryPath) return false;
  return resolve(input.existingRepositoryPath) !== resolve(input.controlRoot);
}

/** §8.1: the exact Working Directory Discipline block. Only call when shouldIncludeWorkingDirectoryDiscipline is true. */
export function renderWorkingDirectoryDisciplineSection(
  input: WorkingDirectoryDisciplineInput,
): string {
  const lines: string[] = [];
  lines.push("## Working Directory Discipline");
  lines.push("");
  lines.push("AIQT control root:");
  lines.push(input.controlRoot);
  lines.push("");
  lines.push("Implementation root:");
  lines.push(input.existingRepositoryPath!);
  lines.push("");
  lines.push("Rules:");
  lines.push("- Run AIQT commands from the AIQT control root.");
  lines.push("- Run application commands from the implementation root.");
  lines.push("- Run browser / Playwright MCP checks from the implementation root.");
  lines.push(
    "- Make application source changes only inside the implementation root unless the packet explicitly says otherwise.",
  );
  lines.push("- Do not create nested application folders under the AIQT control root.");
  lines.push(
    "- Do not create .playwright-mcp or browser artifacts under the AIQT control root when an implementation root is configured.",
  );
  lines.push("- Report changed files relative to the implementation root in checkpoint output.");
  return lines.join("\n");
}

/**
 * §8.2: when no existingRepositoryPath is configured, AIQT must not invent
 * one -- instead warn that the implementation root is assumed to be the
 * AIQT control root. Driver-only fallback note (packets omit this section
 * entirely in the single-repo case to avoid clutter).
 */
export function renderNoImplementationRootWarning(controlRoot: string): string {
  return [
    "Working directory note:",
    `No existingRepositoryPath is configured. The implementation root is assumed to be the AIQT control root (${controlRoot}).`,
  ].join("\n");
}

/**
 * §10: recovery-discipline guidance for the driver prompt only. M14 does not
 * change aiqt graph validate/repair behavior -- this only tells the external
 * agent to prefer the existing M11/M12 controls before a destructive
 * reset/reimport.
 */
export function renderRecoveryDisciplineSection(): string {
  const lines: string[] = [];
  lines.push("Recovery discipline (prefer repair controls over reset/reimport):");
  lines.push("- If an issue needs lifecycle handling, use aiqt issue list / update / promote.");
  lines.push(
    '- If a dependency type is wrong, use aiqt dependency update <id> --type <type> --reason "...".',
  );
  lines.push("- If graph health is unclear, use aiqt graph validate and aiqt graph repair --dry-run.");
  lines.push("- If a checkpoint result was classified incorrectly, use aiqt checkpoint amend.");
  lines.push(
    "- Reset/reimport is a last resort for early disposable plans only; do not use it once meaningful checkpoints exist.",
  );
  return lines.join("\n");
}
