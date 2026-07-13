import type { ProjectModel } from "../../schema/project.schema.js";

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
  lines.push("Create a plan JSON with this shape:");
  lines.push(JSON.stringify(PLAN_JSON_SHAPE, null, 2));
  lines.push("");
  lines.push("Save the returned JSON to .aiqt/inputs/plan.json.");
  lines.push("Then run: aiqt import plan --from-file .aiqt/inputs/plan.json");
  return lines.join("\n");
}
