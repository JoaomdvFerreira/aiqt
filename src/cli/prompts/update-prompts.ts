import { input, confirm, select } from "@inquirer/prompts";
import type { ProjectModel } from "../../schema/project.schema.js";
import type {
  UpdateInput,
  RequirementInput,
  DecisionInput,
  AssumptionInput,
  RiskInput,
  OpenQuestionInput,
} from "../../schema/update-input.schema.js";

function splitCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function collectMany<T>(
  label: string,
  collectOne: () => Promise<T>,
): Promise<T[]> {
  const items: T[] = [];
  let addMore = await confirm({ message: `Add a ${label}?`, default: false });
  while (addMore) {
    items.push(await collectOne());
    addMore = await confirm({
      message: `Add another ${label}?`,
      default: false,
    });
  }
  return items;
}

async function collectRequirement(): Promise<RequirementInput> {
  const title = await input({ message: "Requirement title" });
  const description = await input({ message: "Requirement description" });
  const priority = await select({
    message: "Priority",
    choices: (["low", "medium", "high", "critical"] as const).map((value) => ({ value })),
    default: "medium",
  });
  const type = await select({
    message: "Type",
    choices: (["functional", "non_functional", "technical", "business"] as const).map(
      (value) => ({ value }),
    ),
    default: "functional",
  });
  const acceptanceCriteriaRaw = await input({
    message: "Acceptance criteria (comma-separated)",
    default: "",
  });
  const status = await select({
    message: "Status",
    choices: (["draft", "accepted", "rejected", "implemented"] as const).map(
      (value) => ({ value }),
    ),
    default: "draft",
  });

  const result: RequirementInput = { title, description, priority, type, status };
  const acceptanceCriteria = splitCommaList(acceptanceCriteriaRaw);
  if (acceptanceCriteria.length > 0) result.acceptanceCriteria = acceptanceCriteria;
  return result;
}

async function collectDecision(): Promise<DecisionInput> {
  const decision = await input({ message: "Decision" });
  const reason = await input({ message: "Reason", default: "" });
  const impact = await input({ message: "Impact", default: "" });
  const status = await select({
    message: "Status",
    choices: (["proposed", "decided", "superseded", "rejected"] as const).map(
      (value) => ({ value }),
    ),
    default: "decided",
  });
  const result: DecisionInput = { decision, status };
  if (reason.trim() !== "") result.reason = reason;
  if (impact.trim() !== "") result.impact = impact;
  return result;
}

async function collectAssumption(): Promise<AssumptionInput> {
  const statement = await input({ message: "Assumption statement" });
  const reason = await input({ message: "Reason", default: "" });
  const source = await select({
    message: "Source",
    choices: (["human", "aiqt", "agent", "system"] as const).map((value) => ({
      value,
    })),
    default: "human",
  });
  const status = await select({
    message: "Status",
    choices: (["active", "replaced", "invalidated"] as const).map((value) => ({
      value,
    })),
    default: "active",
  });
  const result: AssumptionInput = { statement, source, status };
  if (reason.trim() !== "") result.reason = reason;
  return result;
}

async function collectRisk(): Promise<RiskInput> {
  const title = await input({ message: "Risk title" });
  const description = await input({ message: "Risk description" });
  const severity = await select({
    message: "Severity",
    choices: (["low", "medium", "high", "critical"] as const).map((value) => ({
      value,
    })),
    default: "medium",
  });
  const mitigation = await input({ message: "Mitigation", default: "" });
  const status = await select({
    message: "Status",
    choices: (["open", "mitigated", "accepted", "closed"] as const).map(
      (value) => ({ value }),
    ),
    default: "open",
  });
  const result: RiskInput = { title, description, severity, status };
  if (mitigation.trim() !== "") result.mitigation = mitigation;
  return result;
}

async function collectOpenQuestion(): Promise<OpenQuestionInput> {
  const question = await input({ message: "Open question" });
  const impact = await select({
    message: "Impact",
    choices: (["low", "medium", "high", "blocking"] as const).map((value) => ({
      value,
    })),
    default: "medium",
  });
  const status = await select({
    message: "Status",
    choices: (["open", "answered", "dismissed"] as const).map((value) => ({
      value,
    })),
    default: "open",
  });
  const answer = await input({ message: "Answer", default: "" });
  const result: OpenQuestionInput = { question, impact, status };
  if (answer.trim() !== "") result.answer = answer;
  return result;
}

