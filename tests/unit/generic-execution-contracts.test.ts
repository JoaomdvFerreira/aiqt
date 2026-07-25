import { describe, it, expect } from "vitest";
import {
  ADAPTER_REGISTRY,
  AdapterIdSchema,
  GENERIC_ADAPTER_ID,
  CLAUDE_ADAPTER_ID,
  findAdapterDescriptor,
} from "../../src/schema/adapter-registry.js";
import { ExternalAgentRefSchema } from "../../src/schema/external-agent-ref.schema.js";
import { ExternalExecutionRequestSchema } from "../../src/schema/external-execution-request.schema.js";
import { ExternalExecutionResultSchema, ValidationClaimSchema } from "../../src/schema/external-execution-result.schema.js";
import { NormalizedExternalExecutionResultSchema } from "../../src/schema/normalized-execution-result.schema.js";
import { ExecutionAdapterRequestSchema } from "../../src/schema/execution-adapter-request.schema.js";
import {
  generateGenericSessionClientKey,
  isGenericSessionClientKey,
  isLegacyProviderSpecificSession,
  GENERIC_PROVIDER_ID,
} from "../../src/workflow/generic-session-identity.js";

describe("M27R-WU02: static adapter registry (§3.1)", () => {
  it("contains exactly generic-json@1 (canonical default, stable) and claude-code-stream-json@1 (optional, experimental, synthetic_only)", () => {
    expect(ADAPTER_REGISTRY).toHaveLength(2);
    const generic = findAdapterDescriptor(GENERIC_ADAPTER_ID);
    expect(generic).toEqual({ adapterId: "generic-json@1", role: "canonical_default", maturity: "stable" });
    const claude = findAdapterDescriptor(CLAUDE_ADAPTER_ID);
    expect(claude).toEqual({ adapterId: "claude-code-stream-json@1", role: "optional_native_translator", maturity: "experimental", validation: "synthetic_only" });
  });

  it("AdapterIdSchema accepts only the two registered IDs", () => {
    expect(AdapterIdSchema.safeParse("generic-json@1").success).toBe(true);
    expect(AdapterIdSchema.safeParse("claude-code-stream-json@1").success).toBe(true);
    expect(AdapterIdSchema.safeParse("openai/codex@1").success).toBe(false);
    expect(AdapterIdSchema.safeParse("").success).toBe(false);
  });
});

