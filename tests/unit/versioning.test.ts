import { describe, it, expect } from "vitest";
import { assertCompatibleVersion } from "../../src/state/versioning.js";
import { AiqtError } from "../../src/core/output/aiqt-error.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";

function expectBlock(fn: () => void): AiqtError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AiqtError);
    expect((err as AiqtError).exitCode).toBe(ExitCode.InvalidInput);
    return err as AiqtError;
  }
  throw new Error("expected assertCompatibleVersion to throw");
}

describe("version compatibility", () => {
  it("proceeds for the current schema version", () => {
    expect(() => assertCompatibleVersion("0.5.0", "state.json")).not.toThrow();
  });

  it("proceeds for an older compatible version", () => {
    expect(() => assertCompatibleVersion("0.4.0", "state.json")).not.toThrow();
  });

  it("blocks a future unsupported version with exit code 3", () => {
    const err = expectBlock(() =>
      assertCompatibleVersion("9.9.9", "state.json"),
    );
    expect(err.message).toContain("AIQT cannot continue.");
  });

  it("blocks a missing version with exit code 3", () => {
    expectBlock(() => assertCompatibleVersion(undefined, "state.json"));
  });

  it("blocks an invalid version type with exit code 3", () => {
    expectBlock(() => assertCompatibleVersion(123, "state.json"));
  });

  it("blocks a malformed version string with exit code 3", () => {
    expectBlock(() => assertCompatibleVersion("not-semver", "state.json"));
  });
});
