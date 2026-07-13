import { describe, it, expect } from "vitest";
import { isValidImportType, preferGuidedCommand } from "../../src/services/import-service.js";

describe("isValidImportType", () => {
  it("accepts update, plan, and checkpoint", () => {
    expect(isValidImportType("update")).toBe(true);
    expect(isValidImportType("plan")).toBe(true);
    expect(isValidImportType("checkpoint")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidImportType("bogus")).toBe(false);
    expect(isValidImportType("")).toBe(false);
  });
});

describe("preferGuidedCommand (RC1)", () => {
  it("maps aiqt plan to the guided aiqt prompt plan", () => {
    expect(preferGuidedCommand("aiqt plan")).toBe("aiqt prompt plan");
  });

  it("maps aiqt checkpoint to the guided aiqt prompt checkpoint", () => {
    expect(preferGuidedCommand("aiqt checkpoint")).toBe("aiqt prompt checkpoint");
  });

  it("leaves already-direct commands unchanged", () => {
    expect(preferGuidedCommand("aiqt next")).toBe("aiqt next");
    expect(preferGuidedCommand("aiqt update")).toBe("aiqt update");
    expect(preferGuidedCommand("aiqt review")).toBe("aiqt review");
    expect(preferGuidedCommand("aiqt export all")).toBe("aiqt export all");
  });

  it("passes null through unchanged", () => {
    expect(preferGuidedCommand(null)).toBeNull();
  });
});