/**
 * Lightweight interactive intake for TTY usage. Prompts in the order defined
 * by the M2 spec: project fields, context fields, then each record-array
 * section via an add-more loop. Empty answers mean no change.
 */
export async function collectInteractiveInput(
  project: ProjectModel,
): Promise<UpdateInput> {
  const objective = await input({
    message: "Project objective",
    default: project.project.objective,
  });
  const targetUsersRaw = await input({
    message: "Target users (comma-separated)",
    default: project.project.targetUsers.join(", "),
  });
  const agent = await input({
    message: "Preferred agent",
    default: project.project.preferredAgent ?? "",
  });
  const repositoryPath = await input({
    message: "Existing repository path",
    default: project.project.existingRepositoryPath ?? "",
  });
  const constraintsRaw = await input({
    message: "Constraints (comma-separated)",
    default: project.context.constraints.join(", "),
  });
  const nonGoalsRaw = await input({
    message: "Non-goals (comma-separated)",
    default: project.context.nonGoals.join(", "),
  });
  const technologyPreferencesRaw = await input({
    message: "Technology preferences (comma-separated)",
    default: project.context.technologyPreferences.join(", "),
  });
  const businessRulesRaw = await input({
    message: "Business rules (comma-separated)",
    default: project.context.businessRules.join(", "),
  });
  const architectureNotesRaw = await input({
    message: "Architecture notes (comma-separated)",
    default: project.context.architectureNotes.join(", "),
  });

  const requirements = await collectMany("requirement", collectRequirement);
  const decisions = await collectMany("decision", collectDecision);
  const assumptions = await collectMany("assumption", collectAssumption);
  const risks = await collectMany("risk", collectRisk);
  const openQuestions = await collectMany("open question", collectOpenQuestion);

  const preferredValidationCommandsRaw = await input({
    message: "Preferred validation commands (comma-separated)",
    default: project.quality.preferredValidationCommands.join(", "),
  });

  const patch: UpdateInput = {};

  const projectPatch: NonNullable<UpdateInput["project"]> = {};
  if (objective.trim() !== "") projectPatch.objective = objective.trim();
  const targetUsers = splitCommaList(targetUsersRaw);
  if (targetUsers.length > 0) projectPatch.targetUsers = targetUsers;
  if (agent.trim() !== "") projectPatch.preferredAgent = agent.trim();
  if (repositoryPath.trim() !== "") {
    projectPatch.existingRepositoryPath = repositoryPath.trim();
  }
  if (Object.keys(projectPatch).length > 0) patch.project = projectPatch;

  const contextPatch: NonNullable<UpdateInput["context"]> = {};
  const constraints = splitCommaList(constraintsRaw);
  if (constraints.length > 0) contextPatch.constraints = constraints;
  const nonGoals = splitCommaList(nonGoalsRaw);
  if (nonGoals.length > 0) contextPatch.nonGoals = nonGoals;
  const technologyPreferences = splitCommaList(technologyPreferencesRaw);
  if (technologyPreferences.length > 0) {
    contextPatch.technologyPreferences = technologyPreferences;
  }
  const businessRules = splitCommaList(businessRulesRaw);
  if (businessRules.length > 0) contextPatch.businessRules = businessRules;
  const architectureNotes = splitCommaList(architectureNotesRaw);
  if (architectureNotes.length > 0) {
    contextPatch.architectureNotes = architectureNotes;
  }
  if (Object.keys(contextPatch).length > 0) patch.context = contextPatch;

  if (requirements.length > 0) patch.requirements = requirements;
  if (decisions.length > 0) patch.decisions = decisions;
  if (assumptions.length > 0) patch.assumptions = assumptions;
  if (risks.length > 0) patch.risks = risks;
  if (openQuestions.length > 0) patch.openQuestions = openQuestions;

  const preferredValidationCommands = splitCommaList(
    preferredValidationCommandsRaw,
  );
  if (preferredValidationCommands.length > 0) {
    patch.quality = { preferredValidationCommands };
  }

  return patch;
}
