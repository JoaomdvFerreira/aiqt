import { describe, it, expect } from "vitest";
import { planPrepareRecovery, planReleaseRecovery } from "../../src/workspaces/workspace-recovery.js";
import type { IsolatedWorkspaceInspection } from "../../src/workspaces/workspace-inspection.js";

function inspection(overrides: Partial<IsolatedWorkspaceInspection> = {}): IsolatedWorkspaceInspection {
  return {
    exists: false,
    registered: false,
    branchMatches: false,
    clean: false,
    hasUnresolvedConflict: false,
    ...overrides,
  };
}

describe("planPrepareRecovery (M25 §15.1)", () => {
  it("finalizes when the physical result exactly matches (exists, registered, correct branch)", () => {
    const action = planPrepareRecovery(inspection({ exists: true, registered: true, branchMatches: true }));
    expect(action.kind).toBe("finalize_workspace_and_binding");
  });

  it("clears the pending operation as not-applied when the physical result is entirely absent", () => {
    const action = planPrepareRecovery(inspection({ exists: false, registered: false }));
    expect(action.kind).toBe("clear_pending_operation_as_not_applied");
  });

  it("blocks for manual recovery when the physical result conflicts (exists but wrong branch)", () => {
    const action = planPrepareRecovery(inspection({ exists: true, registered: true, branchMatches: false }));
    expect(action.kind).toBe("blocked_manual_recovery");
  });

  it("blocks for manual recovery when the path exists but is not a registered worktree", () => {
    const action = planPrepareRecovery(inspection({ exists: true, registered: false }));
    expect(action.kind).toBe("blocked_manual_recovery");
  });
});

describe("planReleaseRecovery (M25 §15.2)", () => {
  it("finalizes the release when the workspace is entirely absent (removed)", () => {
    const action = planReleaseRecovery(inspection({ exists: false, registered: false }));
    expect(action.kind).toBe("finalize_release");
  });

  it("allows a retry-only-with-apply when the workspace is still present, clean, and exactly managed", () => {
    const action = planReleaseRecovery(
      inspection({ exists: true, registered: true, branchMatches: true, clean: true, hasUnresolvedConflict: false }),
    );
    expect(action.kind).toBe("retry_release_only_with_apply");
  });

  it("blocks for manual recovery when the workspace is dirty", () => {
    const action = planReleaseRecovery(
      inspection({ exists: true, registered: true, branchMatches: true, clean: false }),
    );
    expect(action.kind).toBe("blocked_manual_recovery");
  });

  it("blocks for manual recovery when the workspace has drifted (branch mismatch)", () => {
    const action = planReleaseRecovery(
      inspection({ exists: true, registered: true, branchMatches: false, clean: true }),
    );
    expect(action.kind).toBe("blocked_manual_recovery");
  });

  it("blocks for manual recovery when there is an unresolved merge/rebase/cherry-pick conflict", () => {
    const action = planReleaseRecovery(
      inspection({ exists: true, registered: true, branchMatches: true, clean: true, hasUnresolvedConflict: true }),
    );
    expect(action.kind).toBe("blocked_manual_recovery");
  });
});
