import type { ProjectModel } from "../../schema/project.schema.js";

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "(none)";
}

function summariesOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join("; ") : "(none)";
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
export function renderPlanPrompt(project: ProjectModel): string {
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
  lines.push(`- Requirements: ${summariesOrNone(project.requirements.map((r) => r.title))}`);
  lines.push(`- Decisions: ${summariesOrNone(project.decisions.map((d) => d.decision))}`);
  lines.push(`- Risks: ${summariesOrNone(project.risks.map((r) => r.title))}`);
  lines.push(`- Assumptions: ${summariesOrNone(project.assumptions.map((a) => a.statement))}`);
  lines.push(`- Open questions: ${summariesOrNone(project.openQuestions.map((q) => q.question))}`);
  lines.push(
    `- Quality expectations: acceptanceCriteriaRequired=${project.quality.acceptanceCriteriaRequired}, validationRequiredBeforeDone=${project.quality.validationRequiredBeforeDone}, preferredValidationCommands=${listOrNone(project.quality.preferredValidationCommands)}`,
  );
  lines.push("");
  lines.push("Create a plan JSON with this shape:");
  lines.push(JSON.stringify(PLAN_JSON_SHAPE, null, 2));
  lines.push("");
  lines.push("Save the returned JSON to .aiqt/inputs/plan.json.");
  lines.push("Then run: aiqt import plan --from-file .aiqt/inputs/plan.json");
  return lines.join("\n");
}
