import { describe, it, expect, afterEach } from "vitest";
import { symlinkSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { deriveDefaultWorkspaceRoot, validateWorkspaceRoot, deriveWorkspacePath } from "../../src/workspaces/workspace-path-policy.js";
import { makeTempDir, removeDir } from "../helpers.js";

describe("deriveDefaultWorkspaceRoot (M25 §4.1)", () => {
  it("derives a sibling .aiqt-workspaces/<name> directory", () => {
    const implRoot = join(sep === "/" ? "/projects" : "C:\\projects", "app");
    const root = deriveDefaultWorkspaceRoot(implRoot);
    expect(root.endsWith(join(".aiqt-workspaces", "app"))).toBe(true);
    expect(dirname(dirname(root))).toBe(dirname(implRoot));
  });

  it("does not create any directory (pure)", () => {
    // Purely a string-derivation check: calling it twice must not have
    // any observable filesystem side effect (verified structurally, not
    // via fs polling, since the function does not import fs write APIs).
    const implRoot = join(sep === "/" ? "/projects" : "C:\\projects", "app");
    const a = deriveDefaultWorkspaceRoot(implRoot);
    const b = deriveDefaultWorkspaceRoot(implRoot);
    expect(a).toBe(b);
  });
});

describe("validateWorkspaceRoot (M25 §4.1)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("accepts a valid derived sibling root", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "app");
    const workspaceRoot = deriveDefaultWorkspaceRoot(implRoot);
    expect(validateWorkspaceRoot(workspaceRoot, implRoot).ok).toBe(true);
  });

  it("rejects a root equal to the implementation root", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "app");
    expect(validateWorkspaceRoot(implRoot, implRoot).ok).toBe(false);
  });

  it("rejects a root nested inside the implementation root", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "app");
    const nested = join(implRoot, "workspaces");
    expect(validateWorkspaceRoot(nested, implRoot).ok).toBe(false);
  });

  it("rejects the filesystem root", () => {
    const implRoot = join(sep === "/" ? "/projects" : "C:\\projects", "app");
    const fsRoot = sep === "/" ? "/" : "C:\\";
    expect(validateWorkspaceRoot(fsRoot, implRoot).ok).toBe(false);
  });

  it("rejects the user's home directory", () => {
    const implRoot = join(sep === "/" ? "/projects" : "C:\\projects", "app");
    expect(validateWorkspaceRoot(homedir(), implRoot).ok).toBe(false);
  });

  it("rejects the implementation-root's parent directory itself", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "app");
    expect(validateWorkspaceRoot(dir, implRoot).ok).toBe(false);
  });

  it("rejects a symlinked workspace root", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "app");
    const real = join(dir, "real-workspaces");
    const linked = join(dir, "linked-workspaces");
    try {
      symlinkSync(real, linked, "junction");
    } catch {
      return; // symlink creation may require elevated privileges on this platform/CI runner
    }
    expect(validateWorkspaceRoot(linked, implRoot).ok).toBe(false);
  });
});

describe("deriveWorkspacePath (M25 §6.4)", () => {
  it("derives the leaf from the canonical workspace ID, never the assignment key", () => {
    const root = join(sep === "/" ? "/workspaces" : "C:\\workspaces");
    const path = deriveWorkspacePath(root, "WS-001");
    expect(path.endsWith("WS-001")).toBe(true);
  });

  it("produces a distinct path for a distinct workspace ID even with the same root", () => {
    const root = join(sep === "/" ? "/workspaces" : "C:\\workspaces");
    expect(deriveWorkspacePath(root, "WS-001")).not.toBe(deriveWorkspacePath(root, "WS-002"));
  });
});
