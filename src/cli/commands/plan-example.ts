/** Sample plan input JSON printed by `aiqt plan --example`. Matches the M3 spec's Appendix B example. */
export const EXAMPLE_PLAN_INPUT = {
  milestones: [
    {
      clientKey: "m1-foundation",
      title: "Application Foundation",
      objective:
        "Create the base application structure and development workflow.",
    },
    {
      clientKey: "m2-core-feature",
      title: "Core Feature",
      objective: "Implement the first user-facing feature.",
    },
  ],
  workUnits: [
    {
      clientKey: "wu-init-app",
      milestoneClientKey: "m1-foundation",
      title: "Initialize application shell",
      objective: "Create a runnable app shell with test and build commands.",
      scope: [
        "Create package setup",
        "Create src entry point",
        "Create test setup",
      ],
      outOfScope: [
        "Do not implement authentication",
        "Do not implement persistence",
      ],
      acceptanceCriteria: ["pnpm build passes", "pnpm test passes"],
      agentContextRefs: ["project.objective", "context.technologyPreferences"],
      suggestedFiles: ["package.json", "src/index.ts", "tests/"],
      validationCommands: ["pnpm test", "pnpm build"],
    },
    {
      clientKey: "wu-core-feature",
      milestoneClientKey: "m2-core-feature",
      title: "Implement core feature",
      objective: "Build the smallest useful version of the main feature.",
      scope: ["Implement core feature logic", "Add tests"],
      outOfScope: ["Do not add secondary features"],
      acceptanceCriteria: [
        "Feature works through the expected interface",
        "Tests cover success and failure cases",
      ],
      agentContextRefs: ["requirements"],
      suggestedFiles: ["src/", "tests/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [
    {
      fromClientKey: "wu-init-app",
      toClientKey: "wu-core-feature",
      type: "blocks",
      reason:
        "The application shell must exist before the core feature can be implemented.",
    },
  ],
};
