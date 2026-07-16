import type { ProjectModel } from "../../schema/project.schema.js";
import { detectsFullStackSignals } from "../../workflow/full-stack-detection.js";
import {
  detectUiHeavyForProject,
  isUiHeavy,
} from "../../workflow/design/ui-heavy-detection.js";
import { renderDesignSystemPlannerBlock } from "../design-system-planner-template.js";
import {
  detectComponentSystemPreference,
  requiresShadcnEnforcement,
  renderShadcnPlanningGuidance,
} from "../../workflow/component-system-preferences.js";
import {
  requiresRepositoryBaselineWorkUnit,
  renderPlanRepositoryBaselineGuidance,
} from "../../workflow/source-control-discipline.js";
import { resolveRoots } from "../../workflow/root-resolution.js";

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "(none)";
}

function summariesOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join("; ") : "(none)";
}

/** Requirements are shown with their ids so the planning agent can reference a specific one in agentContextRefs instead of the whole category. */
function requirementsWithIdsOrNone(requirements: ProjectModel["requirements"]): string {
  if (requirements.length === 0) return "(none)";
  return requirements.map((r) => `[${r.id}] ${r.title}`).join("; ");
}

const PLAN_JSON_SHAPE = {
  milestones: [{ clientKey: "...", title: "...", objective: "..." }],
  workUnits: [
    {
      clientKey: "...",
      milestoneClientKey: "...",
      title: "...",
      objective: "...",
      scope: ["..."],
      outOfScope: ["..."],
      acceptanceCriteria: ["..."],
      agentContextRefs: [],
      suggestedFiles: ["..."],
      validationCommands: ["..."],
    },
  ],
  dependencies: [],
};

/** Deterministic prompt for aiqt prompt plan (§9, §13.3, Appendix B.1). */
export function renderPlanPrompt(project: ProjectModel, repoRoot: string | null = null): string {
  const lines: string[] = [];
  lines.push("You are helping create an AIQT structured plan input.");
  lines.push("Return JSON only. Do not wrap the JSON in markdown.");
  lines.push("Do not modify any source code.");
  lines.push("");
  lines.push("Project objective:");
  lines.push(project.project.objective || "(none recorded yet)");
  lines.push("");
  lines.push("Target users:");
  lines.push(listOrNone(project.project.targetUsers));
  lines.push("");
  lines.push("Relevant context:");
  lines.push(`- Constraints: ${listOrNone(project.context.constraints)}`);
  lines.push(`- Technology preferences: ${listOrNone(project.context.technologyPreferences)}`);
  lines.push(`- Business rules: ${listOrNone(project.context.businessRules)}`);
  lines.push(`- Requirements: ${requirementsWithIdsOrNone(project.requirements)}`);
  lines.push(`- Decisions: ${summariesOrNone(project.decisions.map((d) => d.decision))}`);
  lines.push(`- Risks: ${summariesOrNone(project.risks.map((r) => r.title))}`);
  lines.push(`- Assumptions: ${summariesOrNone(project.assumptions.map((a) => a.statement))}`);
  lines.push(`- Open questions: ${summariesOrNone(project.openQuestions.map((q) => q.question))}`);
  lines.push(
    `- Quality expectations: acceptanceCriteriaRequired=${project.quality.acceptanceCriteriaRequired}, validationRequiredBeforeDone=${project.quality.validationRequiredBeforeDone}, preferredValidationCommands=${listOrNone(project.quality.preferredValidationCommands)}`,
  );
  lines.push("");
  lines.push("agentContextRefs guidance:");
  lines.push(
    "- agentContextRefs controls which additional project context is copied into that work unit's agent packet later.",
  );
  lines.push(
    '- Broad category refs such as "requirements" include EVERY record of that category in the packet, not just the ones relevant to that work unit.',
  );
  lines.push(
    '- For a narrowly scoped work unit, prefer a specific record id instead, for example ["REQ-001"] rather than ["requirements"].',
  );
  lines.push("- Only use a broad category ref when the work unit genuinely needs the full category.");
  lines.push(
    "- If no specific record is directly relevant, omit agentContextRefs and rely on the work unit's own scope and acceptanceCriteria.",
  );
  lines.push("");

  // M16 §13.2: planning guidance should know whether this is a same-root or
  // split-root project, using the same resolved roots consumed everywhere
  // else (F064).
  const roots = resolveRoots({
    controlRoot: repoRoot ?? process.cwd(),
    existingRepositoryPath: project.project.existingRepositoryPath,
  });
  lines.push("Root context:");
  lines.push(
    roots.sameRoot
      ? `- Same-root project: the AIQT control root and implementation root are both ${roots.controlRoot}.`
      : `- Split-root project: AIQT control root is ${roots.controlRoot}; implementation root is ${roots.implementationRoot}.`,
  );
  lines.push("");

  const detectionText = [
    project.project.objective,
    project.context.technologyPreferences.join(" "),
    project.context.constraints.join(" "),
    project.context.architectureNotes.join(" "),
  ].join(" ");
  if (detectsFullStackSignals(detectionText)) {
    lines.push("Full-stack planning guidance:");
    lines.push(
      "This project appears to be a full-stack/web application. For each relevant work unit, consider:",
    );
    lines.push("- data model/schema and seed data assumptions");
    lines.push("- auth boundaries, roles, permissions, and protected routes");
    lines.push("- routes/pages in the Next.js App Router or equivalent router");
    lines.push("- UI components and forms");
    lines.push("- server actions, API routes, or backend service functions");
    lines.push("- form validation, error states, loading states, and empty states");
    lines.push("- environment variables and integration assumptions");
    lines.push("- test and validation strategy");
    lines.push("- deployment assumptions and non-goals");
    lines.push(
      "Keep work units bounded. Do not create one massive work unit for the whole app.",
    );
    lines.push("");
  }

  // M13 §9/§10: inject the built-in design-system planner for high/medium
  // UI-heavy projects only. Shared detector -- not reimplemented here.
  const uiHeavyResult = detectUiHeavyForProject({ project, repoRoot });
  if (isUiHeavy(uiHeavyResult.confidence)) {
    lines.push(renderDesignSystemPlannerBlock(uiHeavyResult.confidence as "high" | "medium"));
    lines.push("");
  }

  // M14 §9: harden component-system enforcement (F053) -- reuses the same
  // M13 UI-heavy detector's shadcn-ui signal, not a second detector.
  const componentSystemPreference = detectComponentSystemPreference({ project, repoRoot });
  if (requiresShadcnEnforcement(componentSystemPreference)) {
    lines.push(renderShadcnPlanningGuidance());
    lines.push("");
  }

  // M15 §6.3/§11.2: require an early repository initialization/baseline
  // work unit for new implementation projects unless source control already
  // exists or the user explicitly disables it (F058).
  if (requiresRepositoryBaselineWorkUnit({ project, repoRoot })) {
    lines.push(renderPlanRepositoryBaselineGuidance());
    lines.push("");
  }

  lines.push("Create a plan JSON with this shape:");
  lines.push(JSON.stringify(PLAN_JSON_SHAPE, null, 2));
  lines.push("");
  lines.push("Preferred agent path:");
  lines.push("Pipe the JSON directly into:");
  lines.push("aiqt import plan --stdin");
  lines.push("");
  lines.push("Optional human-review path:");
  lines.push("Save the JSON under .aiqt/inputs/ and run:");
  lines.push("aiqt import plan --from-file .aiqt/inputs/plan.json");
  return lines.join("\n");
}

