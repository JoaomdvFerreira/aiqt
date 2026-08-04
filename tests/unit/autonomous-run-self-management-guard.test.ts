import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isAiqtOwnRepository } from "../../src/workflow/autonomous-run-self-management-guard.js";
import { makeTempDir, removeDir } from "../helpers.js";

/**
 * M37 build spec Sec 8 Cross-Work-Unit Invariant 1: "AIQT never targets
 * its own repository." Plain filesystem I/O only -- no subprocess.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

describe("isAiqtOwnRepository (M37-WU01, pure filesystem)", () => {
  it("returns true for this repository's own root (real package.json with name:\"aiqt\")", () => {
    expect(isAiqtOwnRepository(repoRoot)).toBe(true);
  });

  it("returns false for a directory with no package.json at all", () => {
    const dir = makeTempDir("aiqt-guard-no-pkg-");
    try {
      expect(isAiqtOwnRepository(dir)).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it("returns false for a directory whose package.json has a different name", () => {
    const dir = makeTempDir("aiqt-guard-other-pkg-");
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "some-other-project" }));
      expect(isAiqtOwnRepository(dir)).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it("returns false for a directory whose package.json is malformed JSON (fails closed to false, not throwing)", () => {
    const dir = makeTempDir("aiqt-guard-malformed-");
    try {
      writeFileSync(join(dir, "package.json"), "{not valid json");
      expect(() => isAiqtOwnRepository(dir)).not.toThrow();
      expect(isAiqtOwnRepository(dir)).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it("returns true for a nested directory whose package.json happens to declare name:\"aiqt\" (a deliberate impersonation attempt is still caught)", () => {
    const dir = makeTempDir("aiqt-guard-impersonate-");
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "aiqt" }));
      expect(isAiqtOwnRepository(dir)).toBe(true);
    } finally {
      removeDir(dir);
    }
  });
});
