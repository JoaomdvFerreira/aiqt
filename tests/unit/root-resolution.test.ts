import { describe, it, expect, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import {
  resolveImplementationRoot,
  resolveRoots,
  renderRootContextSection,
  diagnoseImplementationRoot,
} from "../../src/workflow/root-resolution.js";
import { makeTempDir, removeDir } from "../helpers.js";

describe("resolveImplementationRoot", () => {
  it("resolves to the control root when existingRepositoryPath is unset", () => {
    expect(resolveImplementationRoot("/home/user/project", null)).toBe(resolve("/home/user/project"));
    expect(resolveImplementationRoot("/home/user/project", undefined)).toBe(resolve("/home/user/project"));
  });

  it("resolves a relative existingRepositoryPath relative to the control root", () => {
    expect(resolveImplementationRoot("/home/user/control", "../app")).toBe(
      resolve("/home/user/control", "../app"),
    );
  });

  it("resolves an absolute existingRepositoryPath as-is", () => {
    expect(resolveImplementationRoot("/home/user/control", "/home/user/app")).toBe(
      resolve("/home/user/app"),
    );
  });
});

describe("resolveRoots", () => {
  it("marks sameRoot true when existingRepositoryPath is unset (default same-root initialization)", () => {
    const roots = resolveRoots({ controlRoot: "/home/user/project" });
    expect(roots.controlRoot).toBe(resolve("/home/user/project"));
    expect(roots.implementationRoot).toBe(roots.controlRoot);
    expect(roots.existingRepositoryPath).toBeNull();
    expect(roots.sameRoot).toBe(true);
  });

  it("marks sameRoot false for an explicit split-root project", () => {
    const roots = resolveRoots({
      controlRoot: "/home/user/control",
      existingRepositoryPath: "/home/user/app",
    });
    expect(roots.sameRoot).toBe(false);
    expect(roots.implementationRoot).toBe(resolve("/home/user/app"));
    expect(roots.existingRepositoryPath).toBe("/home/user/app");
  });

  it("treats an existingRepositoryPath that resolves to the control root as same-root", () => {
    const roots = resolveRoots({
      controlRoot: "/home/user/project",
      existingRepositoryPath: "/home/user/project",
    });
    expect(roots.sameRoot).toBe(true);
  });
});

describe("renderRootContextSection", () => {
  it("names both roots and the run-from-each instruction, per M16 §13.1", () => {
    const roots = resolveRoots({
      controlRoot: "/home/user/control",
      existingRepositoryPath: "/home/user/app",
    });
    const text = renderRootContextSection(roots);
    expect(text).toContain("AIQT control root:");
    expect(text).toContain(roots.controlRoot);
    expect(text).toContain("Implementation root:");
    expect(text).toContain(roots.implementationRoot);
    expect(text).toContain("Run AIQT commands from the control root.");
    expect(text).toContain(
      "Run application, Git, validation, and Playwright/browser commands from the implementation root.",
    );
  });

  it("is deterministic across repeated calls with the same input", () => {
    const roots = resolveRoots({ controlRoot: "/home/user/project" });
    expect(renderRootContextSection(roots)).toBe(renderRootContextSection(roots));
  });
});

// M21-WU08 §5.8/§10.4: warning-first control/implementation-root
// diagnostics. Every case here uses real temp directories -- these
// diagnostics are read-only filesystem stat calls, never a spawned
// process, so exercising them for real is cheap and meaningful.
describe("diagnoseImplementationRoot", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("trusts the control root unconditionally when sameRoot is true, without a filesystem check", () => {
    // A path that does not exist on disk still reports as trusted/exists
    // when sameRoot is true, because the caller has already loaded .aiqt
    // from it -- this must never re-derive trust from a stat call.
    const diagnostics = diagnoseImplementationRoot("/does/not/exist/on/disk", true);
    expect(diagnostics).toEqual({
      exists: true,
      isDirectory: true,
      isGitRepository: false,
      resolvesThroughSymlink: false,
      trust: "control_root",
      warning: null,
    });
  });

  it("detects a .git directory at the control root", () => {
    dir = makeTempDir();
    mkdirSync(join(dir, ".git"));
    const diagnostics = diagnoseImplementationRoot(dir, true);
    expect(diagnostics.isGitRepository).toBe(true);
  });

  it("classifies a valid external absolute root as external_verified with no warning", () => {
    dir = makeTempDir();
    const diagnostics = diagnoseImplementationRoot(dir, false);
    expect(diagnostics).toMatchObject({
      exists: true,
      isDirectory: true,
      trust: "external_verified",
      warning: null,
    });
  });

  it("detects a .git directory at a valid external root (worktree-style .git file also counts)", () => {
    dir = makeTempDir();
    writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
    const diagnostics = diagnoseImplementationRoot(dir, false);
    expect(diagnostics.isGitRepository).toBe(true);
  });

  it("reports external_missing with a non-blocking warning for a missing external root", () => {
    dir = makeTempDir();
    const missing = join(dir, "does-not-exist");
    const diagnostics = diagnoseImplementationRoot(missing, false);
    expect(diagnostics.exists).toBe(false);
    expect(diagnostics.trust).toBe("external_missing");
    expect(diagnostics.warning).toContain(missing);
  });

  it("reports external_not_directory for a path that exists but is a file", () => {
    dir = makeTempDir();
    const filePath = join(dir, "not-a-dir");
    writeFileSync(filePath, "x");
    const diagnostics = diagnoseImplementationRoot(filePath, false);
    expect(diagnostics.exists).toBe(true);
    expect(diagnostics.isDirectory).toBe(false);
    expect(diagnostics.trust).toBe("external_not_directory");
    expect(diagnostics.warning).not.toBeNull();
  });

  it("detects a symlinked external root without following it for execution", () => {
    dir = makeTempDir();
    const real = join(dir, "real");
    const link = join(dir, "link");
    mkdirSync(real);
    try {
      symlinkSync(real, link, "junction");
    } catch {
      // Symlink creation can require elevated privileges on some Windows
      // configurations -- skip gracefully rather than fail the suite for
      // an environment limitation unrelated to the diagnostic logic.
      return;
    }
    const diagnostics = diagnoseImplementationRoot(link, false);
    expect(diagnostics.resolvesThroughSymlink).toBe(true);
    expect(diagnostics.trust).toBe("external_verified");
  });

  it("handles paths with spaces and Unicode characters", () => {
    dir = makeTempDir();
    const nested = join(dir, "sub dir with spaces éü中文");
    mkdirSync(nested);
    const diagnostics = diagnoseImplementationRoot(nested, false);
    expect(diagnostics).toMatchObject({ exists: true, isDirectory: true, trust: "external_verified" });
  });

  it("resolveRoots wires diagnostics through additively without changing existing fields", () => {
    dir = makeTempDir();
    const roots = resolveRoots({ controlRoot: dir });
    expect(roots.diagnostics.trust).toBe("control_root");
    expect(roots.sameRoot).toBe(true);
    expect(roots.controlRoot).toBe(resolve(dir));
  });

  it("resolveRoots reports a real external missing root through the full pipeline", () => {
    dir = makeTempDir();
    const roots = resolveRoots({
      controlRoot: dir,
      existingRepositoryPath: "definitely-not-there",
    });
    expect(roots.diagnostics.trust).toBe("external_missing");
    expect(roots.diagnostics.warning).not.toBeNull();
  });
});
