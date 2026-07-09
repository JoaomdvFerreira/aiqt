/** Sample checkpoint input JSON printed by `aiqt checkpoint --example`. Matches the M5 spec's Appendix B example. */
export const EXAMPLE_CHECKPOINT_INPUT = {
  summary: "Implemented the bounded work unit from the M4 packet.",
  completed: [
    "Added the command handler.",
    "Added unit and integration tests.",
  ],
  notCompleted: [],
  filesChanged: [
    "src/cli/commands/example.command.ts",
    "tests/integration/example.command.test.ts",
  ],
  validationResult: "passed",
  acceptanceCriteriaResult: "passed",
  validationCommands: [
    {
      command: "pnpm validate",
      result: "passed",
      summary: "Typecheck, lint, and tests passed.",
    },
  ],
  acceptanceCriteria: [
    {
      criterion: "The command returns deterministic JSON output.",
      result: "passed",
      evidence: "Covered by integration tests.",
    },
  ],
  issues: [],
  targetStatus: "done",
  notes: ["No unresolved implementation issues."],
};
