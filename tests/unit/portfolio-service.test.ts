import { describe, it, expect } from "vitest";
import {
  canonicalizeRepositoryRoot,
  isSameRoot,
  generatePortfolioId,
  generateMemberId,
  createPortfolioManifest,
  addPortfolioMember,
  removePortfolioMember,
} from "../../src/services/portfolio-service.js";
import { MAX_PORTFOLIO_MEMBERS } from "../../src/schema/portfolio.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";

describe("canonicalizeRepositoryRoot / isSameRoot (M46-WU01, build spec Sec 3/8 dogfood 15)", () => {
  it("resolves a relative root to an absolute path", () => {
    expect(canonicalizeRepositoryRoot(".")).toBe(canonicalizeRepositoryRoot(process.cwd()));
  });

  it("treats differently-cased roots as the same repository on win32/darwin only", () => {
    const a = "C:\\repos\\Foo";
    const b = "C:\\repos\\foo";
    if (process.platform === "win32" || process.platform === "darwin") {
      expect(isSameRoot(a, b)).toBe(true);
    } else {
      expect(isSameRoot(a, b)).toBe(false);
    }
  });
});

describe("generatePortfolioId (M46-WU01)", () => {
  it("slugifies the portfolio name", () => {
    expect(generatePortfolioId("Acme Corp", [])).toBe("acme-corp");
  });

  it("disambiguates deterministically against existing ids", () => {
    expect(generatePortfolioId("Acme", ["acme"])).toBe("acme-2");
    expect(generatePortfolioId("Acme", ["acme", "acme-2"])).toBe("acme-3");
  });

  it("falls back to a stable default for a name with no slug characters", () => {
    expect(generatePortfolioId("!!!", [])).toBe("portfolio");
  });
});

describe("generateMemberId (M46-WU01)", () => {
  it("produces sequential member ids", () => {
    expect(generateMemberId([])).toBe("M-001");
    expect(generateMemberId(["M-001"])).toBe("M-002");
  });
});

describe("createPortfolioManifest (M46-WU01)", () => {
  it("creates an empty manifest with a stable id", () => {
    const outcome = createPortfolioManifest({ name: "Acme", existingIds: [], now: NOW });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.manifest.id).toBe("acme");
      expect(outcome.manifest.members).toEqual([]);
      expect(outcome.manifest.createdAt).toBe(NOW);
    }
  });
});

describe("addPortfolioMember (M46-WU01, build spec Sec 4 add, duplicate prevention)", () => {
  it("adds a member with a canonicalized root and stable id", () => {
    const base = createPortfolioManifest({ name: "Acme", existingIds: [], now: NOW });
    if (!base.ok) throw new Error("setup failed");
    const outcome = addPortfolioMember(base.manifest, { root: ".", now: NOW });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.member.id).toBe("M-001");
      expect(outcome.member.root).toBe(canonicalizeRepositoryRoot("."));
      expect(outcome.manifest.members).toHaveLength(1);
    }
  });

  it("rejects a duplicate root", () => {
    const base = createPortfolioManifest({ name: "Acme", existingIds: [], now: NOW });
    if (!base.ok) throw new Error("setup failed");
    const first = addPortfolioMember(base.manifest, { root: ".", now: NOW });
    if (!first.ok) throw new Error("setup failed");
    const second = addPortfolioMember(first.manifest, { root: ".", now: NOW });
    expect(second.ok).toBe(false);
  });

  it("enforces the member cap", () => {
    const manifest = createPortfolioManifest({ name: "Acme", existingIds: [], now: NOW });
    if (!manifest.ok) throw new Error("setup failed");
    let m = manifest.manifest;
    for (let i = 0; i < MAX_PORTFOLIO_MEMBERS; i++) {
      const outcome = addPortfolioMember(m, { root: `/repos/r${i}`, now: NOW });
      if (!outcome.ok) throw new Error(`unexpected failure at ${i}: ${outcome.reason}`);
      m = outcome.manifest;
    }
    const overflow = addPortfolioMember(m, { root: "/repos/overflow", now: NOW });
    expect(overflow.ok).toBe(false);
  });
});

describe("removePortfolioMember (M46-WU01, build spec Sec 4 remove)", () => {
  it("removes an existing member without touching others", () => {
    const manifest = createPortfolioManifest({ name: "Acme", existingIds: [], now: NOW });
    if (!manifest.ok) throw new Error("setup failed");
    let m = manifest.manifest;
    const add1 = addPortfolioMember(m, { root: "/repos/one", now: NOW });
    if (!add1.ok) throw new Error("setup failed");
    m = add1.manifest;
    const add2 = addPortfolioMember(m, { root: "/repos/two", now: NOW });
    if (!add2.ok) throw new Error("setup failed");
    m = add2.manifest;

    const outcome = removePortfolioMember(m, add1.member.id, NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.manifest.members.map((x) => x.id)).toEqual([add2.member.id]);
    }
  });

  it("fails deterministically for a nonexistent member", () => {
    const manifest = createPortfolioManifest({ name: "Acme", existingIds: [], now: NOW });
    if (!manifest.ok) throw new Error("setup failed");
    const outcome = removePortfolioMember(manifest.manifest, "M-999", NOW);
    expect(outcome.ok).toBe(false);
  });
});
