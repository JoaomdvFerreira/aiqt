import { describe, it, expect } from "vitest";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { buildParallelBatch } from "../../src/workflow/parallel-batch.js";
import { deriveEffectiveExecutionMetadata } from "../../src/workflow/execution-metadata-defaults.js";
import { buildExecutionMetadataAdvisory } from "../../src/workflow/execution-metadata-advisory.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { WorkUnit } from "../../src/schema/work-unit.schema.js";
import type { Milestone } from "../../src/schema/milestone.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";

function historicalWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "Pre-M24 work",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: T1,
    updatedAt: T1,
    // No executionMetadata field at all -- this is the exact pre-M24 shape.
    ...overrides,
  };
}

function historicalMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: "M001", title: "M", objective: "O", status: "ready", workUnitIds: ["WU001"], ...overrides };
}

function preM24State(workUnits: WorkUnit[] = [historicalWorkUnit()]): StateModel {
  const base = buildInitialStateModel(T1);
  return {
    ...base,
    workGraph: { milestones: [historicalMilestone({ workUnitIds: workUnits.map((wu) => wu.id) })], workUnits, dependencies: [] },
  };
}

describe("M24 historical compatibility", () => {
  it("a pre-M24 Work Unit (no executionMetadata field) parses via StateModelSchema", () => {
    const state = preM24State();
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.workGraph.workUnits[0].executionMetadata).toBeUndefined();
  });

  it("deriveEffectiveExecutionMetadata never materializes a default onto the historical Work Unit", () => {
    const wu = historicalWorkUnit();
    deriveEffectiveExecutionMetadata(wu);
    expect(wu.executionMetadata).toBeUndefined();
  });

  it("buildParallelBatch completes without error over a fully pre-M24 graph, treating every Work Unit as serialized", () => {
    const state = preM24State([
      historicalWorkUnit({ id: "WU001" }),
      historicalWorkUnit({ id: "WU002", milestoneId: "M001" }),
    ]);
    const result = buildParallelBatch(state);
    // Missing metadata never enables parallelism: at most one of the two
    // mutually-unaware historical work units is ever auto-selected
    // together with... actually neither declares any workspace, so the
    // "either lacks workspace metadata" rule from §4.4 makes every pair
    // conflict -- selection is at most a single work unit.
    expect(result.selectedWorkUnitIds.length).toBeLessThanOrEqual(1);
  });

  it("buildExecutionMetadataAdvisory produces a serialized/missing advisory for a historical Work Unit, never throwing", () => {
    const wu = historicalWorkUnit();
    const advisory = buildExecutionMetadataAdvisory(wu, preM24State([wu]));
    expect(advisory.metadataDeclared).toBe(false);
    expect(advisory.parallel.mode).toBe("serialized");
  });

  it("a state with M23 importProvenance-bearing evidence alongside a pre-M24 Work Unit still parses and is unaffected by M24", () => {
    const state: StateModel = {
      ...preM24State(),
      evidence: {
        records: [
          {
            evidenceId: "EVID-001",
            contractVersion: "1.0",
            provider: { providerId: "p", providerType: "agent", trustLevel: "unverified" },
            workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1" },
            codeBinding: { capturedAt: T1 },
            reviewer: { reviewerType: "agent", independentContext: "declared_independent" },
            results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
            sourceFindings: [],
            decisionEscalationIds: [],
            artifactReferences: [],
            recordedAt: T1,
            importProvenance: {
              adapterId: "manual-evidence-json@1",
              sourcePayloadDigest: "sha256:abc",
              importIdentityKey: "sha256:def",
              importedAt: T1,
            },
          },
        ],
        decisionEscalations: [],
      },
    };
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.workGraph.workUnits[0].executionMetadata).toBeUndefined();
    expect(parsed.data.evidence?.records[0].importProvenance?.importIdentityKey).toBe("sha256:def");
    expect(() => buildParallelBatch(parsed.data)).not.toThrow();
  });
});
