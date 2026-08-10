import { resolveAiqtPaths, type AiqtPaths } from "../core/filesystem/paths.js";
import { isDirectory } from "../core/filesystem/file-exists.js";
import { readStateModel, writeStateModel } from "../state/workflow-state-store.js";
import { acquireWorkspaceOperationLock, WorkspaceOperationLockError } from "../workspaces/workspace-operation-lock.js";
import { nextEventIdFactory } from "../workflow/execution-runlog-event-builder.js";
import {
  appendRunlogEvent,
  readRunlogEvents,
  buildNightAuditSessionStartedEvent,
  buildNightAuditSessionCompletedEvent,
  buildNightAuditSessionInterruptedEvent,
  buildNightAuditSessionCancelledEvent,
  buildNightAuditFindingAcceptedEvent,
  buildNightAuditFindingRejectedEvent,
  buildNightAuditIssuePublishedEvent,
} from "../state/runlog-store.js";
import { gitRevParse, gitRemoteGetUrl } from "../workspaces/git-command-runner.js";
import { parseGitHubRemoteUrl } from "../workflow/pr-remote-identity.js";
import { resolvePortfolioMemberRoot } from "./pr-source-resolution-service.js";
import { deriveReviewCandidates, computeScopeChangeFacts, computeRecentDefectSignalScopeKeys } from "../workflow/night-audit-target-resolution.js";
import {
  scoreReviewCandidates,
  selectReviewTasksForBudget,
  shouldStopForDiminishingReturns,
  countRemainingHighPriorityCandidates,
} from "../workflow/night-audit-coverage-queue.js";
import { checkNightAuditBudget, hasReachedTargetDuration } from "../workflow/night-audit-budget.js";
import { buildReviewTaskContextManifest, buildReviewTaskPacket, normalizeAuditFindingCandidate, upsertCoverageEntry, runStructuralCallThrough, type ReviewTaskPacket } from "../workflow/night-audit-review-task-execution.js";
import { computeAuditFindingFingerprintFromFinding } from "../workflow/night-audit-fingerprint.js";
import { evaluateAuditFinding } from "../workflow/night-audit-quality-gate.js";
import { intakeAuditFinding } from "./night-audit-defect-intake-service.js";
import { publishAuditFinding, checkAuditIssueBacklog } from "./night-audit-issue-publication-service.js";
import { realGithubIssueClient, type GithubIssueClient } from "./github-issue-client.js";
import type { StateModel } from "../schema/state.schema.js";
import type { DefectRecord } from "../schema/defect.schema.js";
import type {
  NightAuditSessionBudget,
  NightAuditSessionUsage,
  ReviewTask,
  ReviewTaskSubmission,
  NightAuditResult,
  NightAuditStopReason,
  NightAuditPortfolioRef,
  AuditFindingCandidateInput,
} from "../schema/night-audit.schema.js";

/**
 * M48-WU05 (build spec Sec 4/5/9/14): session orchestration -- the sole
 * `aiqt review night run|submit|status|cancel|coverage` implementation
 * layer. Reuses the M25 workspace-operation lock only for the short,
 * synchronous claim/decision sequence each call performs (mirrors
 * maintenance-run-service.ts); no long-running work happens inside the
 * lock -- a Night Audit session's multi-hour span is the SUM of many
 * separate `run`/`submit` invocations, never one blocking process.
 */

const NIGHT_AUDIT_LOCK_OPERATION_ID = "night-audit-session";
/** Build spec Sec 9 (failure/idempotency table): a session whose elapsed time exceeds hardStopMinutes by more than this grace window is reconciled as interrupted, never silently resumed. */
export const NIGHT_AUDIT_STALE_GRACE_MINUTES = 60;
export const AUDIT_ISSUE_GITHUB_TOKEN_ENV = "GITHUB_TOKEN";

export type ResolveTargetOutcome = { ok: true; root: string; portfolioRef: NightAuditPortfolioRef | null } | { ok: false; reason: string };

