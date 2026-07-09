import type { PacketContext } from "./agent-packet-service.js";
import type { Dependency } from "../schema/dependency.schema.js";

function bulletList(items: readonly string[]): string {
  return items
    .filter((item) => item.trim() !== "")
    .map((item) => `- ${item}`)
    .join("\n");
}

function renderDependency(dep: Dependency): string {
  return `- ${dep.type} from ${dep.fromId}${dep.reason ? `: ${dep.reason}` : ""}.`;
}

/**
 * Render the bounded agent execution packet as markdown-like text. Heading
 * order and semantic sections are stable; only whitespace may vary between
 * renders of otherwise-identical context.
 */
export function renderAgentPacket(context: PacketContext): string {
  const lines: string[] = [];

  lines.push("# AGENT EXECUTION PACKET");
  lines.push("");
  lines.push("## Role");
  lines.push("");
  lines.push("You are implementing one bounded work unit for this project.");
  lines.push("");
  lines.push("## Project Objective");
  lines.push("");
  lines.push(context.projectObjective);
  lines.push("");
  lines.push("## Current Work Unit");
  lines.push("");
  lines.push(`ID: ${context.workUnit.id}`);
  lines.push(`Milestone: ${context.milestone.id} - ${context.milestone.title}`);
  lines.push(`Title: ${context.workUnit.title}`);
  lines.push(`Objective: ${context.workUnit.objective}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(bulletList(context.workUnit.scope));
  lines.push("");
  lines.push("## Out of Scope");
  lines.push("");
  lines.push(bulletList(context.workUnit.outOfScope));
  lines.push("");
  lines.push("## Relevant Context");
  lines.push("");

  const relevantLines: string[] = [];
  if (context.targetUsers.length > 0) {
    relevantLines.push(`- Target users: ${context.targetUsers.join(", ")}.`);
  }
  if (context.technologyPreferences.length > 0) {
    relevantLines.push(
      `- Technology preference: ${context.technologyPreferences.join(", ")}.`,
    );
  }
  if (context.businessRules.length > 0) {
    relevantLines.push(`- Business rule: ${context.businessRules.join(", ")}.`);
  }
  for (const req of context.referencedRequirements) {
    relevantLines.push(`- Requirement [${req.id}]: ${req.title} - ${req.description}`);
    relevantLines.push(`  Acceptance criteria: ${req.acceptanceCriteria.join("; ")}`);
  }
  for (const dec of context.referencedDecisions) {
    relevantLines.push(`- Decision [${dec.id}]: ${dec.decision}`);
    relevantLines.push(`  Reason: ${dec.reason}`);
    relevantLines.push(`  Impact: ${dec.impact}`);
  }
  for (const risk of context.referencedRisks) {
    relevantLines.push(`- Risk [${risk.id}]: ${risk.title} - Severity: ${risk.severity}`);
    relevantLines.push(`  Mitigation: ${risk.mitigation ?? "None recorded"}`);
  }
  for (const asm of context.referencedAssumptions) {
    relevantLines.push(`- Assumption [${asm.id}]: ${asm.statement}`);
    relevantLines.push(`  Reason: ${asm.reason ?? "None recorded"}`);
  }
  for (const oq of context.referencedOpenQuestions) {
    relevantLines.push(`- Open Question [${oq.id}]: ${oq.question}`);
    relevantLines.push(`  Impact: ${oq.impact}`);
    relevantLines.push(`  Status: ${oq.status}`);
    relevantLines.push(`  Answer: ${oq.answer ?? "Unanswered"}`);
  }
  lines.push(relevantLines.length > 0 ? relevantLines.join("\n") : "- None.");
  lines.push("");

  lines.push("## Constraints");
  lines.push("");
  lines.push(context.constraints.length > 0 ? bulletList(context.constraints) : "- None.");
  lines.push("");

  lines.push("## Dependencies");
  lines.push("");
  lines.push(
    context.dependencies.length > 0
      ? context.dependencies.map(renderDependency).join("\n")
      : "- None.",
  );
  lines.push("");

  lines.push("## Acceptance Criteria");
  lines.push("");
  lines.push(bulletList(context.workUnit.acceptanceCriteria));
  lines.push("");

  lines.push("## Suggested Files / Areas");
  lines.push("");
  lines.push(
    context.workUnit.suggestedFiles.length > 0
      ? bulletList(context.workUnit.suggestedFiles)
      : "- None.",
  );
  lines.push("");

  lines.push("## Validation Commands");
  lines.push("");
  lines.push("```bash");
  lines.push(context.workUnit.validationCommands.join("\n"));
  lines.push("```");
  lines.push("");

  lines.push("## Required Agent Output");
  lines.push("");
  lines.push("Return:");
  lines.push("1. Summary of implementation");
  lines.push("2. Files created");
  lines.push("3. Files modified");
  lines.push("4. Tests added or changed");
  lines.push("5. Validation commands run and results");
  lines.push("6. Unresolved issues");
  lines.push("7. Suggested next step");

  return lines.join("\n");
}
