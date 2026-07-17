import { describe, it, expect } from "vitest";
import {
  parseSemver,
  isValidSemver,
  isNormalizedSemver,
  compareSemver,
  classifyIncrement,
} from "../../src/tooling/semver.js";

describe("parseSemver / isValidSemver (M19 §22.1)", () => {
  it("accepts a valid patch version", () => {
    expect(isValidSemver("0.6.1")).toBe(true);
  });

  it("accepts a valid minor version", () => {
    expect(isValidSemver("0.7.0")).toBe(true);
  });

  it("accepts a valid major version", () => {
    expect(isValidSemver("2.0.0")).toBe(true);
  });

  it("accepts a valid prerelease version", () => {
    expect(isValidSemver("1.0.0-alpha.1")).toBe(true);
    const parsed = parseSemver("1.0.0-alpha.1")!;
    expect(parsed.prerelease).toEqual(["alpha", "1"]);
  });

  it("accepts a version with build metadata", () => {
    expect(isValidSemver("1.0.0+build.5")).toBe(true);
  });

  it.each(["1.0", "1.0.0.0", "v1.0.0", "1.0.0-", "not-semver", "", "01.0.0"])(
    "rejects invalid version %s",
    (input) => {
      expect(isValidSemver(input)).toBe(false);
    },
  );
});

describe("isNormalizedSemver", () => {
  it("accepts an already-normalized version", () => {
    expect(isNormalizedSemver("0.6.0")).toBe(true);
  });

  it("rejects a version with surrounding whitespace", () => {
    expect(isNormalizedSemver(" 0.6.0")).toBe(false);
    expect(isNormalizedSemver("0.6.0 ")).toBe(false);
  });
});

describe("compareSemver (M19 §13/§22.1: lexical-order trap)", () => {
  it("orders 0.10.0 greater than 0.9.0 numerically, not lexically", () => {
    const a = parseSemver("0.10.0")!;
    const b = parseSemver("0.9.0")!;
    expect(compareSemver(a, b)).toBeGreaterThan(0);
  });

  it("orders 0.2.0 greater than 0.10.0 is false -- 0.10.0 > 0.2.0", () => {
    const a = parseSemver("0.10.0")!;
    const b = parseSemver("0.2.0")!;
    expect(compareSemver(a, b)).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    const a = parseSemver("0.6.0")!;
    const b = parseSemver("0.6.0")!;
    expect(compareSemver(a, b)).toBe(0);
  });

  it("orders a release higher than its own prerelease", () => {
    const release = parseSemver("1.0.0")!;
    const pre = parseSemver("1.0.0-alpha")!;
    expect(compareSemver(release, pre)).toBeGreaterThan(0);
  });

  it("orders numeric prerelease identifiers numerically", () => {
    const a = parseSemver("1.0.0-alpha.10")!;
    const b = parseSemver("1.0.0-alpha.9")!;
    expect(compareSemver(a, b)).toBeGreaterThan(0);
  });

  it("detects a version decrease", () => {
    const a = parseSemver("0.5.0")!;
    const b = parseSemver("0.6.0")!;
    expect(compareSemver(a, b)).toBeLessThan(0);
  });

  it("ignores build metadata for precedence", () => {
    const a = parseSemver("1.0.0+build.1")!;
    const b = parseSemver("1.0.0+build.2")!;
    expect(compareSemver(a, b)).toBe(0);
  });
});

describe("classifyIncrement (M19 §14: informational only)", () => {
  it("classifies a patch increment", () => {
    expect(classifyIncrement(parseSemver("0.6.0")!, parseSemver("0.6.1")!)).toBe("patch");
  });

  it("classifies a minor increment", () => {
    expect(classifyIncrement(parseSemver("0.5.1")!, parseSemver("0.6.0")!)).toBe("minor");
  });

  it("classifies a major increment", () => {
    expect(classifyIncrement(parseSemver("1.4.0")!, parseSemver("2.0.0")!)).toBe("major");
  });

  it("classifies no change", () => {
    expect(classifyIncrement(parseSemver("0.6.0")!, parseSemver("0.6.0")!)).toBe("none");
  });
});
