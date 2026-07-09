import type { Issue } from "../core/output/issue.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";
import type {
  Requirement,
  Decision,
  Risk,
  Assumption,
  OpenQuestion,
} from "../schema/common.schema.js";

export interface PacketContext {
  projectId: string;
  projectObjective: string;
  targetUsers: string[];
  milestone: Milestone;
  workUnit: WorkUnit;
  constraints: string[];
  technologyPreferences: string[];
  businessRules: string[];
  referencedRequirements: Requirement[];
  referencedDecisions: Decision[];
  referencedRisks: Risk[];
  referencedAssumptions: Assumption[];
  referencedOpenQuestions: OpenQuestion[];
  dependencies: Dependency[];
}

export interface ResolvedContextRefs {
  requirements: Requirement[];
  decisions: Decision[];
  risks: Risk[];
  assumptions: Assumption[];
  openQuestions: OpenQuestion[];
  unresolvedRefs: string[];
}

function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * Resolve `agentContextRefs` against project records. Each ref may be either
 * a bare category name ("requirements", "decisions", "risks", "assumptions",
 * "openQuestions"), which includes every record of that type, or a specific
 * record id ("REQ-001", "D001", ...), which includes just that record. Any
 * ref matching neither pattern is unresolved and reported separately;
 * unresolved refs never block packet generation (section 9).
 */
export function resolveAgentContextRefs(
  refs: readonly string[],
  project: ProjectModel,
): ResolvedContextRefs {
  const requirements: Requirement[] = [];
  const decisions: Decision[] = [];
  const risks: Risk[] = [];
  const assumptions: Assumption[] = [];
  const openQuestions: OpenQuestion[] = [];
  const unresolvedRefs: string[] = [];

  for (const ref of refs) {
    switch (ref) {
      case "requirements":
        requirements.push(...project.requirements);
        continue;
      case "decisions":
        decisions.push(...project.decisions);
        continue;
      case "risks":
        risks.push(...project.risks);
        continue;
      case "assumptions":
        assumptions.push(...project.assumptions);
        continue;
      case "openQuestions":
        openQuestions.push(...project.openQuestions);
        continue;
      default:
        break;
    }

    const requirement = project.requirements.find((r) => r.id === ref);
    if (requirement) {
      requirements.push(requirement);
      continue;
    }
    const decision = project.decisions.find((d) => d.id === ref);
    if (decision) {
      decisions.push(decision);
      continue;
    }
    const risk = project.risks.find((r) => r.id === ref);
    if (risk) {
      risks.push(risk);
      continue;
    }
    const assumption = project.assumptions.find((a) => a.id === ref);
    if (assumption) {
      assumptions.push(assumption);
      continue;
    }
    const openQuestion = project.openQuestions.find((q) => q.id === ref);
    if (openQuestion) {
      openQuestions.push(openQuestion);
      continue;
    }

    unresolvedRefs.push(ref);
  }

  return {
    requirements: dedupeById(requirements),
    decisions: dedupeById(decisions),
    risks: dedupeById(risks),
    assumptions: dedupeById(assumptions),
    openQuestions: dedupeById(openQuestions),
    unresolvedRefs,
  };
}

/** Build the medium-severity, non-blocking warnings for unresolved refs. */
export function buildUnresolvedRefWarnings(
  unresolvedRefs: readonly string[],
): Issue[] {
  return unresolvedRefs.map((ref) => ({
    id: "NEXT-UNRESOLVED-CONTEXT-REF",
    severity: "medium",
    area: "context",
    message: `agentContextRefs entry "${ref}" does not resolve to a known project record.`,
    agentCanFix: false,
  }));
}

/** Build the bounded PacketContext for a single selected work unit. */
export function buildPacketContext(
  project: ProjectModel,
  state: StateModel,
  workUnit: WorkUnit,
  milestone: Milestone,
  resolved: ResolvedContextRefs,
): PacketContext {
  const dependencies = workUnit.dependencies
    .map((depId) => state.workGraph.dependencies.find((d) => d.id === depId))
    .filter((d): d is Dependency => d !== undefined);

  return {
    projectId: project.project.id,
    projectObjective: project.project.objective,
    targetUsers: project.project.targetUsers,
    milestone,
    workUnit,
    constraints: project.context.constraints,
    technologyPreferences: project.context.technologyPreferences,
    businessRules: project.context.businessRules,
    referencedRequirements: resolved.requirements,
    referencedDecisions: resolved.decisions,
    referencedRisks: resolved.risks,
    referencedAssumptions: resolved.assumptions,
    referencedOpenQuestions: resolved.openQuestions,
    dependencies,
  };
}