const PLAN_REFINEMENT_JSON_SHAPE = {
  extension: {
    entryWorkUnitClientKeys: ["..."],
    exitWorkUnitClientKeys: ["..."],
    reason: "...",
  },
  milestones: [{ clientKey: "...", title: "...", objective: "..." }],
  workUnits: [
    {
      clientKey: "...",
      milestoneClientKey: "...",
      title: "...",
      objective: "...",
      scope: ["..."],
      outOfScope: ["..."],
      acceptanceCriteria: ["..."],
      agentContextRefs: [],
      suggestedFiles: ["..."],
      validationCommands: ["..."],
    },
  ],
  dependencies: [],
};

/**
 * M17-RC1 §5.2/§6: deterministic prompt for `aiqt prompt plan --extend
 * --refine-work-unit <id>`, explaining how to produce a bounded refinement
 * payload for the named target work unit. Read-only -- it does not validate
 * or mutate the current graph itself.
 */
export function renderPlanRefinePrompt(targetWorkUnitId: string): string {
  const lines: string[] = [];
  lines.push("You are helping create an AIQT plan REFINEMENT input for an existing work graph.");
  lines.push("Return JSON only. Do not wrap the JSON in markdown.");
  lines.push("Do not modify any source code.");
  lines.push("");
  lines.push(`Target work unit to refine: ${targetWorkUnitId}`);
  lines.push(
    `This work unit is preserved and marked "replanned" -- it is never deleted, and it is never selected by aiqt next again.`,
  );
  lines.push("");
  lines.push("Guidance:");
  lines.push("- Detail only the next bounded piece of work unless the user asks for deeper planning.");
  lines.push(
    "- entryWorkUnitClientKeys must reference work units in this payload that become the first executable nodes of the replacement subgraph.",
  );
  lines.push(
    "- exitWorkUnitClientKeys must reference work units in this payload whose completion should satisfy any downstream work the target currently blocks.",
  );
  lines.push(
    "- AIQT copies every existing incoming blocks/requires dependency of the target to every declared entry, and every existing outgoing blocks/requires dependency from every declared exit, preserving each original dependency type exactly.",
  );
  lines.push("- relates_to dependencies are never copied automatically and never affect readiness.");
  lines.push("- reason must explain why this work unit is being refined now.");
  lines.push("");
  lines.push("Create a refinement JSON with this shape:");
  lines.push(JSON.stringify(PLAN_REFINEMENT_JSON_SHAPE, null, 2));
  lines.push("");
  lines.push("Always preview before applying:");
  lines.push(
    `aiqt import plan --stdin --extend --refine-work-unit ${targetWorkUnitId} --preview`,
  );
  lines.push("");
  lines.push("Preferred agent path (after a successful preview):");
  lines.push("Pipe the JSON directly into:");
  lines.push(`aiqt import plan --stdin --extend --refine-work-unit ${targetWorkUnitId}`);
  lines.push("");
  lines.push("Optional human-review path:");
  lines.push("Save the JSON under .aiqt/inputs/ and run:");
  lines.push(
    `aiqt plan --extend --refine-work-unit ${targetWorkUnitId} --from-file .aiqt/inputs/work-unit-refinement.json --preview`,
  );
  lines.push(
    `aiqt plan --extend --refine-work-unit ${targetWorkUnitId} --from-file .aiqt/inputs/work-unit-refinement.json`,
  );
  lines.push("");
  lines.push("After a successful refinement, validate before continuing:");
  lines.push("aiqt graph validate");
  lines.push("aiqt review");
  lines.push("aiqt status");
  lines.push("aiqt next --preview");
  lines.push("");
  lines.push(
    "Do not execute the first new work unit in this same planning-only session unless the user explicitly instructs it.",
  );
  lines.push("");
  lines.push(
    "Note: --replace-placeholder is a deprecated alias for --refine-work-unit, kept only for backward compatibility. Do not use it in new work.",
  );
  return lines.join("\n");
}

