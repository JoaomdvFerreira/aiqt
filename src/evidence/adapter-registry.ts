import type { ZodTypeAny } from "zod";
import { GenericEvidenceV1Schema } from "../schema/external-evidence/generic-evidence-v1.schema.js";
import { GenericCiV1Schema } from "../schema/external-evidence/generic-ci-v1.schema.js";
import { ManualEvidenceV1Schema } from "../schema/external-evidence/manual-evidence-v1.schema.js";

/**
 * M23 §2/§19: exactly three static, compile-time-known import formats.
 * No filesystem discovery, no dynamic `import()`, no package loading, no
 * environment-controlled plugin registration. Extending this list is a
 * source-code change, never a runtime one.
 */
export const SUPPORTED_EXTERNAL_EVIDENCE_FORMATS = [
  "generic-evidence-json@1",
  "generic-ci-json@1",
  "manual-evidence-json@1",
] as const;

export type SupportedExternalEvidenceFormat = (typeof SUPPORTED_EXTERNAL_EVIDENCE_FORMATS)[number];

export function isSupportedExternalEvidenceFormat(value: unknown): value is SupportedExternalEvidenceFormat {
  return (
    typeof value === "string" &&
    (SUPPORTED_EXTERNAL_EVIDENCE_FORMATS as readonly string[]).includes(value)
  );
}

/**
 * M23 §19: adapterId is fixed 1:1 to the format literal -- there is no
 * separate adapter-selection mechanism, so identity confusion between
 * "format" and "adapter" cannot arise.
 */
export const EXTERNAL_EVIDENCE_SCHEMA_REGISTRY: Readonly<
  Record<SupportedExternalEvidenceFormat, ZodTypeAny>
> = Object.freeze({
  "generic-evidence-json@1": GenericEvidenceV1Schema,
  "generic-ci-json@1": GenericCiV1Schema,
  "manual-evidence-json@1": ManualEvidenceV1Schema,
});

export function getExternalEvidenceSchema(format: SupportedExternalEvidenceFormat): ZodTypeAny {
  return EXTERNAL_EVIDENCE_SCHEMA_REGISTRY[format];
}
