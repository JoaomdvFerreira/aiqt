import type { ProjectIssue } from "../schema/project-issue.schema.js";
import { slugify } from "../services/issue-service.js";
import { resolveOrCreateProjectIssue } from "./finding-routing.js";
import { findProjectIssueByKey } from "../services/project-issue-service.js";
import type { TargetEvaluation } from "./required-evidence-gate.js";
import { nextId } from "../state/ids.js";

/**
 * M30 §10.1: "Required deficiencies reuse ProjectIssue because post-hoc
 * checkpoint issues are immutable under the accepted M29 architecture
 * correction." Canonical key input: source=evidence_gate_required,
 * activationId, gate, targetRef, policyDigest, ruleId -- deliberately
 * disjoint from M29's `checkpoint:...:advisory:...` key space (a separate
 * source, never the same lifecycle instance) and from M28/M23's other
 * ProjectIssue sources, so required and advisory findings for the same
 * rule never collide or merge.
 */
export function mintRequiredIssueKey(activationId: string, gate: string, targetRef: string, policyDigest: string, ruleId: string): string {
  const shortDigest = policyDigest.replace(/^sha256:/, "").slice(0, 12);
  return `required:${activationId}:${gate}:${targetRef}:${shortDigest}:${slugify(ruleId)}`;
}

export function isRequiredIssueKey(issueKey: string): boolean {
  return issueKey.startsWith("required:");
}

export interface RequiredIssueRoutingResult {
  issueKeys: string[];
  createdProjectIssues: ProjectIssue[];
}

/**
 * M30 §10.1: deterministic and idempotent; a pass never deletes issue
 * history; no automatic promotion into repair work. Reuses the exact same
 * M22 resolveOrCreateProjectIssue owner M29 uses -- no second lifecycle.
 */
export function resolveRequiredIssueRouting(params: {
  targetEvaluations: readonly TargetEvaluation[];
  activationId: string;
  gate: string;
  policyDigest: string;
  workUnitId: string;
  milestoneId: string;
  existingProjectIssues: readonly ProjectIssue[];
  timestamp: string;
}): RequiredIssueRoutingResult {
  const issueKeys: string[] = [];
  const createdProjectIssues: ProjectIssue[] = [];
  let workingProjectIssues = params.existingProjectIssues;

  for (const evaluation of params.targetEvaluations) {
    const targetRef = `${evaluation.target.type}:${evaluation.target.id}`;
    for (const rd of evaluation.ruleDecisions) {
      if (rd.deficiency === "none") continue;
      const issueKey = mintRequiredIssueKey(params.activationId, params.gate, targetRef, params.policyDigest, rd.ruleId);
      issueKeys.push(issueKey);

      const existing = findProjectIssueByKey(issueKey, workingProjectIssues);
      if (existing) continue;

      const created = resolveOrCreateProjectIssue({
        issueKey,
        existingProjectIssues: workingProjectIssues,
        nextProjectIssueId: nextId("PI", workingProjectIssues.map((pi) => pi.projectIssueId)),
        timestamp: params.timestamp,
        projectIssueSeedFields: {
          title: `Required evidence gap: ${rd.ruleId} (${rd.deficiency})`,
          description: `Gate ${params.gate}, target ${targetRef}: ${rd.deficiency}.`,
          severity: rd.deficiency === "invalid_reference" || rd.deficiency === "binding_mismatch" ? "critical" : "high",
          sourceType: "checkpoint",
          sourceRefs: [targetRef],
          affectedWorkUnitIds: [params.workUnitId],
          affectedMilestoneIds: params.milestoneId ? [params.milestoneId] : [],
          evidenceIds: [],
          checkpointRefs: evaluation.target.type === "checkpoint" ? [evaluation.target.id] : [],
          ownerRef: null,
          promotionRefs: [],
        },
      });

      if (created.changed) {
        createdProjectIssues.push(created.projectIssue);
        workingProjectIssues = [...workingProjectIssues, created.projectIssue];
      }
    }
  }

  return { issueKeys: [...new Set(issueKeys)].sort(), createdProjectIssues };
}
