import { describe, it, expect } from "vitest";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";
import { getExecutionSessions } from "../../src/services/execution-session-service.js";
import { AIQT_SCHEMA_VERSION } from "../../src/core/constants/schema-version.js";

const T1 = "2026-01-01T00:00:00.000Z";

describe("M26 historical compatibility", () => {
  it("schema_version remains 0.5.0", () => {
    expect(AIQT_SCHEMA_VERSION).toBe("0.5.0");
  });

  it("a pre-M26 state (no executionSessions field) parses via StateModelSchema", () => {
    const state = buildInitialStateModel(T1);
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.executionSessions).toBeUndefined();
  });

  it("buildInitialStateModel never materializes executionSessions", () => {
    const state = buildInitialStateModel(T1);
    expect(state.executionSessions).toBeUndefined();
  });

  it("getExecutionSessions never materializes a default onto the state object", () => {
    const state = buildInitialStateModel(T1);
    getExecutionSessions(state);
    expect(state.executionSessions).toBeUndefined();
  });

  it("a state carrying M25 workspace fields but no executionSessions still parses and is unaffected by M26", () => {
    const state: StateModel = {
      ...buildInitialStateModel(T1),
      workspace: {
        managedWorkspaces: [],
        workspaceBindings: [],
        pendingWorkspaceOperations: [],
      },
    };
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.executionSessions).toBeUndefined();
    expect(parsed.data.workspace?.managedWorkspaces).toEqual([]);
  });
});
