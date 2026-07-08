import { describe, it, expect } from "vitest";
import { formatId, nextId, parseIdNumber } from "../../src/state/ids.js";

describe("id generation", () => {
  it("formats ids zero-padded to three digits", () => {
    expect(formatId("PROJECT", 1)).toBe("PROJECT-001");
    expect(formatId("EVT", 42)).toBe("EVT-042");
  });

  it("parses the numeric suffix of a prefixed id", () => {
    expect(parseIdNumber("EVT", "EVT-007")).toBe(7);
    expect(parseIdNumber("EVT", "PROJECT-001")).toBeNull();
  });

  it("returns the first id when none exist", () => {
    expect(nextId("EVT", [])).toBe("EVT-001");
  });

  it("increments from the highest existing id by prefix", () => {
    expect(nextId("EVT", ["EVT-001", "EVT-003", "EVT-002"])).toBe("EVT-004");
  });

  it("ignores ids from other prefixes", () => {
    expect(nextId("EVT", ["PROJECT-009", "EVT-001"])).toBe("EVT-002");
  });

  it("supports a custom (empty) separator for D and Q id styles", () => {
    expect(formatId("D", 1, "")).toBe("D001");
    expect(formatId("Q", 2, "")).toBe("Q002");
    expect(parseIdNumber("D", "D001", "")).toBe(1);
    expect(nextId("D", [], "")).toBe("D001");
    expect(nextId("D", ["D001", "D002"], "")).toBe("D003");
    expect(nextId("Q", ["Q001"], "")).toBe("Q002");
  });

  it("generates REQ/ASM/RISK ids with the default hyphen separator", () => {
    expect(nextId("REQ", [])).toBe("REQ-001");
    expect(nextId("ASM", ["ASM-001"])).toBe("ASM-002");
    expect(nextId("RISK", [])).toBe("RISK-001");
  });
});