const PLAN_APPEND_JSON_SHAPE = {
  milestones: [{ clientKey: "...", title: "...", objective: "..." }],
  workUnits: [
    {
      clientKey: "...",
      milestoneClientKey: "... (a new clientKey above, or an existing milestone id)",
      title: "...",
      objective: "...",
      scope: ["..."],
      outOfScope: ["..."],
      acceptanceCriteria: ["..."],
      agentContextRefs: [],
      suggestedFiles: ["..."],
      validationCommands: ["..."],
    },
  ],
  dependencies: [
    {
      fromClientKey: "... (a new clientKey above, or an existing work-unit id)",
      toClientKey: "... (a new clientKey above, or an existing work-unit id)",
      type: "blocks",
    },
  ],
};

/**
 * M17-RC1 §5.1/§7: deterministic prompt for `aiqt prompt plan --extend`
 * with no refinement target, explaining how to produce a bounded append
 * payload for an existing non-empty graph. Read-only -- it does not
 * validate or mutate the current graph itself.
 */
export function renderPlanAppendPrompt(): string {
  const lines: string[] = [];
  lines.push("You are helping create an AIQT plan APPEND input for an existing work graph.");
  lines.push("Return JSON only. Do not wrap the JSON in markdown.");
  lines.push("Do not modify any source code.");
  lines.push("");
  lines.push("Append adds milestones, work units, and/or dependencies to the existing graph.");
  lines.push("It never targets, replaces, or changes the status of any existing work unit or milestone.");
  lines.push("");
  lines.push("Guidance:");
  lines.push("- milestones and workUnits may both be empty for a dependency-only append.");
  lines.push(
    "- milestoneClientKey on a work unit may name either a new milestone clientKey declared in this payload, or an existing milestone id already in the graph.",
  );
  lines.push(
    "- fromClientKey/toClientKey on a dependency may each name either a new work-unit clientKey declared in this payload, or an existing work-unit id already in the graph.",
  );
  lines.push("- Do not include a target work unit -- append never refines or replaces existing work.");
  lines.push("");
  lines.push("Create an append JSON with this shape:");
  lines.push(JSON.stringify(PLAN_APPEND_JSON_SHAPE, null, 2));
  lines.push("");
  lines.push("Always preview before applying:");
  lines.push("aiqt import plan --stdin --extend --preview");
  lines.push("");
  lines.push("Preferred agent path (after a successful preview):");
  lines.push("Pipe the JSON directly into:");
  lines.push("aiqt import plan --stdin --extend");
  lines.push("");
  lines.push("Optional human-review path:");
  lines.push("Save the JSON under .aiqt/inputs/ and run:");
  lines.push("aiqt plan --extend --from-file .aiqt/inputs/plan-append.json --preview");
  lines.push("aiqt plan --extend --from-file .aiqt/inputs/plan-append.json");
  lines.push("");
  lines.push("After a successful append, validate before continuing:");
  lines.push("aiqt graph validate");
  lines.push("aiqt review");
  lines.push("aiqt status");
  lines.push("aiqt next --preview");
  return lines.join("\n");
}
