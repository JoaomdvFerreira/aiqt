import { resolve } from "node:path";
import { gitRevParse, GitRunnerError } from "../workspaces/git-command-runner.js";
import { resolveAiqtPaths } from "../core/filesystem/paths.js";
import { isDirectory } from "../core/filesystem/file-exists.js";
import { readStateModel } from "../state/workflow-state-store.js";
import { readProjectModel } from "../state/project-store.js";
import { deriveProjectProductionReadiness, type ProjectProductionReadiness } from "../workflow/production-qualification.js";
import { buildReleaseCandidate, type ReleaseIntentInput, type ReleaseIntentMilestoneInput } from "../workflow/release-candidate.js";
import { buildReleaseProvenance, type ReleaseProvenanceFacts } from "../workflow/release-provenance.js";
import { assessReleaseReadiness, type ReleaseReadinessFacts } from "../workflow/release-readiness.js";
import { assessReleaseRisk, UNKNOWN_RELEASE_RISK_SIGNALS, type ReleaseRiskSignals } from "../workflow/release-risk.js";
import { buildInitialApprovalEvidence } from "../workflow/release-approval.js";
import { NOT_CREATED_DRAFT_STATE } from "../schema/release-governance.schema.js";
import type {
  ReleaseApprovalEvidence,
  ReleaseBlockingFinding,
  ReleaseCandidate,
  ReleaseDecision,
  ReleaseEvidenceStatus,
  ReleaseProvenance,
  ReleaseReadinessAssessment,
  ReleaseRiskAssessment,
} from "../schema/release-governance.schema.js";

/**
 * M40-WU01: the one orchestration point that reads live Git/state facts and
 * hands them to the pure workflow modules (release-candidate.ts,
 * release-provenance.ts, release-readiness.ts). Read-only: the only Git
 * calls used are the existing `gitRevParse` allowlisted read from M25's
 * git-command-runner.ts. No GitHub access, no network, no mutation.
 */

export interface ReleaseIntentMilestoneRequest {
  milestoneId: string;
  tag?: string | null;
  closureCommit?: string | null;
}

export interface ReleaseIntentRequest {
  cwd: string;
  repositoryIdentity: string;
  packageVersion: string;
  schemaVersion?: string | null;
  intendedReleaseTag: string;
  /** Any ref resolvable by `git rev-parse` (branch, tag, sha). Defaults to HEAD. */
  candidateRef?: string;
  baseRelease?: string | null;
  milestones: ReleaseIntentMilestoneRequest[];
  ciCommit?: string | null;
  ciRunIdentity?: string | null;
  ciStatus?: ReleaseEvidenceStatus;
  validationEvidenceDigest?: string | null;
  securityEvidenceStatus?: ReleaseEvidenceStatus;
  releaseNotesDigest?: string | null;
  riskAssessmentVersion?: string | null;
  approvalAuthorityDecision?: string | null;
  declaredNotApplicable?: string[];
  declaredPresent?: string[];
  riskSignals?: ReleaseRiskSignals;
}

export type ReleaseCandidateAssemblyResult =
  | { ok: true; candidate: ReleaseCandidate }
  | { ok: false; blockingFindings: ReleaseBlockingFinding[] };

export interface ReleaseAssessment {
  candidate: ReleaseCandidate;
  provenance: ReleaseProvenance;
  readiness: ReleaseReadinessAssessment;
  /** M49: canonical project qualification for the exact release candidate. */
  qualification: ProjectProductionReadiness | null;
}

export type ReleaseAssessmentOutcome =
  | { ok: true; assessment: ReleaseAssessment }
  | { ok: false; blockingFindings: ReleaseBlockingFinding[] };

/** Resolves a ref to a full commit sha, or null if the ref cannot be resolved (never throws). */
function resolveRefSafely(cwd: string, ref: string): string | null {
  try {
    return gitRevParse(cwd, ref);
  } catch (err) {
    if (err instanceof GitRunnerError) return null;
    throw err;
  }
}

function loadMilestoneStatus(cwd: string, milestoneId: string): { title: string | null; status: string | null } {
  const paths = resolveAiqtPaths(resolve(cwd));
  if (!isDirectory(paths.aiqtDir)) return { title: null, status: null };
  try {
    const state = readStateModel(paths.stateFile);
    const milestone = state.workGraph.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return { title: null, status: null };
    return { title: milestone.title, status: milestone.status };
  } catch {
    return { title: null, status: null };
  }
}

function resolveMilestoneInputs(cwd: string, requests: ReleaseIntentMilestoneRequest[]): ReleaseIntentMilestoneInput[] {
  return requests.map((m) => {
    const { title, status } = loadMilestoneStatus(cwd, m.milestoneId);
    const tag = m.tag ?? null;
    const tagCommit = tag ? resolveRefSafely(cwd, `${tag}^{commit}`) : null;
    return {
      milestoneId: m.milestoneId,
      title,
      status,
      tag,
      tagCommit,
      closureCommit: m.closureCommit ?? null,
    };
  });
}

export function assembleReleaseCandidate(request: ReleaseIntentRequest): ReleaseCandidateAssemblyResult {
  const candidateRef = request.candidateRef ?? "HEAD";
  const candidateCommit = resolveRefSafely(request.cwd, candidateRef) ?? candidateRef;

  const input: ReleaseIntentInput = {
    repositoryIdentity: request.repositoryIdentity,
    packageVersion: request.packageVersion,
    schemaVersion: request.schemaVersion ?? null,
    intendedReleaseTag: request.intendedReleaseTag,
    candidateCommit,
    baseRelease: request.baseRelease ?? null,
    milestones: resolveMilestoneInputs(request.cwd, request.milestones),
  };

  const result = buildReleaseCandidate(input);
  if (!result.ok) return { ok: false, blockingFindings: result.blockingFindings };
  return { ok: true, candidate: result.candidate };
}