/** Build spec Sec 4/M46 reuse: `--repository` and `--portfolio-member` are mutually exclusive explicit target selectors; the default is cwd. */
export function resolveNightAuditTargetRoot(cwd: string, repositoryOverride: string | undefined, portfolio: { portfolioId: string; memberId: string } | undefined): ResolveTargetOutcome {
  if (repositoryOverride !== undefined && portfolio !== undefined) {
    return { ok: false, reason: "Specify either --repository or --portfolio-member, not both." };
  }
  if (portfolio !== undefined) {
    const resolved = resolvePortfolioMemberRoot(portfolio.portfolioId, portfolio.memberId);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    return { ok: true, root: resolved.root, portfolioRef: { portfolioId: portfolio.portfolioId, memberId: portfolio.memberId } };
  }
  return { ok: true, root: repositoryOverride ?? cwd, portfolioRef: null };
}

export interface LoadedNightAuditTarget {
  paths: AiqtPaths;
  state: StateModel;
}

export type LoadTargetOutcome = { ok: true; target: LoadedNightAuditTarget } | { ok: false; reason: string };

export function loadNightAuditTarget(root: string): LoadTargetOutcome {
  const paths = resolveAiqtPaths(root);
  if (!isDirectory(paths.aiqtDir)) {
    return { ok: false, reason: `No AIQT project found at ${paths.aiqtDir}. The Night Audit target must already be AIQT-managed.` };
  }
  return { ok: true, target: { paths, state: readStateModel(paths.stateFile) } };
}

function elapsedMinutesSince(startedAtIso: string, nowIso: string): number {
  return (Date.parse(nowIso) - Date.parse(startedAtIso)) / 60000;
}

function ownerRepoFromRoot(root: string): { owner: string; repo: string } | null {
  const url = gitRemoteGetUrl(root, "origin");
  if (url === null) return null;
  const identity = parseGitHubRemoteUrl(url);
  return identity === null ? null : { owner: identity.owner, repo: identity.repo };
}

export type RunOutcome =
  | { kind: "task"; sessionId: string; task: ReviewTask; packet: ReviewTaskPacket; structuralCandidates: AuditFindingCandidateInput[] }
  | { kind: "stopped"; result: NightAuditResult }
  | { kind: "lock_held" };

export interface RunOptions {
  root: string;
  now?: string;
  /** Required only when no session is currently active (starting fresh). Ignored when resuming. */
  budget?: NightAuditSessionBudget;
  portfolioRef?: NightAuditPortfolioRef | null;
}

function emptyUsage(): NightAuditSessionUsage {
  return { elapsedMinutes: 0, reviewTasksAttempted: 0, reviewTasksCompleted: 0, newIssuesCreated: 0, consecutiveTasksWithNoAcceptedFindings: 0 };
}

function buildResult(sessionId: string, startedAt: string, finishedAt: string, stopReason: NightAuditStopReason, usage: NightAuditSessionUsage, extras: Partial<NightAuditResult> = {}): NightAuditResult {
  return {
    sessionId,
    startedAt,
    finishedAt,
    stopReason,
    tasksAttempted: usage.reviewTasksAttempted,
    tasksCompleted: usage.reviewTasksCompleted,
    domainsReviewed: [],
    candidateFindings: 0,
    acceptedFindings: 0,
    rejectedFindings: 0,
    duplicatesSuppressed: { byFingerprint: 0, byExistingIssueRef: 0, byGithubSearch: 0 },
    newIssuesCreated: [],
    issuePublicationSuppressed: false,
    currentAuditIssueBacklog: 0,
    budgetRemaining: usage,
    unreviewedHighPriorityScope: [],
    ambiguousReconciliationsNeeded: [],
    ...extras,
  };
}

/**
 * `aiqt review night run` (build spec Sec 4): idempotent -- starts a
 * session if none is active, otherwise advances the existing one. Returns
 * either the next bounded ReviewTask or a stop reason. Never mutates
 * project source; never itself executes a live agent (build spec Sec 5,
 * WU48-03's execution-model clarification) -- the caller reviews `scope`
 * and reports back via `submit`.
 */
