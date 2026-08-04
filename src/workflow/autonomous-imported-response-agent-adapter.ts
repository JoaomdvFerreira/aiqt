import type { AgentAdapter, AgentAdapterProposal } from "./autonomous-run-agent-adapter.js";
import type { AutonomousAgentProposedCommand } from "../schema/autonomous-agent-request.schema.js";

/**
 * M37-WU03: the real, production AgentAdapter implementation -- data-only,
 * exactly like DeterministicStubAgentAdapter's shape (M36-WU03), but
 * distinctly named and used because DeterministicStubAgentAdapter is
 * explicitly test-only (see its own doc comment and the M37-WU01
 * boundary-scan guard forbidding its use in any real command file).
 * Wraps the commands an operator's own coding-agent tool already
 * proposed and AIQT already imported (M37-WU02's
 * importAutonomousAgentResponse) -- by the time this adapter is
 * constructed, no further decision-making happens; it only replays an
 * already-validated, already-recorded list of proposed commands into
 * M36-WU04's produceAutonomousEvidencePacket, which then enforces
 * command policy and budgets exactly as it would for any other adapter.
 */
export class ImportedResponseAgentAdapter implements AgentAdapter {
  constructor(private readonly commands: readonly AutonomousAgentProposedCommand[]) {}

  proposeCommands(): AgentAdapterProposal {
    return { commands: this.commands.map((c) => ({ command: c.command, args: [...c.args] })) };
  }
}
