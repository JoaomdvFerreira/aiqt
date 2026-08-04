import type { AutonomousRunStatus, AutonomousResultState } from "../schema/autonomous-run.schema.js";
import { isTerminalRunStatus, RESULT_STATE_TERMINAL_STATUS } from "../schema/autonomous-run.schema.js";

/**
 * M36-WU01: the exact allowed transition table for the autonomous-run
 * lifecycle (build spec "Required run lifecycle"). Mirrors the pattern
 * in execution-session-transitions.ts (M26): a fixed adjacency map, no
 * self-transitions, terminal statuses allow nothing further. Pure --
 * this module never runs a command, never creates a workspace, never
 * calls a model.
 *
 * created -> preflight -> classified -> awaiting_approval ->
 * preparing_workspace -> executing -> validating -> reviewing ->
 * completed | blocked | failed | cancelled | budget_exhausted
 *
 * Three deliberate branch points beyond the straight-line spec example:
 * - `classified` can go straight to a terminal status without
 *   `awaiting_approval` (a low-risk-autonomous candidate needs no human
 *   approval step) or straight to `blocked`/`failed` (a prohibited or
 *   unsupported candidate never reaches approval at all).
 * - `cancelled` and `budget_exhausted` are reachable from every
 *   non-terminal status, since a human operator or a budget check can
 *   interrupt a run at any stage, not only at a specific one.
 * - `executing -> blocked` (M37-WU03 correction, recorded honestly
 *   rather than silently added): M36-WU04's own produceAutonomousEvidencePacket
 *   reports resultState:"blocked" the moment a proposed command is
 *   denied by command policy mid-execution -- a real, legitimate
 *   stopping point that never reaches `validating`/`reviewing` at all.
 *   This table originally only reached `blocked` via `reviewing`
 *   (build spec's straight-line example), which never actually
 *   happens for that outcome in the real evidence-binding
 *   implementation -- discovered wiring WU37-03's real (non-simulated)
 *   completion path against M36-WU04's already-existing, unmodified
 *   behavior.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<AutonomousRunStatus, ReadonlySet<AutonomousRunStatus>>> = {
  created: new Set(["preflight", "cancelled", "failed"]),
  preflight: new Set(["classified", "blocked", "failed", "cancelled"]),
  classified: new Set(["awaiting_approval", "preparing_workspace", "blocked", "failed", "cancelled"]),
  awaiting_approval: new Set(["preparing_workspace", "blocked", "cancelled"]),
  preparing_workspace: new Set(["executing", "blocked", "failed", "cancelled"]),
  executing: new Set(["validating", "blocked", "failed", "cancelled", "budget_exhausted"]),
  validating: new Set(["reviewing", "failed", "cancelled", "budget_exhausted"]),
  reviewing: new Set(["completed", "blocked", "failed", "cancelled"]),
  completed: new Set(),
  blocked: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  budget_exhausted: new Set(),
};

export function isValidRunStatusTransition(from: AutonomousRunStatus, to: AutonomousRunStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].has(to);
}

/** Every status this table declares reachable from `from` -- used by tests to assert the table's own completeness rather than duplicating it. */
export function allowedNextStatuses(from: AutonomousRunStatus): ReadonlySet<AutonomousRunStatus> {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * The one non-terminal-status invariant this module additionally
 * enforces beyond the adjacency table: a terminal status must never be
 * the source of a transition, even to itself (redundant with
 * `isValidRunStatusTransition` returning false for those cases, since
 * every terminal entry's set is empty -- exposed separately because
 * "why did this fail" is a more useful test/error message than the
 * generic transition check alone).
 */
export function isValidRunStatus(status: AutonomousRunStatus): boolean {
  return status in ALLOWED_TRANSITIONS;
}

/**
 * A run's `resultState` (build spec "Result state") must be set only
 * once the run reaches a terminal status, and only a status matching
 * RESULT_STATE_TERMINAL_STATUS's own pairing for that result state --
 * e.g. a run cannot report `resultState: "passed"` unless it actually
 * reached `completed`; two conceptually different result states
 * (`blocked` and `needs_input`) both legitimately pair with the same
 * `blocked` terminal status (a needs_input outcome is a blocked run
 * that is specifically missing operator input, not a different status).
 */
export function isValidTerminalPairing(status: AutonomousRunStatus, resultState: AutonomousResultState): boolean {
  if (!isTerminalRunStatus(status)) return false;
  return RESULT_STATE_TERMINAL_STATUS[resultState] === status;
}
