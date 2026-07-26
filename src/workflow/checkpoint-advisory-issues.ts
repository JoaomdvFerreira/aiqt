import type { ProjectIssue } from "../schema/project-issue.schema.js";
import type { EvidenceGateSimulation } from "../schema/evidence-gate-simulation.schema.js";
import { mintAdvisoryIssueKey } from "./finding-fingerprint.js";
import { resolveOrCreateProjectIssue } from "./finding-routing.js";
import { findProjectIssueByKey } from "../services/project-issue-service.js";
import { nextId } from "../state/ids.js";

/**
 * M29 §4: "Each applicable M28 rule result of fail or indeterminate becomes
 * one normalized advisory finding." M29 only ever evaluates a checkpoint
 * target, so every finding it can produce is inherently execution-local
 * (single checkpoint, single work unit, single rule) -- there is no
 * cross-checkpoint aggregation in M29 (that would be inferring a pattern,
 * an explicit non-goal). The routing rule is applied honestly against that
 * fact: `resolveOrCreateProjectIssue` is the only mutable, addressable
 * issue collection an M29 finding CAN join, since the immutable
 * Checkpoint.issues[] array is frozen at checkpoint-creation time and was
 * never designed to receive post-hoc entries (see checkpoint-amendment-
 * service.ts: amendments are overlays specifically because the original
 * checkpoint record is never rewritten). sourceType "checkpoint" marks
 * these as execution-local-sourced records within the single M22 ProjectIssue
 * lifecycle -- not a second issue lifecycle, and not literal CheckpointIssue
 * records, which have no issueKey/addressability of their own.
 */
/** M29 §5.1/§6: identifies a ProjectIssue as one M29's own advisory routing minted (see mintAdvisoryIssueKey), as distinct from M22/M23's other ProjectIssue sources sharing the same collection/lifecycle. */
export function isAdvisoryIssueKey(issueKey: string): boolean {
  return issueKey.startsWith("checkpoint:") && issueKey.includes(":advisory:");
}

export interface AdvisoryIssueRoutingResult {
  issueKeys: string[];
  createdProjectIssues: ProjectIssue[];
}

export function resolveAdvisoryIssueRouting(params: {
  simulation: EvidenceGateSimulation | null;
  checkpointId: string;
  workUnitId: string;
  milestoneId: string;
  existingProjectIssues: readonly ProjectIssue[];
  timestamp: string;
}): AdvisoryIssueRoutingResult {
  if (!params.simulation) {
    return { issueKeys: [], createdProjectIssues: [] };
  }

  const issueKeys: string[] = [];
  const createdProjectIssues: ProjectIssue[] = [];
  let workingProjectIssues = params.existingProjectIssues;

  for (const ruleResult of params.simulation.ruleResults) {
    if (ruleResult.result !== "fail" && ruleResult.result !== "indeterminate") continue;

    const issueKey = mintAdvisoryIssueKey(params.checkpointId, params.simulation.policy.digest, ruleResult.ruleId);
    issueKeys.push(issueKey);

    const existing = findProjectIssueByKey(issueKey, workingProjectIssues);
    if (existing) continue;

    const created = resolveOrCreateProjectIssue({
      issueKey,
      existingProjectIssues: workingProjectIssues,
      nextProjectIssueId: nextId("PI", workingProjectIssues.map((pi) => pi.projectIssueId)),
      timestamp: params.timestamp,
      projectIssueSeedFields: {
        title: `Evidence gate advisory: ${ruleResult.ruleId} (${ruleResult.result})`,
        description: ruleResult.summary,
        severity: ruleResult.result === "fail" ? "high" : "medium",
        sourceType: "checkpoint",
        sourceRefs: [params.checkpointId],
        affectedWorkUnitIds: [params.workUnitId],
        affectedMilestoneIds: params.milestoneId ? [params.milestoneId] : [],
        evidenceIds: ruleResult.matchedEvidenceRefs,
        checkpointRefs: [params.checkpointId],
        ownerRef: null,
        promotionRefs: [],
      },
    });

    if (created.changed) {
      createdProjectIssues.push(created.projectIssue);
      workingProjectIssues = [...workingProjectIssues, created.projectIssue];
    }
  }

  return { issueKeys: [...new Set(issueKeys)].sort(), createdProjectIssues };
}
