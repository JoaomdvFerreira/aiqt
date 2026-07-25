/**
 * aiqt execution external example (M27R §5.1/§8.3): a static,
 * illustrative example of the full generic request/result bundle --
 * never touches state, never contacts an agent.
 */
export const EXAMPLE_EXTERNAL_REQUEST = {
  protocolVersion: "aiqt-external-execution-request@1",
  requestId: "sha256:example0000000000000000000000000000000000000000000000000000000",
  executionSessionId: "sha256:example0000000000000000000000000000000000000000000000000000000",
  sessionClientKey: "external/11111111-1111-4111-8111-111111111111",
  workUnitId: "WU001",
  packetId: "PKT-001",
  workspaceRef: { mode: "none" },
  requestSequence: 1,
  objective: "Implement the current Work Unit's objective.",
  packet: {
    sourcePacketId: "PKT-001",
    role: "implementer",
    scope: ["Example scope item"],
    outOfScope: ["Example out-of-scope item"],
    constraints: [],
    acceptanceCriteria: ["Example acceptance criterion"],
    validationCommands: ["npm test"],
  },
  expectedResultProtocol: "aiqt-external-execution-result@1",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-02T00:00:00.000Z",
} as const;

export const EXAMPLE_EXTERNAL_RESULT = {
  protocolVersion: "aiqt-external-execution-result@1",
  requestId: "sha256:example0000000000000000000000000000000000000000000000000000000",
  executionSessionId: "sha256:example0000000000000000000000000000000000000000000000000000000",
  agent: { providerId: "openai/codex", product: "Codex CLI", version: "1.0.0" },
  resultClass: "success",
  summary: "Implemented the requested change and ran the listed validation commands.",
  continuation: { recommended: false },
  validationClaims: [{ command: "npm test", status: "passed", trust: "self_reported" }],
  commitRefs: [{ sha: "abc1234", message: "Implement the feature" }],
  evidenceRefs: [],
} as const;

export const EXTERNAL_RESULT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "aiqt-external-execution-result@1",
  type: "object",
  required: ["protocolVersion", "requestId", "executionSessionId", "agent", "resultClass", "summary", "continuation", "validationClaims", "commitRefs", "evidenceRefs"],
  properties: {
    protocolVersion: { const: "aiqt-external-execution-result@1" },
    requestId: { type: "string", minLength: 1 },
    executionSessionId: { type: "string", minLength: 1 },
    agent: {
      type: "object",
      required: ["providerId"],
      properties: {
        providerId: { type: "string" },
        product: { type: "string" },
        version: { type: "string" },
        externalSessionId: { type: "string" },
        externalRunId: { type: "string" },
      },
      additionalProperties: false,
    },
    resultClass: { enum: ["success", "limited", "unavailable", "failed"] },
    summary: { type: "string", maxLength: 4000 },
    continuation: {
      type: "object",
      required: ["recommended"],
      properties: { recommended: { type: "boolean" }, reason: { type: "string", maxLength: 1000 } },
      additionalProperties: false,
    },
    validationClaims: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        required: ["command", "status", "trust"],
        properties: {
          command: { type: "string" },
          status: { enum: ["passed", "failed", "not_run"] },
          summary: { type: "string" },
          trust: { const: "self_reported" },
        },
        additionalProperties: false,
      },
    },
    commitRefs: { type: "array", maxItems: 100, items: { type: "object", required: ["sha"], properties: { sha: { type: "string" }, message: { type: "string" } }, additionalProperties: false } },
    evidenceRefs: { type: "array", maxItems: 100, items: { type: "string" } },
    rollbackClaim: { type: "object", properties: { targetRef: { type: "string" }, reasonSummary: { type: "string" }, scope: { type: "string" } }, additionalProperties: false },
    reportedUsage: { type: "object", properties: { reportedTokens: { type: "integer", minimum: 0 }, reportedDurationSeconds: { type: "integer", minimum: 0 } }, additionalProperties: false },
  },
  additionalProperties: false,
} as const;

export const EXTERNAL_REQUEST_INSTRUCTIONS_MD = `# AIQT External Execution Request

AIQT does not run any coding agent on your behalf. You may use any
external coding agent (Claude Code, Codex, Cursor, Copilot, a local
agent, or another tool of your choice).

1. AIQT does not run the agent -- you do.
2. You may use any coding agent you choose.
3. The agent must work only within this packet's scope (see
   \`request.json\`'s \`packet\` field) -- nothing outside the listed
   scope, and nothing in \`outOfScope\`.
4. The agent (or you, on its behalf) must write a result document
   conforming to \`aiqt-external-execution-result@1\` (see
   \`result.schema.json\` and \`result.example.json\`).
5. A "success" result is NOT Work Unit completion.
6. \`aiqt checkpoint\` remains the sole authority for completing this
   Work Unit.

## Steps

1. Select an agent.
2. Give the agent this bundle (or at least \`request.json\`'s
   \`objective\`/\`packet\` fields).
3. Run the agent externally.
4. Save the agent's result as a JSON file matching
   \`aiqt-external-execution-result@1\`.
5. Import it: \`aiqt execution external import --request <request-id>
   --from-file <path>\` (or \`--stdin\`).
6. Run \`aiqt execution external status\` and continue or checkpoint
   based on what it reports.
`;
