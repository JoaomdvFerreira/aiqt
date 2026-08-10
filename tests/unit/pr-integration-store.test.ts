import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  writePrIntegrationPlan,
  readPrIntegrationPlan,
  listPrIntegrationIds,
} from "../../src/state/pr-integration-store.js";
import { resolvePrIntegrationHome, resolvePrIntegrationFilePath } from "../../src/state/pr-integration-home.js";
import { assertCompatiblePrIntegrationVersion } from "../../src/state/pr-integration-versioning.js";
import { PR_INTEGRATION_SCHEMA_VERSION, type PullRequestIntegrationPlan } from "../../src/schema/pull-request-integration.schema.js";
import { createIntegrationPlan } from "../../src/workflow/pr-integration-lifecycle.js";
import { computePrMetadataDigest, type PullRequestWriteBindingFacts } from "../../src/workflow/pr-integration-identity.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";

const NOW = "2026-08-10T00:00:00.000Z";
const SHA_A = "a".repeat(40);
const ID = "pri-1754784000000-0123abcd";

const dirs: string[] = [];
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "aiqt-pr-integration-store-test-"));
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
  delete process.env.AIQT_PR_INTEGRATION_HOME;
});

function facts(): PullRequestWriteBindingFacts {
  return {
    provider: "github",
    repositoryRoot: resolve("/tmp/target-repo"),
    remoteName: "origin",
    remoteRepositoryIdentity: "acme/widget",
    baseBranch: "main",
    sourceBranch: "feature/x",
    sourceHeadSha: SHA_A,
    metadataDigest: computePrMetadataDigest({ title: "Add widget", body: "Body." }),
    reviewers: [],
    createMode: "draft",
    policy: { requireProtectedBase: false },
  };
}

function buildPlan(id = ID): PullRequestIntegrationPlan {
  return createIntegrationPlan({ id, now: NOW, facts: facts(), title: "Add widget", portfolioRef: null });
}

describe("M47-WU01 store: plans persist outside every repository they act on", () => {
  it("resolves under the user home by default, and never inside a repository working tree", () => {
    delete process.env.AIQT_PR_INTEGRATION_HOME;
    const home = resolvePrIntegrationHome();
    expect(home).toBe(join(homedir(), ".aiqt", "pr-integrations"));
    expect(home.startsWith(homedir())).toBe(true);
  });

  it("honours an explicit override for tests/operators", () => {
    process.env.AIQT_PR_INTEGRATION_HOME = "./some/where";
    expect(resolvePrIntegrationHome()).toBe(resolve("./some/where"));
  });

  it("an all-whitespace override falls back to the default rather than resolving to the cwd", () => {
    process.env.AIQT_PR_INTEGRATION_HOME = "   ";
    expect(resolvePrIntegrationHome()).toBe(join(homedir(), ".aiqt", "pr-integrations"));
  });
});

