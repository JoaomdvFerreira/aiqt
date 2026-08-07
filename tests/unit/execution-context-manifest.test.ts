import { describe, it, expect } from "vitest";
import { buildContextManifest, deriveContextProfile, isPathWithinApprovedRoots } from "../../src/workflow/execution-context-manifest.js";

describe("execution-context-manifest (M39-WU02)", () => {
  it("is deterministic for identical input", () => {
    const input = {
      workUnitId: "WU-1",
      complexity: "standard" as const,
      suggestedFiles: ["src/a.ts", "src/b.ts"],
    };
    expect(buildContextManifest(input)).toEqual(buildContextManifest(input));
  });

  it("derives context profile from complexity (mechanical/simple->minimal, standard->focused, complex/architectural->expanded)", () => {
    expect(deriveContextProfile("mechanical")).toBe("minimal");
    expect(deriveContextProfile("simple")).toBe("minimal");
    expect(deriveContextProfile("standard")).toBe("focused");
    expect(deriveContextProfile("complex")).toBe("expanded");
    expect(deriveContextProfile("architectural")).toBe("expanded");
  });

  it("always includes the current Work Unit's own contract as must_read, never dropped", () => {
    const manifest = buildContextManifest({ workUnitId: "WU-2", complexity: "mechanical", hardLimitTokens: 1 });
    const ownContract = manifest.items.find((i) => i.path === "work-unit:WU-2");
    expect(ownContract).toBeDefined();
    expect(ownContract?.priority).toBe("must_read");
  });

  it("prefers exact suggestedFiles paths as should_read", () => {
    const manifest = buildContextManifest({ workUnitId: "WU-3", complexity: "standard", suggestedFiles: ["src/x.ts"] });
    const item = manifest.items.find((i) => i.path === "src/x.ts");
    expect(item?.priority).toBe("should_read");
  });

  it("demotes/omits should_read and reference_only items before ever touching must_read when the soft target is exceeded", () => {
    const manifest = buildContextManifest({
      workUnitId: "WU-4",
      complexity: "mechanical", // minimal profile -> smallest target
      explicitAgentContextRefs: ["MUST/keep.md"],
      suggestedFiles: Array.from({ length: 50 }, (_, i) => `src/file-${i}.ts`),
      targetEstimatedTokensOverride: 500,
    });
    expect(manifest.items.some((i) => i.path === "work-unit:WU-4")).toBe(true);
    expect(manifest.items.some((i) => i.path === "MUST/keep.md")).toBe(true);
    expect(manifest.items.length).toBeLessThan(52);
    expect(manifest.warnings.some((w) => w.includes("omitted"))).toBe(true);
  });

  it("must-read overflow against a configured hard limit is recorded, never silently truncated", () => {
    const manifest = buildContextManifest({
      workUnitId: "WU-5",
      complexity: "standard",
      explicitAgentContextRefs: ["a.md", "b.md", "c.md"],
      hardLimitTokens: 1,
    });
    expect(manifest.warnings.some((w) => w.startsWith("MUST_READ_OVERFLOW"))).toBe(true);
    expect(manifest.items.some((i) => i.path === "a.md")).toBe(true);
    expect(manifest.items.some((i) => i.path === "b.md")).toBe(true);
    expect(manifest.items.some((i) => i.path === "c.md")).toBe(true);
  });

  it("rejects absolute paths and traversal segments as unsafe (path-safety), keeping the WU's own synthetic ref intact", () => {
    const manifest = buildContextManifest({
      workUnitId: "WU-6",
      complexity: "standard",
      suggestedFiles: ["/etc/passwd", "../../outside.ts", "C:\\secrets\\file.txt", "src/ok.ts"],
    });
    expect(manifest.items.some((i) => i.path === "/etc/passwd")).toBe(false);
    expect(manifest.items.some((i) => i.path === "../../outside.ts")).toBe(false);
    expect(manifest.items.some((i) => i.path === "C:\\secrets\\file.txt")).toBe(false);
    expect(manifest.items.some((i) => i.path === "src/ok.ts")).toBe(true);
    expect(manifest.warnings.filter((w) => w.includes("Excluded out-of-root")).length).toBe(3);
  });

  it("isPathWithinApprovedRoots is a pure predicate matching the manifest's own filter", () => {
    expect(isPathWithinApprovedRoots("src/a.ts")).toBe(true);
    expect(isPathWithinApprovedRoots("/abs/path")).toBe(false);
    expect(isPathWithinApprovedRoots("a/../b")).toBe(false);
  });

  it("never embeds source file contents by default (items carry only path/priority/reason)", () => {
    const manifest = buildContextManifest({ workUnitId: "WU-7", complexity: "standard", suggestedFiles: ["src/a.ts"] });
    for (const item of manifest.items) {
      expect(Object.keys(item).sort()).toEqual(["path", "priority", "reason"]);
    }
  });
});
