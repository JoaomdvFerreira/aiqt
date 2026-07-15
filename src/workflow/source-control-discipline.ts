import { join } from "node:path";
import { isDirectory } from "../core/filesystem/file-exists.js";
import { containsPhrase, buildUiHeavyDetectionText } from "./design/ui-heavy-detection.js";
import type { ProjectModel } from "../schema/project.schema.js";

/**
 * M15: source-control and GitHub-flow discipline (F058-F062). AIQT never
 * executes Git/GitHub commands itself -- everything here is guidance text
 * rendered into prompts/packets, plus one pure, unenforced rendering helper
 * (mapRiskScoreToSeverity). All Git/GitHub status an agent reports through a
 * checkpoint is self-attested; AIQT does not parse, verify, or act on it.
 */

export type AiqtSeverity = "low" | "medium" | "high" | "critical";

/**
 * §8: deterministic risk-score-to-canonical-severity mapping. This is a
 * pure, agent-facing documentation/rendering helper only -- AIQT does not
 * call this to parse or enforce a score reported in a checkpoint, and does
 * not automatically change workflow state based on its result.
 */
export function mapRiskScoreToSeverity(score: number): AiqtSeverity {
  if (score <= 20) return "low";
  if (score <= 50) return "medium";
  if (score <= 80) return "high";
  return "critical";
}

/** Best-effort, read-only check for a .git directory. Never throws. */
export function isGitRepository(root: string | null | undefined): boolean {
  if (!root) return false;
  try {
    return isDirectory(join(root, ".git"));
  } catch {
    return false;
  }
}

/** §11.2: phrases that let a user explicitly opt out of the repository-baseline requirement. */
const SOURCE_CONTROL_DISABLE_PHRASES: readonly string[] = [
  "no source control",
  "not using git",
  "skip git",
  "without git",
  "no git",
];

export function isSourceControlExplicitlyDisabled(text: string): boolean {
  return SOURCE_CONTROL_DISABLE_PHRASES.some((phrase) => containsPhrase(text, phrase));
}

/**
 * §6.3/§11.2: true when aiqt prompt plan should require an early repository
 * initialization/baseline work unit -- i.e. no Git repository already exists
 * at the implementation root (falling back to the AIQT control root when no
 * existingRepositoryPath is configured) and the user has not explicitly
 * disabled source control.
 */
export function requiresRepositoryBaselineWorkUnit(input: {
  project?: ProjectModel | null;
  repoRoot?: string | null;
}): boolean {
  const implementationRoot = input.project?.project.existingRepositoryPath ?? input.repoRoot ?? null;
  if (isGitRepository(implementationRoot)) return false;

  const text = buildUiHeavyDetectionText({ project: input.project });
  if (isSourceControlExplicitlyDisabled(text)) return false;

  return true;
}

/** §11.1: aiqt prompt driver's Source Control Discipline block. */
export function renderDriverSourceControlDisciplineSection(): string {
  const lines: string[] = [];
  lines.push("Source Control Discipline:");
  lines.push("- Confirm the implementation root before making any changes.");
  lines.push(
    "- If the implementation root is not a Git repository, initialize one with main as the default branch (git init -b main, or git init followed by git branch -M main as a fallback).",
  );
  lines.push(
    "- Create or update .gitignore before the baseline commit (exclude secrets, env files, dependencies, build output, coverage, Playwright/MCP artifacts, .aiqt/exports, .next, dist, and similar generated artifacts).",
  );
  lines.push("- Create a baseline commit before feature work begins.");
  lines.push("- Run git status before starting each Work Unit.");
  lines.push("- Commit once and tag once after every completed Work Unit.");
  lines.push(
    "- Git/GitHub status you report is self-attested; AIQT does not execute or verify Git/GitHub actions.",
  );
  return lines.join("\n");
}

/** §6.3/§11.2: planning guidance requiring an early repository initialization/baseline work unit. */
export function renderPlanRepositoryBaselineGuidance(): string {
  const lines: string[] = [];
  lines.push("Repository initialization guidance:");
  lines.push(
    "No existing source control was detected for the implementation root. The plan must include an early repository initialization/baseline work unit before any feature implementation work unit.",
  );
  lines.push("This baseline work unit should:");
  lines.push("- Initialize Git with main as the default branch.");
  lines.push("- Create or update .gitignore.");
  lines.push(
    '- Produce a single baseline commit (e.g. "chore(repo): initialize implementation repository baseline").',
  );
  lines.push("- Suggest a repo-baseline tag.");
  lines.push(
    'Example acceptance criteria: "Git repository is initialized with main as the default branch", ".gitignore excludes secrets, dependencies, and build output", "A baseline commit exists before feature work".',
  );
  return lines.join("\n");
}

/**
 * §11.3: the packet Source Control Expectations section, scoped to the
 * selected work unit/milestone so the tag/commit example is concrete and
 * copy-paste-able (matching the m###-wu###-done convention).
 */
export function renderSourceControlExpectationsSection(input: {
  workUnitId: string;
  milestoneId: string;
}): string {
  const tag = `${input.milestoneId.toLowerCase()}-${input.workUnitId.toLowerCase()}-done`;
  const lines: string[] = [];
  lines.push("## Source Control Expectations");
  lines.push("");
  lines.push("- Keep changes scoped to this Work Unit only.");
  lines.push("- Run `git status` before starting and before checkpointing.");
  lines.push(
    `- Create exactly one detailed commit for this Work Unit (e.g. "feat(${input.workUnitId}): <summary>").`,
  );
  lines.push(`- Create exactly one tag for this Work Unit after the commit (e.g. "${tag}").`);
  lines.push(
    "- Do not commit secrets, env files, dependencies, build output, coverage, Playwright/MCP artifacts, .aiqt/exports, .next, dist, or similar generated artifacts.",
  );
  lines.push("- Report a 0-100 risk score and its mapped AIQT severity (low/medium/high/critical) in the checkpoint.");
  lines.push(
    "- These Git/GitHub details are self-attested by you; AIQT does not execute or verify Git/GitHub actions.",
  );
  return lines.join("\n");
}

/** §11.4: checkpoint prompt reminder to report source-control/risk details using only existing checkpoint fields. */
export function renderCheckpointSourceControlGuidance(): string {
  const lines: string[] = [];
  lines.push("Report source control and risk details in summary and/or notes using this shape:");
  lines.push("");
  lines.push("Source control report:");
  lines.push("- Implementation root:");
  lines.push("- Current branch:");
  lines.push("- Git status before checkpoint:");
  lines.push("- Commit created: yes/no");
  lines.push("- Commit hash:");
  lines.push("- Tag created: yes/no");
  lines.push("- Tag name:");
  lines.push("- Uncommitted files remaining:");
  lines.push("- Ignored/generated artifacts:");
  lines.push("");
  lines.push("Risk report:");
  lines.push("- Risk score: <0-100>/100");
  lines.push(
    "- AIQT severity: low|medium|high|critical (0-20 low, 21-50 medium, 51-80 high, 81-100 critical)",
  );
  lines.push("- Risk rationale:");
  lines.push("- Release/user-action/external verification gaps:");
  lines.push("");
  lines.push(
    "AIQT does not execute Git/GitHub commands and does not verify commit hashes, tags, branch state, or the risk score. This report is self-attested.",
  );
  return lines.join("\n");
}