export function runNightAuditStep(options: RunOptions): RunOutcome {
  const now = options.now ?? new Date().toISOString();
  const target = loadNightAuditTargetOrThrow(options.root);
  const { paths } = target;

  let lock;
  try {
    lock = acquireWorkspaceOperationLock(paths.aiqtDir, NIGHT_AUDIT_LOCK_OPERATION_ID);
  } catch (err) {
    if (err instanceof WorkspaceOperationLockError) return { kind: "lock_held" };
    throw err;
  }

  try {
    let state = readStateModel(paths.stateFile);
    let active = state.nightAuditActiveSession ?? null;
    const nextEventId = nextEventIdFactory(paths.runlogFile);

    if (active !== null) {
      const elapsed = elapsedMinutesSince(active.startedAt, now);
      if (elapsed > active.budget.hardStopMinutes + NIGHT_AUDIT_STALE_GRACE_MINUTES) {
        const result = buildResult(active.sessionId, active.startedAt, now, "interrupted", active.usage);
        state = { ...state, nightAuditActiveSession: null };
        writeStateModel(paths.stateFile, state);
        appendRunlogEvent(
          paths.runlogFile,
          buildNightAuditSessionInterruptedEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [active.sessionId],
            data: { sessionId: active.sessionId, stopReason: "interrupted", result: result as unknown as Record<string, unknown> },
          }),
        );
        active = null;
      }
    }

    if (active === null) {
      if (!options.budget) {
        throw new Error("No active Night Audit session and no budget was supplied to start one.");
      }
      const sessionId = `night-audit-${Date.parse(now)}`;
      active = { sessionId, startedAt: now, budget: options.budget, usage: emptyUsage(), portfolioRef: options.portfolioRef ?? null };
      state = { ...state, nightAuditActiveSession: active };
      writeStateModel(paths.stateFile, state);
      appendRunlogEvent(
        paths.runlogFile,
        buildNightAuditSessionStartedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [sessionId],
          data: { sessionId, repositoryRoot: options.root, budget: active.budget as unknown as Record<string, unknown> },
        }),
      );
    }

    const usageWithElapsed: NightAuditSessionUsage = { ...active.usage, elapsedMinutes: elapsedMinutesSince(active.startedAt, now) };

    const budgetCheck = checkNightAuditBudget(active.budget, usageWithElapsed);
    if (budgetCheck.exhausted) {
      const stopReason: NightAuditStopReason = budgetCheck.exceededDimensions.includes("hardStopMinutes") ? "hard_stop" : "budget_exhausted";
      return finalizeSession(paths, state, active, stopReason, now, nextEventId);
    }

    const candidates = deriveReviewCandidates(options.root);
    const coverage = state.nightAuditCoverage ?? [];
    const changeFacts = computeScopeChangeFacts(options.root, candidates, coverage);
    const recentSignal = computeRecentDefectSignalScopeKeys(candidates, state.defects ?? [], now);
    const scored = scoreReviewCandidates({
      candidates,
      coverage,
      changedScopeKeys: changeFacts.changedScopeKeys,
      recentDefectSignalScopeKeys: recentSignal,
      highChurnScopeKeys: changeFacts.highChurnScopeKeys,
      nowIso: now,
    });
    const remainingHighPriority = countRemainingHighPriorityCandidates(scored);

    if (shouldStopForDiminishingReturns(usageWithElapsed.consecutiveTasksWithNoAcceptedFindings, remainingHighPriority)) {
      return finalizeSession(paths, state, active, "diminishing_returns", now, nextEventId);
    }
    if (scored.length === 0 || (hasReachedTargetDuration(active.budget, usageWithElapsed) && remainingHighPriority === 0)) {
      return finalizeSession(paths, state, active, "queue_exhausted", now, nextEventId);
    }

    const repositoryCommit = gitRevParse(options.root, "HEAD");
    const [task] = selectReviewTasksForBudget(scored, repositoryCommit, 1);
    const manifest = buildReviewTaskContextManifest(task!, [task!.scope]);
    const packet = buildReviewTaskPacket(task!, manifest);
    const structuralCandidates = runStructuralCallThrough(task!, options.root);

    return { kind: "task", sessionId: active.sessionId, task: task!, packet, structuralCandidates };
  } finally {
    lock.release();
  }
}

