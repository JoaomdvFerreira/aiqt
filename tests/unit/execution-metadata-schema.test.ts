import { describe, it, expect } from "vitest";
import {
  ExecutionMetadataSchema,
  WorkspaceAssignmentMetadataSchema,
  ParallelPolicyMetadataSchema,
  validateAssignmentToken,
  ASSIGNMENT_KEY_MAX_CHARS,
  RESOURCE_CLAIMS_PER_WORK_UNIT_MAX,
} from "../../src/schema/execution-metadata.schema.js";
import { WorkUnitSchema } from "../../src/schema/work-unit.schema.js";

const T1 = "2026-01-01T00:00:00.000Z";

function baseWorkUnit(overrides: Record<string, unknown> = {}) {
  return {
    id: "WU001",
    milestoneId: "M001",
    title: "T",
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
    ...overrides,
  };
}

describe("WorkspaceAssignmentMetadataSchema (M24 §4)", () => {
  it("accepts shared with an assignmentKey", () => {
    expect(
      WorkspaceAssignmentMetadataSchema.safeParse({ mode: "shared", assignmentKey: "team-a", access: "read_write" })
        .success,
    ).toBe(true);
  });

  it("accepts isolated with an assignmentKey", () => {
    expect(
      WorkspaceAssignmentMetadataSchema.safeParse({ mode: "isolated", assignmentKey: "wu-42", access: "read_write" })
        .success,
    ).toBe(true);
  });

  it("accepts none with read_only and no assignmentKey", () => {
    expect(WorkspaceAssignmentMetadataSchema.safeParse({ mode: "none", access: "read_only" }).success).toBe(true);
  });

  it("rejects shared/isolated missing assignmentKey", () => {
    expect(WorkspaceAssignmentMetadataSchema.safeParse({ mode: "shared", access: "read_only" }).success).toBe(false);
    expect(WorkspaceAssignmentMetadataSchema.safeParse({ mode: "isolated", access: "read_only" }).success).toBe(
      false,
    );
  });

  it("rejects none with an assignmentKey present", () => {
    expect(
      WorkspaceAssignmentMetadataSchema.safeParse({ mode: "none", assignmentKey: "x", access: "read_only" }).success,
    ).toBe(false);
  });

  it("rejects none with access read_write", () => {
    expect(WorkspaceAssignmentMetadataSchema.safeParse({ mode: "none", access: "read_write" }).success).toBe(false);
  });

  it("rejects an invalid access value", () => {
    expect(
      WorkspaceAssignmentMetadataSchema.safeParse({ mode: "shared", assignmentKey: "x", access: "bogus" }).success,
    ).toBe(false);
  });
});

