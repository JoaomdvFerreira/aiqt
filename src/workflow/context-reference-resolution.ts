import type { ProjectModel } from "../schema/project.schema.js";
import type { Requirement, Decision, Risk, Assumption, OpenQuestion } from "../schema/common.schema.js";

/** The one interpretation of work-unit context references used by packets and handoff. */
export interface ResolvedContextRefs {
  requirements: Requirement[];
  decisions: Decision[];
  risks: Risk[];
  assumptions: Assumption[];
  openQuestions: OpenQuestion[];
  unresolvedRefs: string[];
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

/**
 * A reference is either a supported collection alias or an exact canonical
 * record id. Unknown references remain explicit; they are never guessed as
 * paths or silently discarded.
 */
export function resolveContextReferences(refs: readonly string[], project: ProjectModel): ResolvedContextRefs {
  const requirements: Requirement[] = [];
  const decisions: Decision[] = [];
  const risks: Risk[] = [];
  const assumptions: Assumption[] = [];
  const openQuestions: OpenQuestion[] = [];
  const unresolvedRefs: string[] = [];
  for (const ref of refs) {
    if (ref === "requirements") requirements.push(...project.requirements);
    else if (ref === "decisions") decisions.push(...project.decisions);
    else if (ref === "risks") risks.push(...project.risks);
    else if (ref === "assumptions") assumptions.push(...project.assumptions);
    else if (ref === "openQuestions") openQuestions.push(...project.openQuestions);
    else {
      const requirement = project.requirements.find((item) => item.id === ref);
      const decision = project.decisions.find((item) => item.id === ref);
      const risk = project.risks.find((item) => item.id === ref);
      const assumption = project.assumptions.find((item) => item.id === ref);
      const openQuestion = project.openQuestions.find((item) => item.id === ref);
      if (requirement) requirements.push(requirement);
      else if (decision) decisions.push(decision);
      else if (risk) risks.push(risk);
      else if (assumption) assumptions.push(assumption);
      else if (openQuestion) openQuestions.push(openQuestion);
      else unresolvedRefs.push(ref);
    }
  }
  return {
    requirements: dedupeById(requirements), decisions: dedupeById(decisions), risks: dedupeById(risks),
    assumptions: dedupeById(assumptions), openQuestions: dedupeById(openQuestions), unresolvedRefs,
  };
}