function finalizeSession(
  paths: AiqtPaths,
  state: StateModel,
  active: NonNullable<StateModel["nightAuditActiveSession"]>,
  stopReason: NightAuditStopReason,
  now: string,
  nextEventId: () => string,
): RunOutcome {
  const usage: NightAuditSessionUsage = { ...active.usage, elapsedMinutes: elapsedMinutesSince(active.startedAt, now) };
  const result = buildResult(active.sessionId, active.startedAt, now, stopReason, usage);
  const nextState: StateModel = { ...state, nightAuditActiveSession: null };
  writeStateModel(paths.stateFile, nextState);
  appendRunlogEvent(
    paths.runlogFile,
    buildNightAuditSessionCompletedEvent({
      id: nextEventId(),
      timestamp: now,
      relatedIds: [active.sessionId],
      data: { sessionId: active.sessionId, stopReason, result: result as unknown as Record<string, unknown> },
    }),
  );
  return { kind: "stopped", result };
}

function loadNightAuditTargetOrThrow(root: string): LoadedNightAuditTarget {
  const loaded = loadNightAuditTarget(root);
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.target;
}

export interface SubmitOptions {
  root: string;
  submission: ReviewTaskSubmission;
  task: ReviewTask;
  now?: string;
  githubClient?: GithubIssueClient;
  githubToken?: string | null;
}

export interface SubmitResultItem {
  checkId: string;
  decision: "accept" | "reject";
  reasons: string[];
  findingKey?: string;
  publication?: { kind: string; issueNumber?: number; issueUrl?: string; reason?: string };
}

export interface SubmitOutcome {
  sessionId: string;
  taskId: string;
  results: SubmitResultItem[];
  acceptedCount: number;
  rejectedCount: number;
}

/**
 * `aiqt review night submit <task-id>` (build spec Sec 7/8/9): processes
 * one ReviewTask's submitted findings through the full lifecycle --
 * quality gate -> fingerprint -> M42 intake (dedup checks #1/#2) ->
 * GitHub publication (dedup check #3, only when not backlog-suppressed
 * and a token is available) -> coverage-ledger upsert -> usage update.
 * Never mutates project source.
 */
