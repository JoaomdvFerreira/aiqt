import { describe, expect, it } from "vitest";
import { buildInitialProjectModel } from "../../src/state/project-store.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { deriveCanonicalHandoff } from "../../src/workflow/canonical-handoff.js";
import { resolveRoots } from "../../src/workflow/root-resolution.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";

const TIME = "2026-01-01T00:00:00.000Z";

function workUnit(): WorkUnit {
  return { id: "WU-1", milestoneId: "M-1", title: "Handoff", objective: "Reconstruct facts", scope: ["handoff"], outOfScope: ["chat history"], acceptanceCriteria: ["facts resolve"], agentContextRefs: ["decisions", "missing-ref"], suggestedFiles: ["src/a.ts"], validationCommands: ["pnpm test"], status: "done", dependencies: [], createdAt: TIME, updatedAt: TIME };
}

describe("canonical handoff", () => {
  it("derives effective amendments, trust-labelled evidence, unresolved facts, and qualification without persistence", () => {
    const project = buildInitialProjectModel({ id: "P-1", name: "p", objective: "o", targetUsers: [], preferredAgent: null, createdAt: TIME });
    project.decisions = [{ id: "D-1", decision: "Use the canonical record", reason: "one source", impact: "handoff", status: "decided", date: "2026-01-01", createdAt: TIME, updatedAt: TIME }];
    const wu = workUnit();
    const state = buildInitialStateModel(TIME);
    state.workGraph = { milestones: [{ id: "M-1", title: "m", objective: "m", status: "done", workUnitIds: [wu.id] }], workUnits: [wu], dependencies: [] };
    state.checkpoints = [{ id: "CP-1", workUnitId: wu.id, packetId: null, summary: "implemented", completed: ["handoff"], notCompleted: [], filesChanged: ["src/a.ts"], issues: [{ title: "follow up", description: null, severity: "medium", status: "open", agentCanFix: true }], validationResult: "partial", acceptanceCriteriaResult: "passed", validationCommands: [], acceptanceCriteria: [], finalWorkUnitStatus: "done", nextRecommendation: "aiqt review", createdAt: TIME }];
    state.checkpointAmendments = [{ amendmentId: "AMD-1", checkpointId: "CP-1", workUnitId: wu.id, validationResult: "passed", reason: "verified", amendedAt: TIME, sourceCommand: "aiqt checkpoint amend" }];
    state.evidence = { records: [{ evidenceId: "EV-1", contractVersion: "1.0", provider: { providerId: "ci", providerType: "ci", trustLevel: "self_reported" }, workflowBinding: { workUnitId: wu.id, packetId: "PK-1", implementationRootId: "root" }, codeBinding: { commitSha: "a".repeat(40), capturedAt: TIME }, reviewer: { reviewerType: "automated", independentContext: "unknown" }, results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" }, sourceFindings: [], decisionEscalationIds: [], artifactReferences: [], observedAt: TIME, recordedAt: TIME }], decisionEscalations: [] };
    const handoff = deriveCanonicalHandoff({ project, state, workUnitId: wu.id, roots: resolveRoots({ controlRoot: process.cwd() }), revision: { requestedRevision: "a".repeat(40), head: "a".repeat(40), base: "b".repeat(40), changes: [{ status: "M", path: "src/a.ts" }], unavailableReason: null } });
    expect(handoff.effectiveCheckpoint).toMatchObject({ validationResult: "passed", amendmentsApplied: ["AMD-1"] });
    expect(handoff.context.decisions.map((decision) => decision.id)).toEqual(["D-1"]);
    expect(handoff.unresolved).toMatchObject({ checkpointIssues: ["follow up"], contextReferences: ["missing-ref"] });
    expect(handoff.evidence[0]).toMatchObject({ trustLevel: "self_reported", revisionMatches: true });
    expect(handoff.qualification.status).toBe("UNKNOWN");
  });

  it("labels an estimate as estimated rather than measured", () => {
    const project = buildInitialProjectModel({ id: "P-1", name: "p", objective: "o", targetUsers: [], preferredAgent: null, createdAt: TIME });
    const state = buildInitialStateModel(TIME);
    const handoff = deriveCanonicalHandoff({ project, state, workUnitId: "missing", roots: resolveRoots({ controlRoot: process.cwd() }), revision: { requestedRevision: null, head: null, base: null, changes: [], unavailableReason: "none" }, contextSize: { value: 42, provenance: "estimated" } });
    expect(handoff.contextSize).toEqual({ value: 42, provenance: "estimated" });
  });
});