describe("M47-WU01 store: write/read round-trip", () => {
  it("writes one file per plan and reads it back verbatim", () => {
    const home = tempHome();
    const plan = buildPlan();
    const path = writePrIntegrationPlan(home, plan);
    expect(path).toBe(resolvePrIntegrationFilePath(home, ID));

    const result = readPrIntegrationPlan(home, ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toEqual(plan);
  });

  it("creates the home directory on first write", () => {
    const home = join(tempHome(), "nested", "deeper");
    writePrIntegrationPlan(home, buildPlan());
    expect(readPrIntegrationPlan(home, ID).ok).toBe(true);
  });

  it("refuses to write a plan whose id is not the fixed shape", () => {
    const home = tempHome();
    expect(() => writePrIntegrationPlan(home, { ...buildPlan(), id: "../escape" })).toThrow(/not a valid PR integration id/);
  });
});

describe("M47-WU01 store: reads are fail-closed", () => {
  it("a missing plan is an error, never an empty plan", () => {
    const result = readPrIntegrationPlan(tempHome(), ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/does not exist/);
  });

  it("an id that could traverse the filesystem is rejected before any path is built", () => {
    const result = readPrIntegrationPlan(tempHome(), "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.path).toBeNull();
    expect(result.reason).toMatch(/not a valid PR integration id/);
  });

  it("malformed JSON is reported, not silently ignored", () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(resolvePrIntegrationFilePath(home, ID), "{not json", "utf8");
    const result = readPrIntegrationPlan(home, ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Unable to read PR integration/);
  });

  it("a schema-invalid plan is rejected (a plan missing its recorded push cannot be trusted)", () => {
    const home = tempHome();
    const plan = buildPlan();
    writePrIntegrationPlan(home, plan);
    const raw = JSON.parse(readFileSync(resolvePrIntegrationFilePath(home, ID), "utf8")) as Record<string, unknown>;
    delete raw.push;
    writeFileSync(resolvePrIntegrationFilePath(home, ID), JSON.stringify(raw), "utf8");
    expect(readPrIntegrationPlan(home, ID).ok).toBe(false);
  });

  it("a plan whose recorded id disagrees with its filename is rejected", () => {
    const home = tempHome();
    writePrIntegrationPlan(home, buildPlan());
    const path = resolvePrIntegrationFilePath(home, ID);
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    raw.id = "pri-1754784000000-ffffffff";
    writeFileSync(path, JSON.stringify(raw), "utf8");
    const result = readPrIntegrationPlan(home, ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/does not match the requested id/);
  });

  it("an incompatible-major plan is rejected before it can be acted on", () => {
    const home = tempHome();
    writePrIntegrationPlan(home, buildPlan());
    const path = resolvePrIntegrationFilePath(home, ID);
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    raw.schemaVersion = "2.0.0";
    writeFileSync(path, JSON.stringify(raw), "utf8");
    const result = readPrIntegrationPlan(home, ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Unsupported PR integration schema version/);
  });
});

describe("M47-WU01 store: listing", () => {
  it("is deterministic, ignores non-plan files, and treats a missing home as empty", () => {
    const home = tempHome();
    expect(listPrIntegrationIds(join(home, "absent"))).toEqual([]);

    writePrIntegrationPlan(home, buildPlan("pri-1754784000002-0000000b"));
    writePrIntegrationPlan(home, buildPlan("pri-1754784000001-0000000a"));
    writeFileSync(join(home, "notes.txt"), "ignored", "utf8");
    writeFileSync(join(home, "bogus-id.json"), "{}", "utf8");

    expect(listPrIntegrationIds(home)).toEqual(["pri-1754784000001-0000000a", "pri-1754784000002-0000000b"]);
  });
});

describe("M47-WU01 versioning gate is its own domain", () => {
  it("accepts the current version and rejects a missing, malformed, or different-major one", () => {
    expect(() => assertCompatiblePrIntegrationVersion(PR_INTEGRATION_SCHEMA_VERSION, "test")).not.toThrow();
    expect(() => assertCompatiblePrIntegrationVersion("1.9.3", "test")).not.toThrow();
    for (const bad of [undefined, null, 1, "", "1.0", "2.0.0", "0.9.0"]) {
      expect(() => assertCompatiblePrIntegrationVersion(bad, "test"), `${String(bad)} should be rejected`).toThrow(AiqtError);
    }
  });

  it("is independent of AIQT_SCHEMA_VERSION and the portfolio schema version", async () => {
    const { AIQT_SCHEMA_VERSION } = await import("../../src/core/constants/schema-version.js");
    const { PORTFOLIO_SCHEMA_VERSION } = await import("../../src/schema/portfolio.schema.js");
    // Three separate schema domains: this assertion documents that M47's
    // record does not participate in the canonical project-state contract.
    expect(PR_INTEGRATION_SCHEMA_VERSION).not.toBe(AIQT_SCHEMA_VERSION);
    expect(PR_INTEGRATION_SCHEMA_VERSION).toBe(PORTFOLIO_SCHEMA_VERSION); // both are new 1.0.0 domains, independently versioned
  });
});
