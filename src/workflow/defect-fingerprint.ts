import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { DefectSourceKind } from "../schema/defect.schema.js";

/**
 * Section 4.3: deterministic dedup identity. Built ONLY from structural
 * identity fields (source kind, affected Work Unit, validation target,
 * a caller-supplied evidence signature) -- never from `title`/`summary`
 * text, so textually-similar-but-unrelated failures never collide, and
 * the same underlying failure always produces the same fingerprint
 * regardless of narrative wording (Section 4.3's "do not deduplicate
 * unrelated failures merely because their summaries are textually
 * similar").
 */
export interface DefectFingerprintInput {
  sourceKind: DefectSourceKind;
  affectedWorkUnitId?: string;
  affectedValidationTarget?: string;
  /**
   * A bounded, structural signature of what actually failed -- e.g. a test
   * name + assertion message, a checkpoint acceptance-criterion id, or a
   * review finding key. Never raw log/chat text.
   */
  evidenceSignature: string;
}

export function computeDefectFingerprint(input: DefectFingerprintInput): string {
  return computeCanonicalPayloadDigest({
    sourceKind: input.sourceKind,
    affectedWorkUnitId: input.affectedWorkUnitId ?? null,
    affectedValidationTarget: input.affectedValidationTarget ?? null,
    evidenceSignature: input.evidenceSignature,
  });
}
