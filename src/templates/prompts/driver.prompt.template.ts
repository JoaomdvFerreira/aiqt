import type { ProjectModel } from "../../schema/project.schema.js";
import type { StateModel } from "../../schema/state.schema.js";
import {
  detectUiHeavyForProject,
  isUiHeavy,
} from "../../workflow/design/ui-heavy-detection.js";
import {
  shouldIncludeWorkingDirectoryDiscipline,
  renderWorkingDirectoryDisciplineSection,
  renderNoImplementationRootWarning,
  renderRecoveryDisciplineSection,
} from "../../workflow/agent-operating-discipline.js";

export interface DriverPromptInput {
  project: ProjectModel | null;
  state: StateModel | null;
  idea: string | null;
  repoRoot?: string | null;
}

/**
 * Deterministic master operating prompt for aiqt prompt driver (§6.1,
 * Appendix B). Usable before or after aiqt init: when .aiqt/ is unavailable
 * the prompt instructs the agent to initialize first instead of failing.
 */
export function renderDriverPrompt(input: DriverPromptInput): string {
  const { project, state, idea, repoRoot = null } = input;
  const lines: string[] = [];

  lines.push("You are using AIQT as the workflow controller for this project.");
  lines.push("");
  lines.push("Do not immediately implement from the rough idea.");
  lines.push(
    "First use AIQT to capture context, ask questions, build a plan, and execute one bounded work unit at a time.",
  );
  lines.push("");

  if (idea) {
    lines.push("Rough idea:");
    lines.push(idea);
    lines.push("");
  }

  // M13 §11.1: shared detector -- not reimplemented here. High/medium
  // UI-heavy confidence tells the external agent not to jump straight into
  // UI implementation.
  const uiHeavyResult = detectUiHeavyForProject({ project, idea, repoRoot });
  if (isUiHeavy(uiHeavyResult.confidence)) {
    lines.push("Design-system guidance:");
    lines.push("This project appears UI-heavy. Do not jump directly into UI implementation.");
    lines.push(
      "First use AIQT to capture enough product and design-system context (aiqt prompt interview), then create a plan that includes design-system foundation work before feature screens (aiqt prompt plan).",
    );
    lines.push("");
  }

  // M14 §8: working-directory discipline (F054/F055). Never invents an
  // implementation root -- warns when none is configured instead.
  const controlRoot = repoRoot ?? process.cwd();
  const existingRepositoryPath = project?.project.existingRepositoryPath ?? null;
  if (shouldIncludeWorkingDirectoryDiscipline({ controlRoot, existingRepositoryPath })) {
    lines.push(renderWorkingDirectoryDisciplineSection({ controlRoot, existingRepositoryPath }));
    lines.push("");
  } else {
    lines.push(renderNoImplementationRootWarning(controlRoot));
    lines.push("");
  }

  // M14 §10: recovery discipline (F057) -- prefer M11/M12 controls before
  // reset/reimport. Does not change aiqt graph validate/repair behavior.
  lines.push(renderRecoveryDisciplineSection());
  lines.push("");

  lines.push("Preferred agent path:");
  lines.push("- Run aiqt init if .aiqt/ does not exist.");
  lines.push("- Run aiqt start.");
  lines.push(
    idea
      ? `- Run aiqt prompt interview --idea "${idea}".`
      : "- Run aiqt prompt interview.",
  );
  lines.push("- Ask the user the generated questions.");
  lines.push("- Convert answers into valid update JSON.");
  lines.push("- Pipe the JSON into aiqt import update --stdin.");
  lines.push("- Run aiqt prompt plan.");
  lines.push("- Convert the plan into valid plan JSON.");
  lines.push("- Pipe the JSON into aiqt import plan --stdin.");
  lines.push("- Run aiqt next.");
  lines.push("- Implement only the current work unit.");
  lines.push("- Pipe checkpoint JSON into aiqt import checkpoint --stdin.");
  lines.push("- Continue until aiqt review and aiqt export report the project is complete.");
  lines.push("");

  lines.push("Optional human-review path:");
  lines.push(
    "Save generated JSON under .aiqt/inputs/ and use aiqt import <type> --from-file <path> instead of --stdin when a human wants to inspect the JSON first.",
  );
  lines.push("");

  lines.push("Do not manually edit .aiqt/project.json or .aiqt/state.json.");
  lines.push("Do not create markdown source-of-truth files.");
  lines.push("");

  lines.push("Current workflow state:");
  if (!project || !state) {
    lines.push("No AIQT project found yet in this folder. Run aiqt init first.");
  } else {
    lines.push(`Project status: ${state.projectStatus}.`);
    lines.push(`Next recommended command: ${state.nextRecommendedCommand ?? "aiqt start"}.`);
  }

  return lines.join("\n");
}
