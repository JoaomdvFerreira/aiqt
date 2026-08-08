import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AIQT_PACKAGE_VERSION } from "../../src/core/constants/package-version.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

describe("AIQT_PACKAGE_VERSION (M18 §15)", () => {
  it("derives from package.json's canonical version field", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      version: string;
    };
    expect(AIQT_PACKAGE_VERSION).toBe(packageJson.version);
  });

  // M40: a hardcoded exact-version assertion was removed here. AIQT
  // governance deliberately separates package version, milestone identity,
  // and GitHub Release publication (docs/governance/versioning.md) -- the
  // package version legitimately advances ahead of the latest published
  // GitHub Release, so pinning this test to a specific literal is both
  // redundant (the derivation test above already proves the only
  // meaningful invariant) and actively wrong across every version bump.
  // `pnpm version:check` is the actual governance mechanism for whether a
  // given bump is required/valid; it is not duplicated here.
});
