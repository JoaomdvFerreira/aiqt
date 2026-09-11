import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";
import { computeEffectiveCheckpointResult, getCheckpointAmendments, latestCheckpointForWorkUnit } from "../services/checkpoint-amendment-service.js";
import { deriveWorkQualification, type ChangeQualification } from "./production-qualification.js";
import { resolveContextReferences, type ResolvedContextRefs } from "./context-reference-resolution.js";
import type { RootResolution } from "./root-resolution.js";
import type { DecisionEscalation } from "../schema/decision-escalation.schema.js";
import { gitDiffNameStatus, gitIsInsideWorkTree, gitRevParse } from "../workspaces/git-command-runner.js";
import { GitRunnerError } from "../workspaces/git-command-runner.js";

export type ContextQuantity = { value: number; provenance: "measured" | "estimated" | "provider_reported" };
export interface HandoffRevisionFacts { requestedRevision: string | null; head: string | null; base: string | null; changes: readonly { path: string; status: string }[]; unavailableReason: string | null; }
export interface CanonicalHandoff {
  kind: "canonical_handoff"; workUnitId: string; milestoneId: string | null; roots: RootResolution;
  revision: HandoffRevisionFacts; workContract: { title: string; objective: string; scope: string[]; outOfScope: string[]; acceptanceCriteria: string[]; validationCommands: string[] } | null;
  effectiveCheckpoint: { checkpointId: string; summary: string; validationResult: string; acceptanceCriteriaResult: string; amendmentsApplied: string[] } | null;
  context: ResolvedContextRefs; evidence: Array<{ evidenceId: string; trustLevel: string; observedAt: string | null; recordedAt: string; revisionMatches: boolean; validationResult: string; acceptanceCriteriaResult: string; reviewResult: string }>;
  applicableDecisionEscalations: DecisionEscalation[];
  unresolved: { checkpointIssues: string[]; reviewFindings: ReviewFinding[]; contextReferences: string[] };
  qualification: ChangeQualification; nextRequiredAction: string | null; contextSize: ContextQuantity | null;
}

/** Resolve only the repository observations required by the derived model. */
export function resolveHandoffRevisionFacts(roots: RootResolution, requestedRevision: string | null = null): HandoffRevisionFacts {
  if (!gitIsInsideWorkTree(roots.implementationRoot)) {
    return { requestedRevision, head: null, base: null, changes: [], unavailableReason: "Implementation root is not an available Git work tree." };
  }
  try {
    const head = gitRevParse(roots.implementationRoot, requestedRevision ?? "HEAD");
    // The parent is a truthful, local comparison when no caller has supplied
    // a repository-specific base. Root commits retain a null base rather than
    // inventing a diff range.
    let base: string | null = null;
    let changes: { path: string; status: string }[] = [];
    try {
      base = gitRevParse(roots.implementationRoot, `${head}^`);
      changes = gitDiffNameStatus(roots.implementationRoot, base, head).split("\n")
        .filter((line) => line.length > 0).map((line) => {
          const [status, ...paths] = line.split("\t");
          return { status: status ?? "?", path: paths.join(" -> ") };
        });
    } catch (error) {
      if (!(error instanceof GitRunnerError)) throw error;
    }
    return { requestedRevision, head, base, changes, unavailableReason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git revision could not be resolved.";
    return { requestedRevision, head: null, base: null, changes: [], unavailableReason: message };
  }
}

/**
 * Canonical, read-only reconstruction of the execution/review handoff. It
 * owns no durable state: every field is derived from canonical project/state
 * records and supplied repository observations for this invocation.
 */
export function deriveCanonicalHandoff(input: { project: ProjectModel; state: StateModel; workUnitId: string; roots: RootResolution; revision: HandoffRevisionFacts; reviewFindings?: readonly ReviewFinding[]; contextSize?: ContextQuantity | null }): CanonicalHandoff {
  const workUnit = input.state.workGraph.workUnits.find((item) => item.id === input.workUnitId) ?? null;
  const context = workUnit ? resolveContextReferences(workUnit.agentContextRefs, input.project) : resolveContextReferences([], input.project);
  const checkpoint = workUnit ? latestCheckpointForWorkUnit(input.state, workUnit.id) : undefined;
  const amendments = checkpoint ? getCheckpointAmendments(input.state).filter((item) => item.checkpointId === checkpoint.id) : [];
  const effective = checkpoint ? computeEffectiveCheckpointResult(checkpoint, amendments) : null;
  const reviewFindings = (input.reviewFindings ?? []).filter((finding) => finding.relatedIds.includes(input.workUnitId));
  const qualification = deriveWorkQualification({ project: input.project, state: input.state, workUnitId: input.workUnitId, revision: input.revision.requestedRevision ?? input.revision.head, reviewFindings });
  const evidence = (input.state.evidence?.records ?? []).filter((item) => item.workflowBinding.workUnitId === input.workUnitId).map((item) => ({
    evidenceId: item.evidenceId, trustLevel: item.provider.trustLevel, observedAt: item.observedAt ?? null, recordedAt: item.recordedAt,
    revisionMatches: item.codeBinding.commitSha === (input.revision.requestedRevision ?? input.revision.head), validationResult: item.results.validationResult,
    acceptanceCriteriaResult: item.results.acceptanceCriteriaResult, reviewResult: item.results.reviewResult,
  }));
  const applicableDecisionEscalations = (input.state.evidence?.decisionEscalations ?? []).filter((item) =>
    item.relatedWorkUnitIds.includes(input.workUnitId) || (workUnit !== null && item.relatedMilestoneIds.includes(workUnit.milestoneId)),
  );
  return {
    kind: "canonical_handoff", workUnitId: input.workUnitId, milestoneId: workUnit?.milestoneId ?? null, roots: input.roots, revision: input.revision,
    workContract: workUnit ? { title: workUnit.title, objective: workUnit.objective, scope: workUnit.scope, outOfScope: workUnit.outOfScope, acceptanceCriteria: workUnit.acceptanceCriteria, validationCommands: workUnit.validationCommands } : null,
    effectiveCheckpoint: checkpoint && effective ? { checkpointId: checkpoint.id, summary: checkpoint.summary, validationResult: effective.validationResult, acceptanceCriteriaResult: effective.acceptanceCriteriaResult, amendmentsApplied: amendments.map((item) => item.amendmentId) } : null,
    context, evidence, applicableDecisionEscalations,
    unresolved: { checkpointIssues: checkpoint?.issues.filter((issue) => issue.status === "open").map((issue) => issue.title) ?? [], reviewFindings, contextReferences: context.unresolvedRefs },
    qualification, nextRequiredAction: qualification.status === "QUALIFIED" ? null : input.state.nextRecommendedCommand, contextSize: input.contextSize ?? null,
  };
}
