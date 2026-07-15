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
import type { DetectedIntegration } from "./skills-detection-service.js";
import { shouldIncludeDesignGuidance } from "../workflow/design/design-guidance-rules.js";
import type { UiHeavyConfidence } from "../workflow/design/ui-heavy-detection.js";
import {
  shouldIncludeWorkingDirectoryDiscipline,
  renderWorkingDirectoryDisciplineSection,
} from "../workflow/agent-operating-discipline.js";
import {
  shouldIncludeComponentSystemGuidance,
  renderComponentSystemGuidanceSection,
  type ComponentSystemPreference,
} from "../workflow/component-system-preferences.js";
import { renderSourceControlExpectationsSection } from "../workflow/source-control-discipline.js";
import { resolveRoots } from "../workflow/root-resolution.js";

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
  /** M10 §12: detected/recommended integrations this work unit's own text touches. Advisory only. */
  relevantSkills: DetectedIntegration[];
  /** M13 §12: true only when the project is UI-heavy (high/medium) AND this specific work unit is UI-related. */
  includeDesignGuidance: boolean;
  /** M14 §8: rendered Working Directory Discipline section, or null when not applicable (no distinct implementation root configured). */
  workingDirectoryDisciplineSection: string | null;
  /** M14 §9: rendered Component System Guidance section, or null when not applicable. */
  componentSystemGuidanceSection: string | null;
  /** M15 §11.3: rendered Source Control Expectations section. Always present -- every selected work unit is implementation work. */
  sourceControlExpectationsSection: string;
  /** M16 §12: resolved implementation root (existingRepositoryPath resolved relative to controlRoot, or controlRoot itself). Always present. */
  implementationRoot: string;
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

/** M10 §12: substring keywords used to decide whether a work unit's own text "touches" a detected integration. */
const INTEGRATION_TOUCH_KEYWORDS: Record<DetectedIntegration["id"], readonly string[]> = {
  supabase: ["supabase"],
  clerk: ["clerk"],
  "shadcn-ui": ["shadcn"],
};

/**
 * M10 §12: filter detected integrations down to the ones this work unit's
 * own text (title, objective, scope, outOfScope, suggestedFiles) actually
 * touches, so packet skill hints stay concise and relevant rather than
 * listing every integration detected anywhere in the repository.
 */
export function selectRelevantSkills(
  workUnit: WorkUnit,
  detectedIntegrations: readonly DetectedIntegration[],
): DetectedIntegration[] {
  const text = [
    workUnit.title,
    workUnit.objective,
    ...workUnit.scope,
    ...workUnit.outOfScope,
    ...workUnit.suggestedFiles,
  ]
    .join(" ")
    .toLowerCase();

  return detectedIntegrations.filter((integration) =>
    INTEGRATION_TOUCH_KEYWORDS[integration.id].some((keyword) => text.includes(keyword)),
  );
}

/** Build the bounded PacketContext for a single selected work unit. */
export function buildPacketContext(
  project: ProjectModel,
  state: StateModel,
  workUnit: WorkUnit,
  milestone: Milestone,
  resolved: ResolvedContextRefs,
  relevantSkills: DetectedIntegration[] = [],
  uiHeavyConfidence: UiHeavyConfidence = "none",
  controlRoot: string | null = null,
  componentSystemPreference: ComponentSystemPreference = "none",
): PacketContext {
  const dependencies = workUnit.dependencies
    .map((depId) => state.workGraph.dependencies.find((d) => d.id === depId))
    .filter((d): d is Dependency => d !== undefined);

  const existingRepositoryPath = project.project.existingRepositoryPath;
  const workingDirectoryDisciplineSection =
    controlRoot !== null &&
    shouldIncludeWorkingDirectoryDiscipline({ controlRoot, existingRepositoryPath })
      ? renderWorkingDirectoryDisciplineSection({ controlRoot, existingRepositoryPath })
      : null;

  const componentSystemGuidanceSection = shouldIncludeComponentSystemGuidance(
    componentSystemPreference,
    workUnit,
  )
    ? renderComponentSystemGuidanceSection()
    : null;

  // M16 §12/§13.3: resolved implementation root, consumed by Source Control
  // Expectations and the Required Agent Output changed-files instruction.
  const roots = resolveRoots({
    controlRoot: controlRoot ?? process.cwd(),
    existingRepositoryPath,
  });

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
    relevantSkills,
    includeDesignGuidance: shouldIncludeDesignGuidance(uiHeavyConfidence, workUnit),
    workingDirectoryDisciplineSection,
    componentSystemGuidanceSection,
    // M15 §11.3/M16 §13.3: unconditional -- every work unit selected by aiqt
    // next is implementation work, so Source Control Expectations always
    // renders, and always names the resolved implementation root.
    sourceControlExpectationsSection: renderSourceControlExpectationsSection({
      workUnitId: workUnit.id,
      milestoneId: milestone.id,
      implementationRoot: roots.implementationRoot,
    }),
    implementationRoot: roots.implementationRoot,
  };
}

export interface PacketGuidanceFlags {
  includesDesignGuidance: boolean;
  includesWorkingDirectoryDiscipline: boolean;
  includesComponentSystemGuidance: boolean;
  /** Packets never render recovery guidance -- driver-only per M14 §10. Always false. */
  includesRecoveryGuidance: boolean;
  /** M15 §13: true whenever Source Control Expectations was rendered. Always true -- every packet includes it. */
  includesSourceControlGuidance: boolean;
}

export interface PacketAuditMetadata {
  renderedSections: string[];
  guidanceFlags: PacketGuidanceFlags;
}

/** M14 §11: the sections aiqt next unconditionally renders in every packet. */
const ALWAYS_RENDERED_PACKET_SECTIONS = [
  "scope",
  "context",
  "constraints",
  "acceptance",
  "validation",
] as const;

/**
 * M14 §11.1: derive the packet audit metadata (renderedSections,
 * guidanceFlags) from the SAME PacketContext fields already used to render
 * the packet body, so the audit record can never drift from what was
 * actually rendered.
 */
export function computePacketAuditMetadata(context: PacketContext): PacketAuditMetadata {
  const renderedSections: string[] = [...ALWAYS_RENDERED_PACKET_SECTIONS];
  if (context.includeDesignGuidance) renderedSections.push("designGuidance");
  if (context.workingDirectoryDisciplineSection !== null) {
    renderedSections.push("workingDirectoryDiscipline");
  }
  if (context.componentSystemGuidanceSection !== null) {
    renderedSections.push("componentSystemGuidance");
  }
  // M15 §13: always rendered -- included in renderedSections unconditionally,
  // matching the packet body, which always includes this section.
  renderedSections.push("sourceControlExpectations");

  return {
    renderedSections,
    guidanceFlags: {
      includesDesignGuidance: context.includeDesignGuidance,
      includesWorkingDirectoryDiscipline: context.workingDirectoryDisciplineSection !== null,
      includesComponentSystemGuidance: context.componentSystemGuidanceSection !== null,
      includesRecoveryGuidance: false,
      includesSourceControlGuidance: true,
    },
  };
}
