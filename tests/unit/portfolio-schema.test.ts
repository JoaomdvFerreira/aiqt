import { describe, it, expect } from "vitest";
import { PortfolioManifestSchema, PortfolioMemberSchema, PORTFOLIO_SCHEMA_VERSION } from "../../src/schema/portfolio.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";

function buildManifest(overrides: Partial<Parameters<typeof PortfolioManifestSchema.parse>[0]> = {}) {
  return PortfolioManifestSchema.parse({
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    id: "acme",
    name: "Acme Portfolio",
    members: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe("PortfolioMemberSchema (M46-WU01)", () => {
  it("accepts a minimal member", () => {
    const result = PortfolioMemberSchema.safeParse({ id: "M-001", root: "/repos/foo", addedAt: NOW });
    expect(result.success).toBe(true);
  });

  it("accepts an optional alias", () => {
    const result = PortfolioMemberSchema.safeParse({ id: "M-001", root: "/repos/foo", alias: "foo", addedAt: NOW });
    expect(result.success).toBe(true);
  });

  it("rejects an empty id or root", () => {
    expect(PortfolioMemberSchema.safeParse({ id: "", root: "/repos/foo", addedAt: NOW }).success).toBe(false);
    expect(PortfolioMemberSchema.safeParse({ id: "M-001", root: "", addedAt: NOW }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    const result = PortfolioMemberSchema.safeParse({ id: "M-001", root: "/repos/foo", addedAt: NOW, extra: true });
    expect(result.success).toBe(false);
  });
});

describe("PortfolioManifestSchema (M46-WU01, build spec Sec 3)", () => {
  it("accepts a manifest with no members", () => {
    expect(() => buildManifest()).not.toThrow();
  });

  it("accepts a manifest with members", () => {
    const manifest = buildManifest({ members: [{ id: "M-001", root: "/repos/foo", addedAt: NOW }] });
    expect(manifest.members).toHaveLength(1);
  });

  it("rejects unknown top-level fields (strict, no unknown-field carry-forward)", () => {
    const result = PortfolioManifestSchema.safeParse({
      schemaVersion: PORTFOLIO_SCHEMA_VERSION,
      id: "acme",
      name: "Acme",
      members: [],
      createdAt: NOW,
      updatedAt: NOW,
      extra: "nope",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing name or id", () => {
    expect(() => buildManifest({ id: "" })).toThrow();
    expect(() => buildManifest({ name: "" })).toThrow();
  });
});
