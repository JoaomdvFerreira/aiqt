import { existsSync } from "node:fs";
import type { StructuralFinding, StructuralProviderStatus } from "../../schema/structural-review.schema.js";
import type { StructuralEvidenceProvider } from "./provider-contract.js";

/**
 * Section 3.6/9/WU43-04: the Graphify pilot, evaluated per the build
 * spec's own instruction -- "if Graphify is unavailable or unsuitable,
 * provide deterministic provider-unavailable evidence and close the WU
 * without fabricating integration." No Graphify binary, service, or
 * credential is available in this repository/operator environment (no
 * `GRAPHIFY_BIN` env var resolves to a real, existing executable, and no
 * network/credential probing is performed to find out otherwise --
 * Section 3.6 explicitly forbids that for availability detection).
 * `checkAvailability` is therefore always deterministic and local:
 * unavailable, with an honest reason. `collectEvidence` is a defensive
 * stub that returns no findings rather than fabricate any -- the
 * contract guarantees callers never invoke it when unavailable, but it
 * still fails safe (empty, not thrown) if that guarantee were ever
 * violated by a future caller.
 */
export const graphifyProvider: StructuralEvidenceProvider = {
  providerId: "graphify",

  checkAvailability(_repoRoot: string): StructuralProviderStatus {
    const binPath = process.env.GRAPHIFY_BIN;
    if (binPath && existsSync(binPath)) {
      // Even if a binary were configured, M43 does not implement a real
      // Graphify integration -- reported unavailable honestly rather than
      // claiming a capability this milestone never built.
      return {
        providerId: "graphify",
        available: false,
        reason: "GRAPHIFY_BIN is configured, but no Graphify evidence-collection integration is implemented in this milestone.",
      };
    }
    return {
      providerId: "graphify",
      available: false,
      reason: "No Graphify binary/service is configured in this environment (GRAPHIFY_BIN unset or not found); no network/credential probe was attempted.",
    };
  },

  collectEvidence(_repoRoot: string, _reviewCommit: string): StructuralFinding[] {
    return [];
  },
};
