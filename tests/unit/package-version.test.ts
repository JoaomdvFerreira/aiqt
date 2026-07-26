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

  it("is the current released version 0.17.0 (M29 Advisory Checkpoint Evidence Integration)", () => {
    expect(AIQT_PACKAGE_VERSION).toBe("0.17.0");
  });
});
