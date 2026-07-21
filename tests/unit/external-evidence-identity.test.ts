import { describe, it, expect } from "vitest";
import {
  canonicalizeJsonValue,
  canonicalJsonStringify,
  computeCanonicalPayloadDigest,
  canonicalTupleEncode,
} from "../../src/schema/external-evidence/canonical-json.js";
import { deriveImportIdentityKey } from "../../src/schema/external-evidence/import-identity.js";
import { ImportProvenanceSchema, EvidenceRecordSchema } from "../../src/schema/evidence.schema.js";

describe("canonical JSON digest (M23 §6.1)", () => {
  it("is unaffected by top-level and nested key order", () => {
    const a = { b: 1, a: { y: 2, x: 1 } };
    const b = { a: { x: 1, y: 2 }, b: 1 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(computeCanonicalPayloadDigest(a)).toBe(computeCanonicalPayloadDigest(b));
  });

  it("preserves array order -- reordering array elements changes the digest", () => {
    const a = { list: [1, 2, 3] };
    const b = { list: [3, 2, 1] };
    expect(computeCanonicalPayloadDigest(a)).not.toBe(computeCanonicalPayloadDigest(b));
  });

  it("is unaffected by insignificant whitespace in the source text", () => {
    const compact = JSON.parse('{"a":1,"b":2}');
    const spaced = JSON.parse('{ "a" : 1 ,  "b" : 2 }');
    expect(computeCanonicalPayloadDigest(compact)).toBe(computeCanonicalPayloadDigest(spaced));
  });

  it("changes when a semantic value changes", () => {
    const a = { a: 1 };
    const b = { a: 2 };
    expect(computeCanonicalPayloadDigest(a)).not.toBe(computeCanonicalPayloadDigest(b));
  });

  it("preserves decoded string values exactly", () => {
    const value = { text: "hello \"world\"\nsecond line" };
    expect(canonicalizeJsonValue(value)).toEqual(value);
  });

  it("canonicalTupleEncode is unambiguous across a naive delimiter collision", () => {
    const encodedA = canonicalTupleEncode(["ab", "c"]);
    const encodedB = canonicalTupleEncode(["a", "bc"]);
    expect(encodedA).not.toBe(encodedB);
  });
});

describe("importIdentityKey derivation (M23 §9 Critical rule 1)", () => {
  it("same scoped externalId always derives the same key, independent of payload digest", () => {
    const a = deriveImportIdentityKey({
      adapterId: "generic-evidence-json@1",
      providerId: "prov-1",
      externalId: "ext-1",
      sourcePayloadDigest: "digest-a",
    });
    const b = deriveImportIdentityKey({
      adapterId: "generic-evidence-json@1",
      providerId: "prov-1",
      externalId: "ext-1",
      sourcePayloadDigest: "digest-b",
    });
    expect(a.importIdentityKey).toBe(b.importIdentityKey);
    expect(a.mode).toBe("external_id");
  });

  it("different externalIds with the same payload digest derive distinct keys", () => {
    const a = deriveImportIdentityKey({
      adapterId: "generic-evidence-json@1",
      providerId: "prov-1",
      externalId: "ext-1",
      sourcePayloadDigest: "digest-same",
    });
    const b = deriveImportIdentityKey({
      adapterId: "generic-evidence-json@1",
      providerId: "prov-1",
      externalId: "ext-2",
      sourcePayloadDigest: "digest-same",
    });
    expect(a.importIdentityKey).not.toBe(b.importIdentityKey);
  });

  it("without an externalId, identical payload digests derive the same content-addressed key", () => {
    const a = deriveImportIdentityKey({
      adapterId: "manual-evidence-json@1",
      providerId: "prov-1",
      sourcePayloadDigest: "same-digest",
    });
    const b = deriveImportIdentityKey({
      adapterId: "manual-evidence-json@1",
      providerId: "prov-1",
      sourcePayloadDigest: "same-digest",
    });
    expect(a.importIdentityKey).toBe(b.importIdentityKey);
    expect(a.mode).toBe("content_addressed");
  });

  it("without an externalId, a changed payload digest derives a distinct key", () => {
    const a = deriveImportIdentityKey({
      adapterId: "manual-evidence-json@1",
      providerId: "prov-1",
      sourcePayloadDigest: "digest-1",
    });
    const b = deriveImportIdentityKey({
      adapterId: "manual-evidence-json@1",
      providerId: "prov-1",
      sourcePayloadDigest: "digest-2",
    });
    expect(a.importIdentityKey).not.toBe(b.importIdentityKey);
  });

  it("normalizes providerId casing/whitespace so equivalent providers collide identically", () => {
    const a = deriveImportIdentityKey({
      adapterId: "generic-evidence-json@1",
      providerId: "Prov-1",
      externalId: "ext-1",
      sourcePayloadDigest: "d",
    });
    const b = deriveImportIdentityKey({
      adapterId: "generic-evidence-json@1",
      providerId: " prov-1 ",
      externalId: "ext-1",
      sourcePayloadDigest: "d",
    });
    expect(a.importIdentityKey).toBe(b.importIdentityKey);
  });

  it("different adapterId always derives a distinct key even with identical provider/external id", () => {
    const a = deriveImportIdentityKey({
      adapterId: "generic-evidence-json@1",
      providerId: "prov-1",
      externalId: "ext-1",
      sourcePayloadDigest: "d",
    });
    const b = deriveImportIdentityKey({
      adapterId: "manual-evidence-json@1",
      providerId: "prov-1",
      externalId: "ext-1",
      sourcePayloadDigest: "d",
    });
    expect(a.importIdentityKey).not.toBe(b.importIdentityKey);
  });
});

describe("ImportProvenance (M23-WU02 §16)", () => {
  it("is optional and absent by default on an EvidenceRecord", () => {
    const record = {
      evidenceId: "EVID-001",
      contractVersion: "1.0",
      provider: { providerId: "reviewer-1", providerType: "human", trustLevel: "repository_local" },
      workflowBinding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1" },
      codeBinding: { commitSha: "abc123", capturedAt: "2026-01-01T00:00:00.000Z" },
      reviewer: { reviewerType: "human", independentContext: "declared_independent" },
      results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
      sourceFindings: [],
      decisionEscalationIds: [],
      artifactReferences: [],
      recordedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = EvidenceRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.importProvenance).toBeUndefined();
    }
  });

  it("accepts a well-formed importProvenance value", () => {
    expect(
      ImportProvenanceSchema.safeParse({
        adapterId: "generic-evidence-json@1",
        sourcePayloadDigest: "sha256:abc",
        externalEvidenceId: "ext-1",
        importIdentityKey: "sha256:def",
        importedAt: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an importProvenance value with unknown fields", () => {
    const result = ImportProvenanceSchema.safeParse({
      adapterId: "generic-evidence-json@1",
      sourcePayloadDigest: "sha256:abc",
      importIdentityKey: "sha256:def",
      importedAt: "2026-01-01T00:00:00.000Z",
      rawPayload: "{}",
    });
    expect(result.success).toBe(false);
  });
});
