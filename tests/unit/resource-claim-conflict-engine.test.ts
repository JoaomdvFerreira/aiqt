import { describe, it, expect } from "vitest";
import {
  validatePathClaimKey,
  validateTextClaimKey,
  validateRepositoryClaimKey,
  validateResourceClaimKey,
  resourceClaimIdentity,
  ResourceClaimSchema,
} from "../../src/schema/execution-metadata.schema.js";
import {
  accessConflicts,
  pathsOverlap,
  resourceClaimsConflict,
  anyResourceClaimsConflict,
} from "../../src/workflow/resource-claim.js";
import type { ResourceClaim } from "../../src/schema/execution-metadata.schema.js";

function claim(overrides: Partial<ResourceClaim> = {}): ResourceClaim {
  return { domain: "custom", key: "k", access: "read", ...overrides };
}

describe("validateRepositoryClaimKey (M24 §6.3)", () => {
  it("accepts exactly 'project'", () => {
    expect(validateRepositoryClaimKey("project").ok).toBe(true);
  });
  it("rejects anything else", () => {
    expect(validateRepositoryClaimKey("other").ok).toBe(false);
    expect(validateRepositoryClaimKey("").ok).toBe(false);
  });
});

describe("validatePathClaimKey (M24 §6.4)", () => {
  it("accepts a simple repository-relative path", () => {
    const result = validatePathClaimKey("src/index.ts");
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe("src/index.ts");
  });

  it("strips exactly one trailing slash", () => {
    expect(validatePathClaimKey("src/").normalized).toBe("src");
  });

  it("rejects backslashes in the original input, never silently converting", () => {
    expect(validatePathClaimKey("src\\index.ts").ok).toBe(false);
  });

  it("rejects an absolute path", () => {
    expect(validatePathClaimKey("/etc/passwd").ok).toBe(false);
  });

  it("rejects a drive-letter path", () => {
    expect(validatePathClaimKey("C:/workspace").ok).toBe(false);
  });

  it("rejects a UNC-style path", () => {
    expect(validatePathClaimKey("\\\\server\\share").ok).toBe(false);
  });

  it("rejects a URL", () => {
    expect(validatePathClaimKey("https://example.com/x").ok).toBe(false);
  });

  it("rejects an empty path", () => {
    expect(validatePathClaimKey("").ok).toBe(false);
  });

  it("rejects '.' and '..' segments", () => {
    expect(validatePathClaimKey("./src").ok).toBe(false);
    expect(validatePathClaimKey("../src").ok).toBe(false);
    expect(validatePathClaimKey("src/../x").ok).toBe(false);
  });

  it("preserves case", () => {
    expect(validatePathClaimKey("Src/File.ts").normalized).toBe("Src/File.ts");
  });
});

describe("validateTextClaimKey (M24 §6.5)", () => {
  it("trims and NFC-normalizes", () => {
    const result = validateTextClaimKey("  primary-db  ");
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe("primary-db");
  });

  it("rejects an empty (post-trim) key", () => {
    expect(validateTextClaimKey("   ").ok).toBe(false);
  });

  it("rejects an oversized key", () => {
    expect(validateTextClaimKey("a".repeat(257)).ok).toBe(false);
  });

  it("accepts exactly 256 characters", () => {
    expect(validateTextClaimKey("a".repeat(256)).ok).toBe(true);
  });

  it("rejects control characters", () => {
    expect(validateTextClaimKey("abc\u0001def").ok).toBe(false);
  });

  it("rejects line breaks", () => {
    expect(validateTextClaimKey("abc\ndef").ok).toBe(false);
    expect(validateTextClaimKey("abc\rdef").ok).toBe(false);
  });

  it("is exact case-sensitive comparison after normalization", () => {
    expect(validateTextClaimKey("Primary").normalized).toBe("Primary");
    expect(validateTextClaimKey("primary").normalized).toBe("primary");
  });
});

describe("validateResourceClaimKey dispatch + ResourceClaimSchema integration", () => {
  it("dispatches to the correct domain validator", () => {
    expect(validateResourceClaimKey("repository", "project").ok).toBe(true);
    expect(validateResourceClaimKey("path", "src").ok).toBe(true);
    expect(validateResourceClaimKey("database", "primary").ok).toBe(true);
  });

  it("rejects an invalid repository key at the schema layer", () => {
    expect(ResourceClaimSchema.safeParse({ domain: "repository", key: "not-project", access: "read" }).success).toBe(
      false,
    );
  });

  it("rejects an invalid path key at the schema layer", () => {
    expect(ResourceClaimSchema.safeParse({ domain: "path", key: "/abs", access: "read" }).success).toBe(false);
  });

  it("rejects an invalid text-domain key at the schema layer", () => {
    expect(ResourceClaimSchema.safeParse({ domain: "custom", key: "bad\nkey", access: "read" }).success).toBe(false);
  });
});

describe("resourceClaimIdentity normalization", () => {
  it("normalizes path trailing slash for identity purposes", () => {
    expect(resourceClaimIdentity(claim({ domain: "path", key: "src/" }))).toBe(
      resourceClaimIdentity(claim({ domain: "path", key: "src" })),
    );
  });

  it("differs across domains even with the same key text", () => {
    expect(resourceClaimIdentity(claim({ domain: "custom", key: "x" }))).not.toBe(
      resourceClaimIdentity(claim({ domain: "database", key: "x" })),
    );
  });
});

