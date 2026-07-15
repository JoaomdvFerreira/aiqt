import { join } from "node:path";
import { isDirectory } from "../core/filesystem/file-exists.js";
import { containsPhrase, buildUiHeavyDetectionText } from "./design/ui-heavy-detection.js";
import type { ProjectModel } from "../schema/project.schema.js";
import { resolveImplementationRoot } from "./root-resolution.js";

/**
 * M15: source-control and GitHub-flow discipline (F058-F062). AIQT never
 * executes Git/GitHub commands itself -- everything here is guidance text
 * rendered into prompts/packets, plus one pure, unenforced rendering helper
 * (mapRiskScoreToSeverity). All Git/GitHub status an agent reports through a
 * checkpoint is self-attested; AIQT does not parse, verify, or act on it.
 *
 * M15-RC1: implementation repository boundary enforcement (F063). Hardens
 * the above with guidance that the implementation root must be the Git
 * repository root -- never a parent/control repository. Still guidance-only;
 * AIQT does not execute or verify any Git command itself.
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
 * §6.3/§11.2, M16 §12: true when aiqt prompt plan should require an early
 * repository initialization/baseline work unit -- i.e. no Git repository
 * already exists at the resolved implementation root (existingRepositoryPath
 * resolved relative to the control root, falling back to the control root
 * itself when unset -- the same canonical resolution rule used everywhere
 * else) and the user has not explicitly disabled source control.
 */
export function requiresRepositoryBaselineWorkUnit(input: {
  project?: ProjectModel | null;
  repoRoot?: string | null;
}): boolean {
  const controlRoot = input.repoRoot ?? process.cwd();
  const existingRepositoryPath = input.project?.project.existingRepositoryPath ?? null;
  const implementationRoot = resolveImplementationRoot(controlRoot, existingRepositoryPath);
  if (isGitRepository(implementationRoot)) return false;

  const text = buildUiHeavyDetectionText({ project: input.project });
  if (isSourceControlExplicitlyDisabled(text)) return false;

  return true;
}

/**
 * F063 §6: the Repository Boundary Rule -- shared text rendered in both the
 * driver Source Control Discipline block and the packet Source Control
 * Expectations section. Guidance-only: AIQT never verifies this itself.
 */
export function renderRepositoryBoundaryRule(): string {
  const lines: string[] = [];
  lines.push("Repository Boundary Rule:");
  lines.push("- The implementation root must be the Git repository root.");
  lines.push("- Before modifying implementation files, run: git rev-parse --show-toplevel");
  lines.push("- The returned path must equal the implementation root.");
  lines.push(
    "- If it returns a parent folder, the AIQT control root, or any path other than the implementation root, stop and correct the repository boundary before continuing.",
  );
  lines.push(
    "- Do not rely on a parent Git repository. Do not commit implementation Work Unit changes to the AIQT control repository, unless the user has explicitly defined the AIQT control root and implementation root as the same repository.",
  );
  return lines.join("\n");
}

/**
 * §11.1/F063 §8.1: aiqt prompt driver's Source Control Discipline block.
 * Optionally names the AIQT control root and implementation root when known,
 * and always includes the pre-Work-Unit repository boundary preflight.
 */
export function renderDriverSourceControlDisciplineSection(input?: {
  controlRoot?: string | null;
  implementationRoot?: string | null;
}): string {
  const controlRoot = input?.controlRoot ?? null;
  const implementationRoot = input?.implementationRoot ?? null;
  const lines: string[] = [];
  lines.push("Source Control Discipline:");
  lines.push("- Confirm the implementation root before making any changes.");
  if (controlRoot !== null || implementationRoot !== null) {
    lines.push(`- AIQT control root: ${controlRoot ?? "(unknown)"}`);
    lines.push(
      `- Implementation root: ${implementationRoot ?? "not yet configured -- do not assume the control root is the implementation root"}`,
    );
  }
  lines.push("");
  lines.push(renderRepositoryBoundaryRule());
  lines.push("");
  lines.push("Pre-Work-Unit source-control preflight (run from the implementation root):");
  lines.push("git rev-parse --show-toplevel");
  lines.push("git branch --show-current");
  lines.push("git status --short");
  lines.push(
    "- Git top-level must exactly equal the implementation root; branch should be main unless the user explicitly configured a different branch policy; status should be clean, or contain only intentional scaffold files before the baseline commit.",
  );
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
  lines.push(
    "Initialize this repository inside the implementation root itself, not the AIQT control root or any parent folder (F063).",
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
 * §11.3/M16 §13.3: the packet Source Control Expectations section, scoped to
 * the selected work unit/milestone so the tag/commit example is concrete and
 * copy-paste-able (matching the m###-wu###-done convention). When the
 * resolved implementationRoot is known, the boundary comparison names the
 * exact path instead of the generic instruction.
 */
export function renderSourceControlExpectationsSection(input: {
  workUnitId: string;
  milestoneId: string;
  implementationRoot?: string | null;
}): string {
  const tag = `${input.milestoneId.toLowerCase()}-${input.workUnitId.toLowerCase()}-done`;
  const lines: string[] = [];
  lines.push("## Source Control Expectations");
  lines.push("");
  if (input.implementationRoot) {
    lines.push(`Implementation root: ${input.implementationRoot}`);
    lines.push("");
  }
  lines.push(renderRepositoryBoundaryRule());
  lines.push("");
  lines.push(
    input.implementationRoot
      ? `- Run \`git rev-parse --show-toplevel\` from the implementation root before editing files for this Work Unit; the result must equal ${input.implementationRoot}, or stop and correct the repository boundary before continuing (F063).`
      : "- Run `git rev-parse --show-toplevel` from the implementation root before editing files for this Work Unit; stop and correct the repository boundary if it does not equal the implementation root (F063).",
  );
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

/**
 * §11.4/M16 §13.4: checkpoint prompt reminder to report source-control/risk
 * details using only existing checkpoint fields. When the resolved
 * implementationRoot is known, it is named explicitly rather than left as a
 * blank field for the agent to fill in.
 */
export function renderCheckpointSourceControlGuidance(implementationRoot?: string | null): string {
  const lines: string[] = [];
  lines.push("Report source control and risk details in summary and/or notes using this shape:");
  lines.push("");
  lines.push("Source control report:");
  lines.push(
    implementationRoot ? `- Implementation root: ${implementationRoot}` : "- Implementation root:",
  );
  lines.push("- Git top-level (git rev-parse --show-toplevel):");
  lines.push("- Boundary verified: yes/no");
  lines.push("- Current branch:");
  lines.push("- Git status before checkpoint:");
  lines.push("- Commit created: yes/no");
  lines.push("- Commit hash:");
  lines.push("- Tag created: yes/no");
  lines.push("- Tag name:");
  lines.push("- Uncommitted files remaining:");
  lines.push("- Ignored/generated artifacts:");
  lines.push("");
  lines.push(
    `Report file paths relative to the implementation root${implementationRoot ? ` (${implementationRoot})` : ""}, unless explicitly reporting AIQT control files.`,
  );
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
