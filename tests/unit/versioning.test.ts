import { describe, it, expect } from "vitest";
import {
  assertCompatibleVersion,
  classifyCanonicalVersion,
} from "../../src/state/versioning.js";
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
  it("classifies the current schema version", () => {
    expect(classifyCanonicalVersion("0.8.0")).toBe("current");
    expect(() => assertCompatibleVersion("0.8.0", "state.json")).not.toThrow();
  });

  it("M48: classifies pre-night-audit 0.7.0 state as older compatible", () => {
    expect(classifyCanonicalVersion("0.7.0")).toBe("older_compatible");
    expect(() => assertCompatibleVersion("0.7.0", "state.json")).not.toThrow();
  });

  it("classifies and proceeds for an older compatible version", () => {
    expect(classifyCanonicalVersion("0.4.0")).toBe("older_compatible");
    expect(() => assertCompatibleVersion("0.4.0", "state.json")).not.toThrow();
  });

  it("M42: classifies pre-defect-queue 0.5.0 state as older compatible", () => {
    expect(classifyCanonicalVersion("0.5.0")).toBe("older_compatible");
    expect(() => assertCompatibleVersion("0.5.0", "state.json")).not.toThrow();
  });

  it("M45: classifies pre-maintenance-schedule 0.6.0 state as older compatible", () => {
    expect(classifyCanonicalVersion("0.6.0")).toBe("older_compatible");
    expect(() => assertCompatibleVersion("0.6.0", "state.json")).not.toThrow();
  });

  it("classifies and blocks a future unsupported version with exit code 3", () => {
    expect(classifyCanonicalVersion("9.9.9")).toBe("unsupported_future");
    const err = expectBlock(() =>
      assertCompatibleVersion("9.9.9", "state.json"),
    );
    expect(err.message).toContain("AIQT cannot continue.");
  });

  it("classifies and blocks an older incompatible version with exit code 3", () => {
    expect(classifyCanonicalVersion("0.0.0")).toBe("older_incompatible");
    const err = expectBlock(() => assertCompatibleVersion("0.0.0", "state.json"));
    expect(err.issue?.id).toBe("VERSION-OLDER-INCOMPATIBLE");
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
