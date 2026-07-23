import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFindingCandidate } from "./review-rules.js";
import { getExecutionSessions } from "../services/execution-session-service.js";
import { getManagedWorkspaces } from "../services/workspace-state-service.js";
import { getEvidenceRecords, findEvidenceRecordById } from "../services/evidence-service.js";
import { isTerminalSessionStatus } from "../schema/execution-session.schema.js";

/**
 * M26 §5.4: execution-session review findings. Detects broken Work
 * Unit/packet/workspace/evidence references, multiple non-terminal
 * sessions for one packet, a terminal session with a running iteration,
 * stale sessions, open decisions, budget stop conditions, terminal
 * sessions awaiting checkpoint, and provider-reported rollback as
 * unverified advisory metadata. Read-only; never mutates state.
 */
export function collectExecutionFindings(
  state: StateModel,
  knownPacketIds: readonly string[],
): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];
  const sessions = getExecutionSessions(state);
  if (sessions.length === 0) return findings;

  const workUnitIds = new Set(state.workGraph.workUnits.map((wu) => wu.id));
  const managedWorkspaces = getManagedWorkspaces(state);
  const evidenceRecords = getEvidenceRecords(state);
  const knownPacketIdSet = new Set(knownPacketIds);
  const nonTerminalByPacket = new Map<string, number>();

  for (const session of sessions) {
    if (!isTerminalSessionStatus(session.status)) {
      nonTerminalByPacket.set(session.packetId, (nonTerminalByPacket.get(session.packetId) ?? 0) + 1);
    }
  }

  for (const session of sessions) {
    if (!workUnitIds.has(session.workUnitId)) {
      findings.push({
        ruleKey: `execution.broken-work-unit.${session.id}`,
        findingKey: `execution:${session.id}:broken-work-unit-reference`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Execution session references an unknown work unit",
        message: `Execution session "${session.id}" references workUnitId "${session.workUnitId}", which does not exist.`,
        relatedIds: [session.id, session.workUnitId],
        suggestedAction: "Investigate how this session was created; the referenced work unit is missing from the graph.",
        nextRecommendedCommand: "aiqt review",
      });
    }

    if (knownPacketIdSet.size > 0 && !knownPacketIdSet.has(session.packetId)) {
      findings.push({
        ruleKey: `execution.broken-packet.${session.id}`,
        findingKey: `execution:${session.id}:broken-packet-reference`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Execution session references an unknown packet",
        message: `Execution session "${session.id}" references packetId "${session.packetId}", which is not a known packet.`,
        relatedIds: [session.id, session.packetId],
        suggestedAction: "Investigate this session's packet lineage.",
        nextRecommendedCommand: "aiqt review",
      });
    }

    if (session.workspaceRef.mode === "managed" && session.workspaceRef.workspaceId !== undefined) {
      const workspace = managedWorkspaces.find((w) => w.id === session.workspaceRef.workspaceId);
      if (!workspace) {
        findings.push({
          ruleKey: `execution.broken-workspace.${session.id}`,
          findingKey: `execution:${session.id}:broken-workspace-reference`,
          category: "execution",
          severity: "critical",
          blocking: true,
          title: "Execution session references an unknown managed workspace",
          message: `Execution session "${session.id}" references workspaceId "${session.workspaceRef.workspaceId}", which does not exist.`,
          relatedIds: [session.id, session.workspaceRef.workspaceId],
          suggestedAction: "Investigate this session's workspace reference.",
          nextRecommendedCommand: "aiqt review",
        });
      }
    }

    const allEvidenceRefs = [
      ...session.evidenceRefs,
      ...session.iterations.flatMap((i) => i.evidenceRefs),
    ];
    for (const evidenceId of allEvidenceRefs) {
      if (!findEvidenceRecordById(evidenceId, evidenceRecords)) {
        findings.push({
          ruleKey: `execution.broken-evidence.${session.id}.${evidenceId}`,
          findingKey: `execution:${session.id}:broken-evidence-reference:${evidenceId}`,
          category: "execution",
          severity: "high",
          blocking: true,
          title: "Execution session references unknown evidence",
          message: `Execution session "${session.id}" references evidenceId "${evidenceId}", which does not resolve.`,
          relatedIds: [session.id, evidenceId],
          suggestedAction: "Investigate this session's evidence reference.",
          nextRecommendedCommand: "aiqt review",
        });
      }
    }

    if ((nonTerminalByPacket.get(session.packetId) ?? 0) > 1) {
      findings.push({
        ruleKey: `execution.multiple-non-terminal.${session.id}`,
        findingKey: `execution:${session.packetId}:multiple-non-terminal-sessions`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Multiple non-terminal execution sessions for one packet",
        message: `Packet "${session.packetId}" has more than one non-terminal execution session, violating the at-most-one invariant.`,
        relatedIds: [session.id, session.packetId],
        suggestedAction: "Investigate how two non-terminal sessions were created for the same packet.",
        nextRecommendedCommand: "aiqt review",
      });
    }

    if (isTerminalSessionStatus(session.status) && session.iterations.some((i) => i.status === "running")) {
      findings.push({
        ruleKey: `execution.terminal-running-iteration.${session.id}`,
        findingKey: `execution:${session.id}:terminal-with-running-iteration`,
        category: "execution",
        severity: "critical",
        blocking: true,
        title: "Terminal execution session has a running iteration",
        message: `Execution session "${session.id}" is terminal (${session.status}) but still has a running iteration.`,
        relatedIds: [session.id],
        suggestedAction: "Investigate this inconsistent session record.",
        nextRecommendedCommand: "aiqt review",
      });
    }

    if (session.status === "stale") {
      findings.push({
        ruleKey: `execution.stale.${session.id}`,
        findingKey: `execution:${session.id}:stale`,
        category: "execution",
        severity: "medium",
        blocking: false,
        title: "Execution session is stale",
        message: `Execution session "${session.id}" has been marked stale (no activity within its configured window).`,
        relatedIds: [session.id],
        suggestedAction: "Import a session.status_changed event to resume, or leave as historical record.",
        nextRecommendedCommand: "aiqt execution status",
      });
    }

    for (const decision of session.decisions.filter((d) => d.status === "open")) {
      findings.push({
        ruleKey: `execution.open-decision.${session.id}.${decision.id}`,
        findingKey: `execution:${session.id}:open-decision:${decision.id}`,
        category: "execution",
        severity: "medium",
        blocking: false,
        title: "Execution session has an open decision",
        message: `Execution session "${session.id}" has an open decision: "${decision.title}".`,
        relatedIds: [session.id, decision.id],
        suggestedAction: "Resolve the decision (aiqt execution import a decision.resolved event).",
        nextRecommendedCommand: "aiqt execution status",
      });
    }

    if (session.budgetState === "reached" || session.budgetState === "exceeded") {
      findings.push({
        ruleKey: `execution.budget-stop.${session.id}`,
        findingKey: `execution:${session.id}:budget-stop:${session.budgetState}`,
        category: "execution",
        severity: "medium",
        blocking: false,
        title: "Execution session has a budget stop condition",
        message: `Execution session "${session.id}" budget state is "${session.budgetState}".`,
        relatedIds: [session.id],
        suggestedAction: "Review usage; import a session.budget_updated event to continue.",
        nextRecommendedCommand: "aiqt execution status",
      });
    }

    if (isTerminalSessionStatus(session.status) && !state.checkpoints.some((cp) => cp.packetId === session.packetId)) {
      findings.push({
        ruleKey: `execution.awaiting-checkpoint.${session.id}`,
        findingKey: `execution:${session.id}:terminal-awaiting-checkpoint`,
        category: "execution",
        severity: "medium",
        blocking: false,
        title: "Terminal execution session is awaiting checkpoint",
        message: `Execution session "${session.id}" is terminal (${session.status}) but its packet has no checkpoint yet.`,
        relatedIds: [session.id, session.packetId],
        suggestedAction: "Run aiqt checkpoint to record the Work Unit's outcome.",
        nextRecommendedCommand: "aiqt checkpoint",
      });
    }

    if (session.rollbackRecords.length > 0) {
      findings.push({
        ruleKey: `execution.rollback-reported.${session.id}`,
        findingKey: `execution:${session.id}:rollback-reported`,
        category: "execution",
        severity: "low",
        blocking: false,
        title: "Execution session has provider-reported rollback metadata",
        message: `Execution session "${session.id}" has ${session.rollbackRecords.length} unverified provider-reported rollback record(s). This is advisory metadata only -- AIQT never executes or verifies it.`,
        relatedIds: [session.id],
        suggestedAction: "No action required; informational only.",
        nextRecommendedCommand: null,
      });
    }
  }

  return findings;
}
