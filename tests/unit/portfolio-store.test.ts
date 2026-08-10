import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writePortfolioManifest,
  readPortfolioManifest,
  listPortfolioIds,
  listPortfolioManifests,
} from "../../src/state/portfolio-store.js";
import { PORTFOLIO_SCHEMA_VERSION, type PortfolioManifest } from "../../src/schema/portfolio.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";

const dirs: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "aiqt-portfolio-store-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function buildManifest(overrides: Partial<PortfolioManifest> = {}): PortfolioManifest {
  return {
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    id: "acme",
    name: "Acme",
    members: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("writePortfolioManifest / readPortfolioManifest (M46-WU01, build spec Sec 3)", () => {
  it("writes and reads back an identical manifest, creating the home dir on demand", () => {
    const home = join(tempHome(), "nested", "portfolios");
    const manifest = buildManifest();
    writePortfolioManifest(home, manifest);

    const result = readPortfolioManifest(home, "acme");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toEqual(manifest);
  });

  it("reports a deterministic failure for a portfolio that does not exist", () => {
    const home = tempHome();
    const result = readPortfolioManifest(home, "missing");
    expect(result.ok).toBe(false);
  });

  it("fails safely on a malformed manifest file (dogfood scenario 17)", () => {
    const home = tempHome();
    writeFileSync(join(home, "broken.json"), "{ not valid json", "utf8");
    const result = readPortfolioManifest(home, "broken");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("broken");
  });

  it("rejects a manifest with an unsupported schema major version", () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "future.json"), JSON.stringify({ ...buildManifest({ id: "future" }), schemaVersion: "99.0.0" }), "utf8");
    const result = readPortfolioManifest(home, "future");
    expect(result.ok).toBe(false);
  });

  it("persists across separate read calls (process-restart survival)", () => {
    const home = tempHome();
    writePortfolioManifest(home, buildManifest());
    const first = readPortfolioManifest(home, "acme");
    const second = readPortfolioManifest(home, "acme");
    expect(first).toEqual(second);
  });
});

describe("listPortfolioIds / listPortfolioManifests (M46-WU01)", () => {
  it("returns an empty list for a nonexistent home directory", () => {
    const home = join(tempHome(), "does-not-exist");
    expect(listPortfolioIds(home)).toEqual([]);
    expect(listPortfolioManifests(home)).toEqual([]);
  });

  it("lists portfolio ids in deterministic sorted order", () => {
    const home = tempHome();
    writePortfolioManifest(home, buildManifest({ id: "zeta", name: "Zeta" }));
    writePortfolioManifest(home, buildManifest({ id: "alpha", name: "Alpha" }));
    expect(listPortfolioIds(home)).toEqual(["alpha", "zeta"]);
  });

  it("surfaces one malformed manifest as a typed failure without dropping the others (dogfood scenario 17)", () => {
    const home = tempHome();
    writePortfolioManifest(home, buildManifest({ id: "good", name: "Good" }));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "bad.json"), "not json", "utf8");

    const entries = listPortfolioManifests(home);
    expect(entries).toHaveLength(2);
    const good = entries.find((e) => e.ok && e.manifest.id === "good");
    const bad = entries.find((e) => !e.ok);
    expect(good?.ok).toBe(true);
    expect(bad).toBeDefined();
    if (bad && !bad.ok) expect(bad.id).toBe("bad");
  });
});
