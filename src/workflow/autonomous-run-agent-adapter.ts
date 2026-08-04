import type { AutonomousCandidate } from "../schema/autonomous-run.schema.js";
// Type-only import: this file has zero runtime dependency on the
// (impure, process-spawning) command-runner module, only its request
// shape.
import type { AutonomousCommandRequest } from "../workspaces/autonomous-command-runner.js";

/**
 * M36-WU03 (build spec Sec 7 WU36-03 Scope: "bounded agent adapter").
 * A data-only interface -- exactly the same shape AIQT's own M27 Claude
 * Code execution adapter uses (README.md: "Optional Claude Code
 * stream-json adapter (data-only)"): it describes what a repair
 * proposal looks like and normalizes/imports one, it never itself
 * invokes a model, makes a network call, or spawns a process. No
 * implementation of this interface in this repository calls an external
 * coding model -- the only implementation provided
 * (DeterministicStubAgentAdapter, below) returns a fixed, caller-
 * supplied command list, for test and future-integration-point use
 * only. A real model-backed adapter is out of this Work Unit's scope
 * and out of all of M36's scope per the build spec's own framing
 * ("inspired by," not built on, an external agent invocation).
 */
export interface AgentAdapterProposal {
  commands: AutonomousCommandRequest[];
}

export interface AgentAdapter {
  proposeCommands(candidate: AutonomousCandidate): AgentAdapterProposal;
}

/**
 * A deterministic, fully caller-controlled stand-in adapter. Returns
 * exactly the command list passed to its constructor, regardless of the
 * candidate -- suitable for tests that need to exercise the execution
 * loop's budget/policy/cancellation behavior against a known, fixed
 * command sequence without any real decision-making logic in the loop.
 */
export class DeterministicStubAgentAdapter implements AgentAdapter {
  constructor(private readonly commands: AutonomousCommandRequest[]) {}

  proposeCommands(): AgentAdapterProposal {
    return { commands: [...this.commands] };
  }
}
