import type { ProjectModel } from "../../schema/project.schema.js";
import { detectsFullStackSignals } from "../../workflow/full-stack-detection.js";
import {
  detectUiHeavyForProject,
  isUiHeavy,
} from "../../workflow/design/ui-heavy-detection.js";
import { DESIGN_DISCOVERY_QUESTIONS } from "../../workflow/design/design-system-planner.js";

const BASE_QUESTIONS: readonly string[] = [
  "What is the product objective and the smallest useful MVP slice?",
  "Who are the primary users of this product?",
  "What is explicitly out of scope (non-goals) for the first version?",
  "What business rules must the system enforce?",
  "What technology preferences or constraints apply (language, framework, hosting)?",
  "What data needs to be stored, and where?",
  "What should prove the first implementation slice works (validation/testing expectations)?",
];

const FULL_STACK_QUESTIONS: readonly string[] = [
  "Who are the distinct user roles, and what can each role do (permissions)?",
  "Should users self-register, be invited, or be admin-created, and is there an approval step?",
  "What are the core entities and how do they relate to each other (data model)?",
  "What routes/pages or screens does the application need?",
  "What UI components and forms are required, including validation and error/loading/empty states?",
  "Are there notifications (email, in-app, or otherwise) required?",
  "What environment variables or external integrations does the app depend on?",
  "What are the deployment assumptions (hosting platform, environment)?",
];

const DETECTED_PROJECT_TYPE = "full-stack web application";

export interface InterviewPromptResult {
  prompt: string;
  questions: string[];
  detectedProjectType: string | null;
}

/**
 * Deterministic planning-interview prompt for aiqt prompt interview (§7,
 * Appendix C). Not stored as canonical state. When project context already
 * has a recorded objective, that objective is used as the effective idea so
 * the interview does not re-ask a question already answered in project.json.
 */
export function renderInterviewPrompt(
  project: ProjectModel | null,
  idea: string | null,
  repoRoot: string | null = null,
): InterviewPromptResult {
  const effectiveIdea = idea ?? (project && project.project.objective.trim() !== ""
    ? project.project.objective
    : null);

  const detectionText = [
    effectiveIdea ?? "",
    project?.context.technologyPreferences.join(" ") ?? "",
    project?.context.constraints.join(" ") ?? "",
  ].join(" ");
  const isFullStack = detectsFullStackSignals(detectionText);

  // M13 §11.2: shared detector -- not reimplemented here. Design discovery
  // questions are asked for high/medium UI-heavy confidence, or when the
  // rough idea already implies a full-stack/UI product.
  const uiHeavyResult = detectUiHeavyForProject({ project, idea: effectiveIdea, repoRoot });
  const includeDesignQuestions = isFullStack || isUiHeavy(uiHeavyResult.confidence);

  const questions = isFullStack
    ? [...BASE_QUESTIONS, ...FULL_STACK_QUESTIONS]
    : [...BASE_QUESTIONS];
  if (includeDesignQuestions) {
    questions.push(...DESIGN_DISCOVERY_QUESTIONS);
  }

  const lines: string[] = [];
  lines.push(`Project idea: ${effectiveIdea ?? "(not supplied yet)"}`);
  lines.push("");

  if (!effectiveIdea) {
    lines.push("No product idea has been supplied yet and no project objective is recorded.");
    lines.push("Ask the user for their product idea before asking any other question.");
    lines.push("");
  }

  lines.push("Ask the user these questions before planning:");
  questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question}`);
  });
  lines.push("");
  lines.push("After the user answers, produce AIQT update JSON and submit it through aiqt import update --stdin.");

  return {
    prompt: lines.join("\n"),
    questions,
    detectedProjectType: isFullStack ? DETECTED_PROJECT_TYPE : null,
  };
}
