import { describe, it, expect } from "vitest";
import { renderAgentPacket } from "../../src/services/agent-packet-template.js";
import type { PacketContext } from "../../src/services/agent-packet-service.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "Initialize app",
    objective: "Create the shell.",
    scope: ["Create scaffold"],
    outOfScope: ["No auth"],
    acceptanceCriteria: ["App starts"],
    agentContextRefs: [],
    suggestedFiles: ["src/"],
    validationCommands: ["pnpm test", "pnpm build"],
    status: "ready",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    ...overrides,
  };
}

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "M001",
    title: "Foundation",
    objective: "Base structure.",
    status: "ready",
    workUnitIds: ["WU001"],
    ...overrides,
  };
}

function baseContext(overrides: Partial<PacketContext> = {}): PacketContext {
  return {
    projectId: "PROJECT-001",
    projectObjective: "Build a CLI.",
    targetUsers: ["devs"],
    milestone: makeMilestone(),
    workUnit: makeWorkUnit(),
    constraints: ["Local only"],
    technologyPreferences: [],
    businessRules: [],
    referencedRequirements: [],
    referencedDecisions: [],
    referencedRisks: [],
    referencedAssumptions: [],
    referencedOpenQuestions: [],
    dependencies: [],
    relevantSkills: [],
    ...overrides,
  };
}

const REQUIRED_HEADINGS = [
  "# AGENT EXECUTION PACKET",
  "## Role",
  "## Project Objective",
  "## Current Work Unit",
  "## Scope",
  "## Out of Scope",
  "## Relevant Context",
  "## Constraints",
  "## Dependencies",
  "## Acceptance Criteria",
  "## Suggested Files / Areas",
  "## Validation Commands",
  "## Required Agent Output",
];

describe("renderAgentPacket", () => {
  it("includes all required sections in the documented stable order", () => {
    const packet = renderAgentPacket(baseContext());
    let lastIndex = -1;
    for (const heading of REQUIRED_HEADINGS) {
      const index = packet.indexOf(heading);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  });

  it("targets exactly the selected work unit, excluding unrelated work", () => {
    const packet = renderAgentPacket(baseContext());
    expect(packet).toContain("WU001");
    expect(packet).not.toContain("WU002");
    expect(packet).not.toContain("unrelated");
  });

  it("renders Dependencies as None when there are no attached dependencies", () => {
    const packet = renderAgentPacket(baseContext({ dependencies: [] }));
    const depsSection = packet.split("## Dependencies")[1].split("## Acceptance Criteria")[0];
    expect(depsSection).toContain("- None.");
  });

  it("renders a dependency summary when dependencies are attached", () => {
    const packet = renderAgentPacket(
      baseContext({
        dependencies: [
          { id: "DEP-001", fromId: "WU000", toId: "WU001", type: "blocks", reason: "Must exist first." },
        ],
      }),
    );
    const depsSection = packet.split("## Dependencies")[1].split("## Acceptance Criteria")[0];
    expect(depsSection).toContain("blocks from WU000");
    expect(depsSection).toContain("Must exist first.");
  });

  it("RC1: does not duplicate punctuation when a dependency reason already ends in a period", () => {
    const packet = renderAgentPacket(
      baseContext({
        dependencies: [
          { id: "DEP-001", fromId: "WU000", toId: "WU001", type: "blocks", reason: "Must exist first." },
        ],
      }),
    );
    const depsSection = packet.split("## Dependencies")[1].split("## Acceptance Criteria")[0];
    expect(depsSection).not.toContain("..");
    expect(depsSection).toContain("blocks from WU000: Must exist first.");
  });

  it("RC1: does not duplicate punctuation when a dependency reason ends in ! or ?", () => {
    const packet = renderAgentPacket(
      baseContext({
        dependencies: [
          { id: "DEP-001", fromId: "WU000", toId: "WU001", type: "requires", reason: "Is this ready?" },
        ],
      }),
    );
    const depsSection = packet.split("## Dependencies")[1].split("## Acceptance Criteria")[0];
    expect(depsSection).not.toMatch(/\?\.|!\.|\.\./);
    expect(depsSection).toContain("requires from WU000: Is this ready.");
  });

  it("renders referenced requirement/decision/risk/assumption/open-question records", () => {
    const packet = renderAgentPacket(
      baseContext({
        referencedRequirements: [
          { id: "REQ-001", clientKey: undefined, title: "T", description: "D", priority: "medium", type: "functional", acceptanceCriteria: ["c1", "c2"], status: "accepted", createdAt: T1, updatedAt: T1 },
        ],
        referencedDecisions: [
          { id: "D001", clientKey: undefined, decision: "Use TS", reason: "R", impact: "I", status: "decided", date: "2026-01-01", createdAt: T1, updatedAt: T1 },
        ],
        referencedRisks: [
          { id: "RISK-001", clientKey: undefined, title: "R", description: "D", severity: "medium", mitigation: null, status: "open", createdAt: T1, updatedAt: T1 },
        ],
        referencedAssumptions: [
          { id: "ASM-001", clientKey: undefined, statement: "S", reason: null, source: "human", status: "active", createdAt: T1, updatedAt: T1 },
        ],
        referencedOpenQuestions: [
          { id: "Q001", clientKey: undefined, question: "Q?", impact: "medium", status: "open", answer: null, createdAt: T1, updatedAt: T1 },
        ],
      }),
    );
    expect(packet).toContain("Requirement [REQ-001]: T - D");
    expect(packet).toContain("Acceptance criteria: c1; c2");
    expect(packet).toContain("Decision [D001]: Use TS");
    expect(packet).toContain("Risk [RISK-001]: R - Severity: medium");
    expect(packet).toContain("Mitigation: None recorded");
    expect(packet).toContain("Assumption [ASM-001]: S");
    expect(packet).toContain("Reason: None recorded");
    expect(packet).toContain("Open Question [Q001]: Q?");
    expect(packet).toContain("Answer: Unanswered");
  });

  it("renders the validation commands as a single bash code block", () => {
    const packet = renderAgentPacket(baseContext());
    expect(packet).toContain("```bash\npnpm test\npnpm build\n```");
  });

  it("omits target users / technology / business rule lines when empty", () => {
    const packet = renderAgentPacket(
      baseContext({ targetUsers: [], technologyPreferences: [], businessRules: [] }),
    );
    expect(packet).not.toContain("Target users:");
    expect(packet).not.toContain("Technology preference:");
    expect(packet).not.toContain("Business rule:");
  });
});