/** Whether `tag` already exists in the repository (a real conflict for an intended release tag). */
function tagAlreadyExists(cwd: string, tag: string): boolean {
  return resolveRefSafely(cwd, `refs/tags/${tag}`) !== null;
}

type AssessmentCoreResult = { ok: true; core: ReleaseAssessment } | { ok: false; blockingFindings: ReleaseBlockingFinding[] };

function buildAssessmentCore(request: ReleaseIntentRequest, facts: ReleaseProvenanceFacts): AssessmentCoreResult {
  const assembly = assembleReleaseCandidate(request);
  if (!assembly.ok) return { ok: false, blockingFindings: assembly.blockingFindings };

  const provenance = buildReleaseProvenance(assembly.candidate, facts);

  const readinessFacts: ReleaseReadinessFacts = {
    tagAlreadyExists: tagAlreadyExists(request.cwd, request.intendedReleaseTag),
    declaredNotApplicable: request.declaredNotApplicable ?? [],
    declaredPresent: request.declaredPresent ?? [],
  };
  let readiness = assessReleaseReadiness(assembly.candidate, provenance, readinessFacts);

  // This is deliberately a derived, best-effort view. A release candidate can
  // still explain its own existing provenance errors when project state cannot
  // be read; it must not fabricate qualification in that case.
  let qualification: ProjectProductionReadiness | null = null;
  const paths = resolveAiqtPaths(resolve(request.cwd));
  if (isDirectory(paths.aiqtDir)) {
    try {
      qualification = deriveProjectProductionReadiness({
        project: readProjectModel(paths.projectFile),
        state: readStateModel(paths.stateFile),
        revision: assembly.candidate.identity.candidateCommit,
      });
    } catch {
      qualification = null;
    }
  }

  // Release readiness remains its own candidate/provenance assessment, but it
  // cannot advertise a stronger conclusion than the shared M49 qualification.
  if (qualification?.status === "BLOCKED" || qualification?.status === "UNKNOWN") {
    const finding: ReleaseBlockingFinding = qualification.status === "BLOCKED"
      ? { id: "RELEASE-QUALIFICATION-BLOCKED", area: "qualification", message: "Canonical change qualification is blocked for this candidate revision.", evidenceKey: "qualification" }
      : { id: "RELEASE-QUALIFICATION-UNKNOWN", area: "qualification", message: "Canonical change qualification is unknown for this candidate revision.", evidenceKey: "qualification" };
    readiness = {
      ...readiness,
      integrity: qualification.status === "BLOCKED" ? "blocked" : readiness.integrity === "blocked" ? "blocked" : "insufficient_evidence",
      blockingFindings: [...readiness.blockingFindings, finding],
    };
  }

  return { ok: true, core: { candidate: assembly.candidate, provenance, readiness, qualification } };
}

function provenanceFactsFromRequest(request: ReleaseIntentRequest, overrides: Partial<ReleaseProvenanceFacts> = {}): ReleaseProvenanceFacts {
  return {
    ciCommit: request.ciCommit ?? null,
    ciRunIdentity: request.ciRunIdentity ?? null,
    ciStatus: request.ciStatus ?? "missing",
    validationEvidenceDigest: request.validationEvidenceDigest ?? null,
    securityEvidenceStatus: request.securityEvidenceStatus ?? "missing",
    releaseNotesDigest: request.releaseNotesDigest ?? null,
    riskAssessmentVersion: request.riskAssessmentVersion ?? null,
    approvalAuthorityDecision: request.approvalAuthorityDecision ?? null,
    ...overrides,
  };
}

export function assessReleaseCandidate(request: ReleaseIntentRequest): ReleaseAssessmentOutcome {
  const result = buildAssessmentCore(request, provenanceFactsFromRequest(request));
  if (!result.ok) return { ok: false, blockingFindings: result.blockingFindings };
  return { ok: true, assessment: result.core };
}

export type ReleaseDecisionOutcome = { ok: true; decision: ReleaseDecision } | { ok: false; blockingFindings: ReleaseBlockingFinding[] };

/**
 * Full decision envelope (build spec Sec 5.7, 7): candidate + provenance +
 * readiness + risk + approval-authority + draft state, all derived from the
 * same evidence snapshot. `risk.requiredApprovalAuthority` is folded back
 * into the provenance digest's `approvalAuthorityDecision` field so the
 * digest reflects the actual decision made, not a caller guess.
 */
export function assessReleaseDecision(request: ReleaseIntentRequest): ReleaseDecisionOutcome {
  const signals = request.riskSignals ?? UNKNOWN_RELEASE_RISK_SIGNALS;

  const provisional = buildAssessmentCore(request, provenanceFactsFromRequest(request));
  if (!provisional.ok) return { ok: false, blockingFindings: provisional.blockingFindings };

  const risk: ReleaseRiskAssessment = assessReleaseRisk(provisional.core.candidate, provisional.core.provenance, provisional.core.readiness, signals);

  const finalResult = buildAssessmentCore(
    request,
    provenanceFactsFromRequest(request, { riskAssessmentVersion: risk.assessmentVersion, approvalAuthorityDecision: risk.requiredApprovalAuthority }),
  );
  if (!finalResult.ok) return { ok: false, blockingFindings: finalResult.blockingFindings };

  const approval: ReleaseApprovalEvidence = buildInitialApprovalEvidence(risk);

  return {
    ok: true,
    decision: {
      candidate: finalResult.core.candidate,
      provenance: finalResult.core.provenance,
      readiness: finalResult.core.readiness,
      risk,
      approval,
      draft: NOT_CREATED_DRAFT_STATE,
    },
  };
}