export async function submitReviewTaskFindings(options: SubmitOptions): Promise<SubmitOutcome> {
  const now = options.now ?? new Date().toISOString();
  const target = loadNightAuditTargetOrThrow(options.root);
  const { paths } = target;
  const client = options.githubClient ?? realGithubIssueClient;

  let lock;
  try {
    lock = acquireWorkspaceOperationLock(paths.aiqtDir, NIGHT_AUDIT_LOCK_OPERATION_ID);
  } catch (err) {
    if (err instanceof WorkspaceOperationLockError) {
      throw new Error("Another Night Audit operation is in progress; try again shortly.");
    }
    throw err;
  }

  try {
    let state = readStateModel(paths.stateFile);
    const active = state.nightAuditActiveSession;
    if (!active) throw new Error("No active Night Audit session. Run `aiqt review night run` first.");

    const nextEventId = nextEventIdFactory(paths.runlogFile);
    const currentCommit = gitRevParse(options.root, "HEAD");
    const owner = ownerRepoFromRoot(options.root);
    const token = options.githubToken ?? null;

    let backlogSuppressed = false;
    if (token && owner) {
      const backlog = await checkAuditIssueBacklog(owner.owner, owner.repo, token, active.budget.maxOpenAuditIssueBacklog, client);
      backlogSuppressed = backlog.ok && backlog.suppressed;
    }

    const results: SubmitResultItem[] = [];
    let defects = state.defects ?? [];
    let acceptedCount = 0;
    let newIssuesThisSubmission = 0;

    for (const candidate of options.submission.findings) {
      const findingKey = computeAuditFindingFingerprintFromFinding({
        domain: options.task.domain,
        checkId: candidate.checkId,
        title: candidate.title,
        explanation: candidate.explanation,
        reviewCommit: options.task.repositoryCommit,
        scope: options.task.scope,
        affectedPaths: candidate.affectedPaths,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        significance: candidate.significance,
        disposition: candidate.disposition,
        recommendedNextAction: candidate.recommendedNextAction,
        validationIdea: candidate.validationIdea,
      });
      const finding = normalizeAuditFindingCandidate(candidate, options.task, findingKey);

      const gate = evaluateAuditFinding(finding);
      if (gate.decision === "reject") {
        results.push({ checkId: candidate.checkId, decision: "reject", reasons: gate.reasons, findingKey });
        appendRunlogEvent(
          paths.runlogFile,
          buildNightAuditFindingRejectedEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [active.sessionId, options.task.taskId],
            data: { sessionId: active.sessionId, taskId: options.task.taskId, findingKey, domain: options.task.domain, reasons: gate.reasons },
          }),
        );
        continue;
      }

      const intake = intakeAuditFinding(finding, currentCommit, defects, now);
      if (!intake.ok) {
        results.push({ checkId: candidate.checkId, decision: "reject", reasons: [intake.reason], findingKey });
        continue;
      }
      defects = intake.result.defects;
      acceptedCount += 1;
      appendRunlogEvent(
        paths.runlogFile,
        buildNightAuditFindingAcceptedEvent({
          id: nextEventId(),
          timestamp: now,
          relatedIds: [active.sessionId, options.task.taskId, intake.matchedDefect.defectId],
          data: { sessionId: active.sessionId, taskId: options.task.taskId, findingKey, domain: options.task.domain, defectId: intake.matchedDefect.defectId },
        }),
      );

      const resultItem: SubmitResultItem = { checkId: candidate.checkId, decision: "accept", reasons: [], findingKey };

      if (intake.alreadyPublished) {
        resultItem.publication = { kind: "already_published", issueNumber: intake.existingExternalIssueRef?.number, issueUrl: intake.existingExternalIssueRef?.url };
      } else if (backlogSuppressed) {
        resultItem.publication = { kind: "suppressed_backlog" };
      } else if (!token || !owner) {
        resultItem.publication = { kind: "no_credentials" };
      } else {
        const publish = await publishAuditFinding(
          { finding, defectId: intake.matchedDefect.defectId, existingExternalIssueRef: intake.existingExternalIssueRef, owner: owner.owner, repo: owner.repo, token, now },
          client,
        );
        appendRunlogEvent(
          paths.runlogFile,
          buildNightAuditIssuePublishedEvent({
            id: nextEventId(),
            timestamp: now,
            relatedIds: [active.sessionId, intake.matchedDefect.defectId],
            data: {
              sessionId: active.sessionId,
              defectId: intake.matchedDefect.defectId,
              findingKey,
              outcome: publish.kind,
              ...("issueRef" in publish ? { issueNumber: publish.issueRef.number, issueUrl: publish.issueRef.url } : {}),
            },
          }),
        );
        if ("issueRef" in publish) {
          defects = defects.map((d) => (d.defectId === intake.matchedDefect.defectId ? { ...d, externalIssueRef: publish.issueRef } : d));
          resultItem.publication = { kind: publish.kind, issueNumber: publish.issueRef.number, issueUrl: publish.issueRef.url };
          if (publish.kind === "created") newIssuesThisSubmission += 1;
        } else {
          resultItem.publication = { kind: publish.kind, reason: "reason" in publish ? publish.reason : undefined };
        }
      }

      results.push(resultItem);
    }

    const coverageEntry = {
      domain: options.task.domain,
      scope: options.task.scope,
      lastReviewedCommit: options.task.repositoryCommit,
      lastReviewedAt: now,
      outcomeSummary: `${acceptedCount} accepted, ${results.length - acceptedCount} rejected out of ${results.length} candidate finding(s).`,
      findingsProduced: acceptedCount > 0,
    };
    const nextCoverage = upsertCoverageEntry(state.nightAuditCoverage ?? [], coverageEntry);

    const nextUsage: NightAuditSessionUsage = {
      ...active.usage,
      elapsedMinutes: elapsedMinutesSince(active.startedAt, now),
      reviewTasksAttempted: active.usage.reviewTasksAttempted + 1,
      reviewTasksCompleted: active.usage.reviewTasksCompleted + 1,
      consecutiveTasksWithNoAcceptedFindings: acceptedCount > 0 ? 0 : active.usage.consecutiveTasksWithNoAcceptedFindings + 1,
      newIssuesCreated: active.usage.newIssuesCreated + newIssuesThisSubmission,
    };

    state = { ...state, defects, nightAuditCoverage: nextCoverage, nightAuditActiveSession: { ...active, usage: nextUsage } };
    writeStateModel(paths.stateFile, state);

    return { sessionId: active.sessionId, taskId: options.task.taskId, results, acceptedCount, rejectedCount: results.length - acceptedCount };
  } finally {
    lock.release();
  }
}

