import type { ProjectModel } from "../../schema/project.schema.js";

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "(none)";
}

const UPDATE_JSON_SHAPE = {
  project: {
    objective: "...",
    targetUsers: ["..."],
    preferredAgent: "...",
    existingRepositoryPath: "...",
  },
  context: {
    constraints: ["..."],
    nonGoals: ["..."],
    technologyPreferences: ["..."],
    businessRules: ["..."],
    architectureNotes: ["..."],
  },
  requirements: [
    {
      title: "...",
      description: "...",
      priority: "medium",
      type: "functional",
      acceptanceCriteria: ["..."],
      status: "draft",
    },
  ],
  decisions: [],
  assumptions: [],
  risks: [],
  openQuestions: [],
  quality: {
    acceptanceCriteriaRequired: true,
    validationRequiredBeforeDone: true,
    preferredValidationCommands: ["..."],
  },
};

/** Deterministic prompt for aiqt prompt update (§9, §13.2). */
export function renderUpdatePrompt(project: ProjectModel): string {
  const lines: string[] = [];
  lines.push("You are helping create or refine AIQT project context input.");
  lines.push("Return JSON only. Do not wrap the JSON in markdown, unless explicitly asked for explanation.");
  lines.push("Do not modify any source code.");
  lines.push("");
  lines.push("Current project objective:");
  lines.push(project.project.objective || "(none recorded yet)");
  lines.push("");
  lines.push("Current target users:");
  lines.push(listOrNone(project.project.targetUsers));
  lines.push("");
  lines.push("Current context:");
  lines.push(`- Constraints: ${listOrNone(project.context.constraints)}`);
  lines.push(`- Non-goals: ${listOrNone(project.context.nonGoals)}`);
  lines.push(`- Technology preferences: ${listOrNone(project.context.technologyPreferences)}`);
  lines.push(`- Business rules: ${listOrNone(project.context.businessRules)}`);
  lines.push(`- Architecture notes: ${listOrNone(project.context.architectureNotes)}`);
  lines.push("");
  lines.push("Create an update JSON with this shape (all fields optional, include only what should change):");
  lines.push(JSON.stringify(UPDATE_JSON_SHAPE, null, 2));
  lines.push("");
  lines.push("Save the returned JSON to .aiqt/inputs/update.json.");
  lines.push("Then run: aiqt import update --from-file .aiqt/inputs/update.json");
  return lines.join("\n");
}
