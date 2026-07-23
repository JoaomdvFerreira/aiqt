import { describe, it, expect } from "vitest";
import { deriveExecutionSessionIdentity } from "../../src/workflow/execution-session-identity.js";

function baseInput() {
  return {
    projectId: "P001",
    workUnitId: "WU001",
    packetId: "PKT-001",
    workspaceMode: "managed" as const,
    workspaceIdOrNone: "WS-001",
    workspaceGenerationOrZero: 1,
    providerId: "example.provider",
    sessionClientKey: "client-key-1",
  };
}

describe("deriveExecutionSessionIdentity (M26 §3.3)", () => {
  it("is deterministic for the same tuple", () => {
    const input = baseInput();
    expect(deriveExecutionSessionIdentity(input)).toBe(deriveExecutionSessionIdentity({ ...input }));
  });

  it("differs when sessionClientKey differs (retry after terminal requires a new key)", () => {
    const a = deriveExecutionSessionIdentity(baseInput());
    const b = deriveExecutionSessionIdentity({ ...baseInput(), sessionClientKey: "client-key-2" });
    expect(a).not.toBe(b);
  });

  it("differs when providerId differs", () => {
    const a = deriveExecutionSessionIdentity(baseInput());
    const b = deriveExecutionSessionIdentity({ ...baseInput(), providerId: "other.provider" });
    expect(a).not.toBe(b);
  });

  it("differs when workUnitId differs", () => {
    const a = deriveExecutionSessionIdentity(baseInput());
    const b = deriveExecutionSessionIdentity({ ...baseInput(), workUnitId: "WU002" });
    expect(a).not.toBe(b);
  });

  it("differs when packetId differs", () => {
    const a = deriveExecutionSessionIdentity(baseInput());
    const b = deriveExecutionSessionIdentity({ ...baseInput(), packetId: "PKT-002" });
    expect(a).not.toBe(b);
  });

  it("differs when workspaceMode differs", () => {
    const a = deriveExecutionSessionIdentity(baseInput());
    const b = deriveExecutionSessionIdentity({
      ...baseInput(),
      workspaceMode: "none" as const,
      workspaceIdOrNone: null,
      workspaceGenerationOrZero: 0,
    });
    expect(a).not.toBe(b);
  });

  it("differs when workspaceGeneration differs (reprepare after release must be a distinct series member)", () => {
    const a = deriveExecutionSessionIdentity(baseInput());
    const b = deriveExecutionSessionIdentity({ ...baseInput(), workspaceGenerationOrZero: 2 });
    expect(a).not.toBe(b);
  });

  it("is a sha256: prefixed lowercase hex digest (matching the shared hash.ts convention)", () => {
    const id = deriveExecutionSessionIdentity(baseInput());
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
