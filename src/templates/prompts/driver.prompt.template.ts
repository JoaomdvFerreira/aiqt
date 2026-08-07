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
import { renderDriverSourceControlDisciplineSection } from "../../workflow/source-control-discipline.js";
import { resolveRoots, renderRootContextSection } from "../../workflow/root-resolution.js";

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

  // M16 §13.1: always-rendered root context (F064) -- removes the need for
  // the user to repeat root paths in every prompt. Computed once and reused
  // by every root-aware guidance surface below.
  const roots = resolveRoots({
    controlRoot: repoRoot ?? process.cwd(),
    existingRepositoryPath: project?.project.existingRepositoryPath ?? null,
  });
  lines.push(renderRootContextSection(roots));
  lines.push("");

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
  if (
    shouldIncludeWorkingDirectoryDiscipline({
      controlRoot: roots.controlRoot,
      existingRepositoryPath: roots.existingRepositoryPath,
    })
  ) {
    lines.push(
      renderWorkingDirectoryDisciplineSection({
        controlRoot: roots.controlRoot,
        existingRepositoryPath: roots.existingRepositoryPath,
      }),
    );
    lines.push("");
  } else {
    lines.push(renderNoImplementationRootWarning(roots.controlRoot));
    lines.push("");
  }

  // M14 §10: recovery discipline (F057) -- prefer M11/M12 controls before
  // reset/reimport. Does not change aiqt graph validate/repair behavior.
  lines.push(renderRecoveryDisciplineSection());
  lines.push("");

  // M15 §11.1/M15-RC1 §8.1/M16 §9: source-control and repository-boundary
  // discipline (F058-F062, F063), consuming the resolved implementationRoot
  // computed once above. Guidance only -- AIQT never executes Git/GitHub
  // commands itself.
  lines.push(
    renderDriverSourceControlDisciplineSection({
      controlRoot: roots.controlRoot,
      implementationRoot: roots.implementationRoot,
    }),
  );
  lines.push("");

  // M17/M17-RC1 §16: mention progressive planning when a non-empty graph
  // still has an untouched, undetailed future work unit and nothing is
  // currently in progress -- the moment aiqt plan --extend becomes the
  // right next step instead of hand-editing canonical files. It also always
  // mentions append for adding further milestones/work units/dependencies.
  if (state && state.workGraph.milestones.length > 0 && state.currentWorkUnitId === null) {
    lines.push("Progressive planning guidance:");
    lines.push(
      "This project's work graph already exists. To add further milestones, work units, or dependencies, run aiqt prompt plan --extend rather than editing .aiqt/state.json directly.",
    );
    const target = state.workGraph.workUnits.find(
      (wu) => (wu.status === "ready" || wu.status === "planned") && !wu.replacedByWorkUnitIds,
    );
    if (target) {
      lines.push(
        `Work unit "${target.id}" looks like an undetailed future work unit. To refine it into a detailed replacement subgraph, run aiqt prompt plan --extend --refine-work-unit ${target.id}.`,
      );
    }
    lines.push(
      "Always preview an append or refinement before applying it, and keep each step bounded unless the user asks for deeper planning.",
    );
    lines.push("");
  }

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

  // M39 §9 ("Prompt/autonomous integration"): static operating-discipline
  // text only -- no classification/recommendation logic lives here. The
  // real, per-Work-Unit Execution Guidance is computed once by the single
  // shared decision owner (src/workflow/execution-guidance.ts) and printed
  // by `aiqt next` itself (M39-WU-HF01); this section only tells the agent
  // to follow that already-rendered block rather than re-deriving its own
  // judgment about context breadth or validation depth.
  lines.push("Execution guidance discipline:");
  lines.push(
    "Running aiqt next prints an Execution Guidance block for the selected work unit (complexity, reasoning effort, agent class, context priorities, validation tiers, subagent policy). Follow it rather than re-deriving your own judgment.",
  );
  lines.push(
    "Start from the block's must-read/should-read context; expand beyond it only when evidence in the repository shows that context was insufficient, not as a default habit.",
  );
  lines.push(
    "Follow the block's validation guidance for this work unit (ordinarily static + focused). Do not default to running the full test suite after every work unit; broad/full validation is expected at milestone/release closure, or when the block itself records an explicit reason.",
  );
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
