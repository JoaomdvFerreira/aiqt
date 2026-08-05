import { describe, it, expect } from "vitest";
import { buildSandboxFallbackRecommendation } from "../../src/workflow/sandbox-fallback-policy.js";

describe("M38-WU01 sandbox-fallback-policy: request/import fallback", () => {
  it("always recommends the M37 request/import workflow, never a bare execution command", () => {
    const rec = buildSandboxFallbackRecommendation("capability check failed");
    expect(rec.recommendation).toBe("fallback_to_request_import");
    expect(rec.recommendedCommand).toBe("aiqt autonomous run");
    expect(rec.reason).toBe("capability check failed");
  });

  it("carries whatever reason the caller supplies verbatim, for evidence/reporting purposes", () => {
    const rec = buildSandboxFallbackRecommendation("host platform win32 is unsupported");
    expect(rec.reason).toContain("win32");
  });
});
