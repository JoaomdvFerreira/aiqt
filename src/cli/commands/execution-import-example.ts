/** Sample execution-protocol envelope JSON printed by `aiqt execution import --example`. */
export const EXAMPLE_EXECUTION_ENVELOPE = {
  protocolVersion: "long-running-execution-protocol@1",
  providerId: "example.provider",
  sessionClientKey: "example-client-session-1",
  events: [
    {
      type: "session.opened",
      eventId: "evt-1",
      at: "2026-01-01T00:00:00.000Z",
      budgets: { maxIterations: 20, staleAfterSeconds: 3600 },
    },
    {
      type: "iteration.started",
      eventId: "evt-2",
      at: "2026-01-01T00:05:00.000Z",
      providerIterationKey: "iteration-1",
      objectiveSummary: "Implement the first slice of the feature.",
    },
    {
      type: "iteration.finished",
      eventId: "evt-3",
      at: "2026-01-01T00:30:00.000Z",
      providerIterationKey: "iteration-1",
      status: "completed",
      resultSummary: "Implemented and tested the first slice.",
      reportedTokens: 12000,
      reportedDurationSeconds: 1500,
      commitRefs: [{ sha: "abc1234", message: "Add first slice" }],
    },
  ],
};