describe("accessConflicts (M24 §6.6 standard access matrix)", () => {
  it("read/read is compatible", () => {
    expect(accessConflicts("read", "read")).toBe(false);
  });
  it("read/write conflicts", () => {
    expect(accessConflicts("read", "write")).toBe(true);
    expect(accessConflicts("write", "read")).toBe(true);
  });
  it("write/write conflicts", () => {
    expect(accessConflicts("write", "write")).toBe(true);
  });
  it("exclusive conflicts with everything", () => {
    expect(accessConflicts("exclusive", "read")).toBe(true);
    expect(accessConflicts("read", "exclusive")).toBe(true);
    expect(accessConflicts("exclusive", "exclusive")).toBe(true);
  });
});

describe("pathsOverlap (M24 §6.4 examples)", () => {
  it("src overlaps src/file.ts", () => {
    expect(pathsOverlap("src", "src/file.ts")).toBe(true);
  });
  it("src/a does not overlap src-ab", () => {
    expect(pathsOverlap("src/a", "src-ab")).toBe(false);
  });
  it("src/A does not overlap src/a (case-sensitive)", () => {
    expect(pathsOverlap("src/A", "src/a")).toBe(false);
  });
  it("identical paths overlap", () => {
    expect(pathsOverlap("src/a", "src/a")).toBe(true);
  });
  it("unrelated top-level paths do not overlap", () => {
    expect(pathsOverlap("src", "tests")).toBe(false);
  });
});

describe("resourceClaimsConflict (M24 §6 full matrix)", () => {
  it("different domains never conflict, even with identical keys and write/write access", () => {
    expect(
      resourceClaimsConflict(
        claim({ domain: "database", key: "x", access: "write" }),
        claim({ domain: "environment", key: "x", access: "write" }),
      ),
    ).toBe(false);
  });

  it("repository domain: read/read compatible, write conflicts", () => {
    const a = claim({ domain: "repository", key: "project", access: "read" });
    const b = claim({ domain: "repository", key: "project", access: "read" });
    expect(resourceClaimsConflict(a, b)).toBe(false);
    expect(resourceClaimsConflict(a, { ...b, access: "write" })).toBe(true);
    expect(resourceClaimsConflict(a, { ...b, access: "exclusive" })).toBe(true);
  });

  it("path domain: overlapping read/read is compatible", () => {
    expect(
      resourceClaimsConflict(
        claim({ domain: "path", key: "src", access: "read" }),
        claim({ domain: "path", key: "src/file.ts", access: "read" }),
      ),
    ).toBe(false);
  });

  it("path domain: overlapping write conflicts (ancestor/descendant)", () => {
    expect(
      resourceClaimsConflict(
        claim({ domain: "path", key: "src", access: "write" }),
        claim({ domain: "path", key: "src/file.ts", access: "read" }),
      ),
    ).toBe(true);
  });

  it("path domain: overlapping exclusive conflicts", () => {
    expect(
      resourceClaimsConflict(
        claim({ domain: "path", key: "src", access: "exclusive" }),
        claim({ domain: "path", key: "src/file.ts", access: "read" }),
      ),
    ).toBe(true);
  });

  it("path domain: non-overlapping paths never conflict regardless of access", () => {
    expect(
      resourceClaimsConflict(
        claim({ domain: "path", key: "src", access: "exclusive" }),
        claim({ domain: "path", key: "tests", access: "exclusive" }),
      ),
    ).toBe(false);
  });

  it("path domain: segment-boundary case (src/a vs src-ab) never conflicts", () => {
    expect(
      resourceClaimsConflict(
        claim({ domain: "path", key: "src/a", access: "write" }),
        claim({ domain: "path", key: "src-ab", access: "write" }),
      ),
    ).toBe(false);
  });

  it("database/environment/external_system/custom domains: exact key match with access matrix", () => {
    expect(
      resourceClaimsConflict(
        claim({ domain: "database", key: "primary", access: "read" }),
        claim({ domain: "database", key: "primary", access: "read" }),
      ),
    ).toBe(false);
    expect(
      resourceClaimsConflict(
        claim({ domain: "database", key: "primary", access: "write" }),
        claim({ domain: "database", key: "primary", access: "read" }),
      ),
    ).toBe(true);
    expect(
      resourceClaimsConflict(
        claim({ domain: "database", key: "primary", access: "write" }),
        claim({ domain: "database", key: "other", access: "write" }),
      ),
    ).toBe(false);
  });
});

describe("anyResourceClaimsConflict", () => {
  it("is false when both claim lists are empty", () => {
    expect(anyResourceClaimsConflict([], [])).toBe(false);
  });

  it("is true when any pair across the two lists conflicts", () => {
    const left = [claim({ domain: "path", key: "src", access: "write" })];
    const right = [
      claim({ domain: "database", key: "x", access: "write" }),
      claim({ domain: "path", key: "src/file.ts", access: "read" }),
    ];
    expect(anyResourceClaimsConflict(left, right)).toBe(true);
  });

  it("is false when no pair conflicts", () => {
    const left = [claim({ domain: "path", key: "src", access: "read" })];
    const right = [claim({ domain: "path", key: "src/file.ts", access: "read" })];
    expect(anyResourceClaimsConflict(left, right)).toBe(false);
  });
});