describe("validateAssignmentToken (M24 §4.3/§5.3)", () => {
  it("accepts a plain token", () => {
    expect(validateAssignmentToken("team-a.svc_1/sub", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(true);
  });

  it("rejects an empty key", () => {
    expect(validateAssignmentToken("", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects an oversized key", () => {
    expect(validateAssignmentToken("a".repeat(ASSIGNMENT_KEY_MAX_CHARS + 1), ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(
      false,
    );
  });

  it("accepts exactly the max length", () => {
    expect(validateAssignmentToken("a".repeat(ASSIGNMENT_KEY_MAX_CHARS), ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(true);
  });

  it("rejects leading or trailing slash", () => {
    expect(validateAssignmentToken("/team-a", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
    expect(validateAssignmentToken("team-a/", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects repeated slash", () => {
    expect(validateAssignmentToken("team//a", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects '.' and '..' segments", () => {
    expect(validateAssignmentToken("team/./a", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
    expect(validateAssignmentToken("team/../a", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects drive-letter form (colon not in whitelist)", () => {
    expect(validateAssignmentToken("C:/workspace", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects UNC form (backslash not in whitelist)", () => {
    expect(validateAssignmentToken("\\\\server\\share", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects URL form (colon/slashes pattern not in whitelist)", () => {
    expect(validateAssignmentToken("https://example.com/x", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects environment-variable syntax", () => {
    expect(validateAssignmentToken("$HOME/team", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
    expect(validateAssignmentToken("${TEAM}", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });

  it("rejects whitespace", () => {
    expect(validateAssignmentToken("team a", ASSIGNMENT_KEY_MAX_CHARS).ok).toBe(false);
  });
});

describe("ParallelPolicyMetadataSchema (M24 §5/§6)", () => {
  it("accepts serialized with no claims", () => {
    expect(ParallelPolicyMetadataSchema.safeParse({ mode: "serialized" }).success).toBe(true);
  });

  it("accepts eligible_if_no_conflict with a valid concurrencyGroup", () => {
    expect(
      ParallelPolicyMetadataSchema.safeParse({ mode: "eligible_if_no_conflict", concurrencyGroup: "group-a" })
        .success,
    ).toBe(true);
  });

  it("accepts manual_review", () => {
    expect(ParallelPolicyMetadataSchema.safeParse({ mode: "manual_review" }).success).toBe(true);
  });

  it("defaults resourceClaims to an empty array when omitted", () => {
    const result = ParallelPolicyMetadataSchema.safeParse({ mode: "serialized" });
    expect(result.success && result.data.resourceClaims).toEqual([]);
  });

  it("rejects an invalid concurrencyGroup using the same token rules", () => {
    expect(
      ParallelPolicyMetadataSchema.safeParse({ mode: "serialized", concurrencyGroup: "bad group" }).success,
    ).toBe(false);
  });

  it("rejects duplicate normalized resource claims", () => {
    const result = ParallelPolicyMetadataSchema.safeParse({
      mode: "eligible_if_no_conflict",
      resourceClaims: [
        { domain: "repository", key: "project", access: "read" },
        { domain: "repository", key: "project", access: "write" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than the max claim count", () => {
    const resourceClaims = Array.from({ length: RESOURCE_CLAIMS_PER_WORK_UNIT_MAX + 1 }, (_, i) => ({
      domain: "custom" as const,
      key: `k${i}`,
      access: "read" as const,
    }));
    expect(ParallelPolicyMetadataSchema.safeParse({ mode: "serialized", resourceClaims }).success).toBe(false);
  });

  it("accepts exactly the max claim count", () => {
    const resourceClaims = Array.from({ length: RESOURCE_CLAIMS_PER_WORK_UNIT_MAX }, (_, i) => ({
      domain: "custom" as const,
      key: `k${i}`,
      access: "read" as const,
    }));
    expect(ParallelPolicyMetadataSchema.safeParse({ mode: "serialized", resourceClaims }).success).toBe(true);
  });
});

describe("ExecutionMetadataSchema cross-field intrinsic validation (M24 §4.3 Critical rule)", () => {
  it("accepts none workspace with only read resource claims", () => {
    const result = ExecutionMetadataSchema.safeParse({
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "repository", key: "project", access: "read" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects none workspace + repository write claim", () => {
    const result = ExecutionMetadataSchema.safeParse({
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "repository", key: "project", access: "write" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects none workspace + repository exclusive claim", () => {
    const result = ExecutionMetadataSchema.safeParse({
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "repository", key: "project", access: "exclusive" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects none workspace + path write claim", () => {
    const result = ExecutionMetadataSchema.safeParse({
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "path", key: "src", access: "write" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects none workspace + path exclusive claim", () => {
    const result = ExecutionMetadataSchema.safeParse({
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "path", key: "src", access: "exclusive" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("allows shared/isolated workspace with a write resource claim (no contradiction)", () => {
    const result = ExecutionMetadataSchema.safeParse({
      workspaceAssignment: { mode: "shared", assignmentKey: "team-a", access: "read_write" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "repository", key: "project", access: "write" }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("does not reject none workspace + a database/environment/custom write claim (only repository/path are intrinsically contradictory)", () => {
    const result = ExecutionMetadataSchema.safeParse({
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "database", key: "primary", access: "write" }],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("WorkUnitSchema additive integration (M24 §2.1)", () => {
  it("parses a historical Work Unit with no executionMetadata field at all", () => {
    const result = WorkUnitSchema.safeParse(baseWorkUnit());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executionMetadata).toBeUndefined();
    }
  });

  it("parses a Work Unit with valid executionMetadata", () => {
    const result = WorkUnitSchema.safeParse(
      baseWorkUnit({
        executionMetadata: {
          workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
          parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a Work Unit whose executionMetadata violates the intrinsic cross-field rule", () => {
    const result = WorkUnitSchema.safeParse(
      baseWorkUnit({
        executionMetadata: {
          workspaceAssignment: { mode: "none", access: "read_only" },
          parallelPolicy: {
            mode: "serialized",
            resourceClaims: [{ domain: "repository", key: "project", access: "exclusive" }],
          },
        },
      }),
    );
    expect(result.success).toBe(false);
  });
});