describe("M27R-WU02: ExternalAgentRefSchema (§3.3)", () => {
  it("accepts an opaque providerId-only ref and unprivileged vendor IDs", () => {
    for (const providerId of ["openai/codex", "anthropic/claude-code", "github/copilot", "custom/local-agent", "external/agent"]) {
      const result = ExternalAgentRefSchema.safeParse({ providerId });
      expect(result.success, providerId).toBe(true);
    }
  });

  it("rejects an unknown/extra field (no raw content escape hatch)", () => {
    const result = ExternalAgentRefSchema.safeParse({ providerId: "openai/codex", transcript: "raw text" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty or malformed providerId", () => {
    expect(ExternalAgentRefSchema.safeParse({ providerId: "" }).success).toBe(false);
    expect(ExternalAgentRefSchema.safeParse({ providerId: "UPPERCASE" }).success).toBe(false);
  });
});

describe("M27R-WU02: ExternalExecutionResultSchema and ValidationClaimSchema (§3.5)", () => {
  const validResult = {
    protocolVersion: "aiqt-external-execution-result@1" as const,
    requestId: "REQ-001",
    executionSessionId: "SESS-001",
    agent: { providerId: "openai/codex" },
    resultClass: "success" as const,
    summary: "Implemented the feature.",
    continuation: { recommended: false },
    validationClaims: [{ command: "npm test", status: "passed" as const, trust: "self_reported" as const }],
    commitRefs: [],
    evidenceRefs: [],
  };

  it("accepts a minimal valid generic result", () => {
    expect(ExternalExecutionResultSchema.safeParse(validResult).success).toBe(true);
  });

  it("validation claim trust is a fixed literal -- never any other value", () => {
    const withBadTrust = { command: "npm test", status: "passed", trust: "verified" };
    expect(ValidationClaimSchema.safeParse(withBadTrust).success).toBe(false);
  });

  it("rejects raw content masquerading as an allowed field (strict schema, no passthrough)", () => {
    const withRawContent = { ...validResult, rawTranscript: "the entire conversation..." };
    expect(ExternalExecutionResultSchema.safeParse(withRawContent).success).toBe(false);
  });

  it("rejects an oversized summary beyond the bounded limit", () => {
    const withHugeSummary = { ...validResult, summary: "x".repeat(4001) };
    expect(ExternalExecutionResultSchema.safeParse(withHugeSummary).success).toBe(false);
  });

  it("rejects more than 50 validation claims", () => {
    const tooMany = { ...validResult, validationClaims: Array.from({ length: 51 }, () => validResult.validationClaims[0]) };
    expect(ExternalExecutionResultSchema.safeParse(tooMany).success).toBe(false);
  });
});

describe("M27R-WU02: NormalizedExternalExecutionResultSchema (§3.6)", () => {
  it("requires adapterId to be a registered static adapter and sourceDigest to be sha256-shaped", () => {
    const base = {
      protocolVersion: "aiqt-normalized-execution-result@1" as const,
      adapterId: "generic-json@1" as const,
      requestId: "REQ-001",
      executionSessionId: "SESS-001",
      agent: { providerId: "openai/codex" },
      resultClass: "success" as const,
      summary: "ok",
      continuation: { recommended: false },
      validationClaims: [],
      commitRefs: [],
      evidenceRefs: [],
      sourceDigest: `sha256:${"a".repeat(64)}`,
    };
    expect(NormalizedExternalExecutionResultSchema.safeParse(base).success).toBe(true);
    expect(NormalizedExternalExecutionResultSchema.safeParse({ ...base, adapterId: "unregistered-adapter@1" }).success).toBe(false);
    expect(NormalizedExternalExecutionResultSchema.safeParse({ ...base, sourceDigest: "not-a-digest" }).success).toBe(false);
  });
});

describe("M27R-WU02: ExternalExecutionRequestSchema (§3.4)", () => {
  it("accepts a minimal valid generic request bundle document", () => {
    const request = {
      protocolVersion: "aiqt-external-execution-request@1" as const,
      requestId: "REQ-001",
      executionSessionId: "SESS-001",
      sessionClientKey: "external/11111111-1111-4111-8111-111111111111",
      workUnitId: "WU001",
      packetId: "PKT-001",
      workspaceRef: { mode: "none" as const },
      requestSequence: 1,
      objective: "Implement the feature.",
      packet: {
        sourcePacketId: "PKT-001",
        role: "implementer",
        scope: ["a"],
        outOfScope: [],
        constraints: [],
        acceptanceCriteria: ["a passes"],
        validationCommands: ["npm test"],
      },
      expectedResultProtocol: "aiqt-external-execution-result@1" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
    };
    expect(ExternalExecutionRequestSchema.safeParse(request).success).toBe(true);
  });
});

describe("M27R-WU02: generic session identity (§3.2)", () => {
  it("generates a system-owned external/<uuid> key, unique per call", () => {
    const a = generateGenericSessionClientKey();
    const b = generateGenericSessionClientKey();
    expect(isGenericSessionClientKey(a)).toBe(true);
    expect(isGenericSessionClientKey(b)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith("external/")).toBe(true);
  });

  it("rejects non-conforming keys, including anything a user or adapter might supply", () => {
    expect(isGenericSessionClientKey("claude-code-stream-json@1:WU001:PKT-001")).toBe(false);
    expect(isGenericSessionClientKey("external/not-a-uuid")).toBe(false);
    expect(isGenericSessionClientKey("")).toBe(false);
  });

  it("isLegacyProviderSpecificSession distinguishes external/agent sessions from provider-specific ones", () => {
    expect(isLegacyProviderSpecificSession({ provider: { providerId: "anthropic/claude-code" } })).toBe(true);
    expect(isLegacyProviderSpecificSession({ provider: { providerId: GENERIC_PROVIDER_ID } })).toBe(false);
  });
});

describe("M27R-WU02: ExecutionAdapterRequestSchema additive compatibility", () => {
  const base = {
    id: "sha256:" + "a".repeat(64),
    executionSessionId: "sha256:" + "b".repeat(64),
    workUnitId: "WU001",
    packetId: "PKT-001",
    workspaceRef: { mode: "none" as const },
    requestSequence: 1,
    status: "requested" as const,
    requestDigest: "sha256:" + "c".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
  };

  it("an existing pre-M27R-shaped Claude request record (mode/externalSessionId/providerVersionConstraint set, no new fields) remains valid", () => {
    const legacyClaudeRequest = {
      ...base,
      adapterId: "claude-code-stream-json@1" as const,
      externalSessionId: "11111111-1111-4111-8111-111111111111",
      mode: "start" as const,
      providerVersionConstraint: "claude-code>=1.0.0 <2.0.0",
    };
    expect(ExecutionAdapterRequestSchema.safeParse(legacyClaudeRequest).success).toBe(true);
  });

  it("a new generic-json@1 request (sessionClientKey set, no mode/externalSessionId/providerVersionConstraint) validates", () => {
    const genericRequest = {
      ...base,
      adapterId: "generic-json@1" as const,
      sessionClientKey: "external/11111111-1111-4111-8111-111111111111",
      mode: "start" as const,
    };
    expect(ExecutionAdapterRequestSchema.safeParse(genericRequest).success).toBe(true);
  });

  it("a new field (importedAgent) is accepted once a request is imported", () => {
    const imported = {
      ...base,
      adapterId: "generic-json@1" as const,
      sessionClientKey: "external/11111111-1111-4111-8111-111111111111",
      mode: "start" as const,
      status: "imported" as const,
      importedAt: "2026-01-01T01:00:00.000Z",
      importedSourceDigest: "sha256:" + "d".repeat(64),
      importedIterationId: "XI-001",
      importedAgent: { providerId: "openai/codex" },
    };
    expect(ExecutionAdapterRequestSchema.safeParse(imported).success).toBe(true);
  });
});
