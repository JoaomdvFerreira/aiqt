import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  resolveImplementationRoot,
  resolveRoots,
  renderRootContextSection,
} from "../../src/workflow/root-resolution.js";

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