export type CancelOutcome = { ok: true; sessionId: string; result: NightAuditResult } | { ok: false; reason: string };

/** `aiqt review night cancel` (build spec Sec 4): bookkeeping only -- no live process is ever signaled, mirroring cancelMaintenanceOccurrence exactly. */
export function cancelNightAuditSession(root: string, now: string = new Date().toISOString()): CancelOutcome {
  const target = loadNightAuditTargetOrThrow(root);
  const { paths } = target;

  let lock;
  try {
    lock = acquireWorkspaceOperationLock(paths.aiqtDir, NIGHT_AUDIT_LOCK_OPERATION_ID);
  } catch (err) {
    if (err instanceof WorkspaceOperationLockError) return { ok: false, reason: "Another Night Audit operation is in progress; try again shortly." };
    throw err;
  }
  try {
    const state = readStateModel(paths.stateFile);
    const active = state.nightAuditActiveSession;
    if (!active) return { ok: false, reason: "No active Night Audit session to cancel." };

    const usage: NightAuditSessionUsage = { ...active.usage, elapsedMinutes: elapsedMinutesSince(active.startedAt, now) };
    const result = buildResult(active.sessionId, active.startedAt, now, "cancelled", usage);
    const nextState: StateModel = { ...state, nightAuditActiveSession: null };
    writeStateModel(paths.stateFile, nextState);

    const nextEventId = nextEventIdFactory(paths.runlogFile);
    appendRunlogEvent(
      paths.runlogFile,
      buildNightAuditSessionCancelledEvent({
        id: nextEventId(),
        timestamp: now,
        relatedIds: [active.sessionId],
        data: { sessionId: active.sessionId, stopReason: "cancelled", result: result as unknown as Record<string, unknown> },
      }),
    );
    return { ok: true, sessionId: active.sessionId, result };
  } finally {
    lock.release();
  }
}

export type StatusOutcome =
  | { kind: "active"; active: NonNullable<StateModel["nightAuditActiveSession"]> }
  | { kind: "last_result"; result: NightAuditResult }
  | { kind: "none" };

/** `aiqt review night status` (build spec Sec 14): entirely read-only. Shows the live session if one is active, otherwise the most recent finished-session runlog event. */
export function getNightAuditStatus(root: string): StatusOutcome {
  const target = loadNightAuditTargetOrThrow(root);
  const { paths, state } = target;
  if (state.nightAuditActiveSession) {
    return { kind: "active", active: state.nightAuditActiveSession };
  }
  const events = readRunlogEvents(paths.runlogFile);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === "night_audit.session_completed" || event.type === "night_audit.session_interrupted" || event.type === "night_audit.session_cancelled") {
      return { kind: "last_result", result: (event.data as { result: NightAuditResult }).result };
    }
  }
  return { kind: "none" };
}

/** `aiqt review night coverage` (build spec Sec 6): entirely read-only. */
export function getNightAuditCoverage(root: string): { domain: string; scope: string; lastReviewedCommit: string; lastReviewedAt: string; outcomeSummary: string; findingsProduced: boolean }[] {
  const target = loadNightAuditTargetOrThrow(root);
  return target.state.nightAuditCoverage ?? [];
}

export { AUDIT_ISSUE_GITHUB_TOKEN_ENV as GITHUB_TOKEN_ENV_DEFAULT };
export type { DefectRecord };
