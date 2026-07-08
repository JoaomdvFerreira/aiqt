import type { ProjectModel } from "../schema/project.schema.js";

/**
 * Deterministic readiness check for aiqt plan (Milestone 3). This is not the
 * planning engine itself — only the gate that decides whether enough durable
 * context exists to recommend running it.
 *
 * Planning context is sufficient when:
 *  1. project.objective is non-empty;
 *  2. project.targetUsers has at least one item;
 *  3. at least one of: an accepted/draft requirement, a context constraint,
 *     a technology preference, a business rule, or an architecture note;
 *  4. no openQuestion has impact "blocking" and status "open".
 */
export function isPlanningContextReady(project: ProjectModel): boolean {
  if (project.project.objective.trim() === "") return false;
  if (project.project.targetUsers.length === 0) return false;

  const hasStructuralItem =
    project.requirements.some(
      (r) => r.status === "accepted" || r.status === "draft",
    ) ||
    project.context.constraints.length > 0 ||
    project.context.technologyPreferences.length > 0 ||
    project.context.businessRules.length > 0 ||
    project.context.architectureNotes.length > 0;
  if (!hasStructuralItem) return false;

  const hasBlockingOpenQuestion = project.openQuestions.some(
    (q) => q.impact === "blocking" && q.status === "open",
  );
  if (hasBlockingOpenQuestion) return false;

  return true;
}
