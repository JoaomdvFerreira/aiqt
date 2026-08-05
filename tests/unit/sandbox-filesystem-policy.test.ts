import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSandboxFilesystemPolicy } from "../../src/workflow/sandbox-filesystem-policy.js";
import type { SandboxFilesystemPolicy } from "../../src/schema/sandbox-backend.schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function policy(overrides: Partial<SandboxFilesystemPolicy> = {}): SandboxFilesystemPolicy {
  return {
    worktreeMount: { hostPath: "/tmp/aiqt-worktree", sandboxPath: "/workspace", mode: "read_write" },
    readOnlyMounts: [{ hostPath: "/usr/lib/node_modules", sandboxPath: "/usr/lib/node_modules", mode: "read_only" }],
    isolatedOutputDirectory: "/tmp/aiqt-output",
    ...overrides,
  };
}

describe("M38-WU01 sandbox-filesystem-policy: invalid policy rejection", () => {
  it("accepts a well-formed policy", () => {
    const result = validateSandboxFilesystemPolicy(policy());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects a worktreeMount whose mode is read_only (the worktree must always be writable)", () => {
    const result = validateSandboxFilesystemPolicy(policy({ worktreeMount: { hostPath: "/tmp/aiqt-worktree", sandboxPath: "/workspace", mode: "read_only" } }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("worktreeMount"))).toBe(true);
  });

  it("rejects a readOnlyMounts entry whose mode is read_write (only the worktree may ever be writable)", () => {
    const result = validateSandboxFilesystemPolicy(policy({ readOnlyMounts: [{ hostPath: "/usr/lib", sandboxPath: "/usr/lib", mode: "read_write" }] }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("readOnlyMounts[0]"))).toBe(true);
  });

  it("rejects a mount whose host path is the operator's home directory (no host home)", () => {
    const result = validateSandboxFilesystemPolicy(policy({ worktreeMount: { hostPath: homedir(), sandboxPath: "/workspace", mode: "read_write" } }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes("home directory"))).toBe(true);
  });

  it("rejects a mount whose host path is the AIQT product's own repository (no self-management)", () => {
    const result = validateSandboxFilesystemPolicy(policy({ worktreeMount: { hostPath: repoRoot, sandboxPath: "/workspace", mode: "read_write" } }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes("self-management"))).toBe(true);
  });

  it("rejects a readOnlyMounts entry that duplicates the worktree mount's own host path", () => {
    const result = validateSandboxFilesystemPolicy(
      policy({ readOnlyMounts: [{ hostPath: "/tmp/aiqt-worktree", sandboxPath: "/dup", mode: "read_only" }] }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.includes("duplicates"))).toBe(true);
  });

  it("rejects an empty isolatedOutputDirectory", () => {
    const result = validateSandboxFilesystemPolicy(policy({ isolatedOutputDirectory: "" }));
    expect(result.ok).toBe(false);
  });

  it("rejects an isolatedOutputDirectory that resolves to the operator's home directory", () => {
    const result = validateSandboxFilesystemPolicy(policy({ isolatedOutputDirectory: homedir() }));
    expect(result.ok).toBe(false);
  });
});
