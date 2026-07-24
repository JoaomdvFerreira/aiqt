/**
 * aiqt execution adapter claude-code example (M27 §4.1/§7): a static,
 * illustrative example of the generated request package and the follow-up
 * import command -- never touches state, never contacts a provider.
 */
export const EXAMPLE_CLAUDE_CODE_REQUEST = {
  contractVersion: "claude-code-stream-json-request@1",
  requestId: "sha256:example0000000000000000000000000000000000000000000000000000000",
  adapterId: "claude-code-stream-json@1",
  executionSessionId: "sha256:example0000000000000000000000000000000000000000000000000000000",
  workUnitId: "WU001",
  packetId: "PKT-001",
  workspacePath: null,
  externalSessionId: "11111111-1111-4111-8111-111111111111",
  mode: "start",
  prompt: { boundedText: true, source: "current_agent_packet" },
  commandTemplate: {
    executable: "claude",
    arguments: ["-p", "--output-format", "stream-json", "--verbose", "--session-id", "11111111-1111-4111-8111-111111111111"],
  },
  outputInstructions: { format: "stream-json", capture: "file_or_pipe_to_import" },
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-02T00:00:00.000Z",
  userActionRequired: [
    "Install and authenticate the Claude Code CLI yourself; AIQT never installs, logs in, or manages credentials.",
    "Do not add any permission-bypass flag; the generated command template is fixed and reviewed.",
    "Run the generated command, piping the current agent packet's prompt text to stdin, and capture stream-json output to a file or pipe.",
    "Import the captured output with: aiqt execution adapter claude-code import --request <request-id> --from-file <path> (or --stdin).",
  ],
} as const;
