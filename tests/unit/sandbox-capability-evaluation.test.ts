import { describe, it, expect } from "vitest";
import { evaluateSandboxCapabilities, evaluateSandboxNetworkCapability } from "../../src/workflow/sandbox-capability-evaluation.js";
import { MINIMUM_REQUIRED_SANDBOX_CAPABILITIES, type SandboxCapability, type SandboxCapabilityReport } from "../../src/schema/sandbox-backend.schema.js";

function report(capabilities: SandboxCapability[]): SandboxCapabilityReport {
  return { backendId: "test-backend@1", backendVersion: "1.0.0", capabilities };
}

describe("M38-WU01 sandbox-capability-evaluation: minimum capability evaluation", () => {
  it("a backend reporting every minimum-required capability is sufficient, no fallback", () => {
    const result = evaluateSandboxCapabilities(report([...MINIMUM_REQUIRED_SANDBOX_CAPABILITIES]));
    expect(result.sufficient).toBe(true);
    expect(result.missingCapabilities).toEqual([]);
    expect(result.recommendation).toBe("proceed_to_sandbox_creation");
    expect(result.fallback).toBeNull();
  });

  it("a backend reporting zero capabilities is insufficient and recommends request/import, never a silent proceed", () => {
    const result = evaluateSandboxCapabilities(report([]));
    expect(result.sufficient).toBe(false);
    expect(result.missingCapabilities.length).toBe(MINIMUM_REQUIRED_SANDBOX_CAPABILITIES.size);
    expect(result.recommendation).toBe("fallback_to_request_import");
    expect(result.fallback).not.toBeNull();
    expect(result.fallback?.recommendedCommand).toBe("aiqt autonomous run");
  });

  it("a backend missing exactly one required capability reports exactly that one as missing", () => {
    const allButOne = [...MINIMUM_REQUIRED_SANDBOX_CAPABILITIES].filter((c) => c !== "process_tree_control");
    const result = evaluateSandboxCapabilities(report(allButOne));
    expect(result.sufficient).toBe(false);
    expect(result.missingCapabilities).toEqual(["process_tree_control"]);
  });

  it("network_destination_restriction is not part of the unconditional minimum -- a backend without it is still sufficient for a network-denied run", () => {
    const withoutDestinationRestriction = [...MINIMUM_REQUIRED_SANDBOX_CAPABILITIES];
    const result = evaluateSandboxCapabilities(report(withoutDestinationRestriction));
    expect(result.sufficient).toBe(true);
  });
});

describe("M38-WU01 sandbox-capability-evaluation: network capability evaluation (only required when network is explicitly enabled)", () => {
  it("reports sufficient when network_destination_restriction is present", () => {
    const result = evaluateSandboxNetworkCapability(report(["network_destination_restriction"]));
    expect(result.sufficient).toBe(true);
    expect(result.fallback).toBeNull();
  });

  it("reports insufficient and recommends request/import when network_destination_restriction is absent", () => {
    const result = evaluateSandboxNetworkCapability(report([]));
    expect(result.sufficient).toBe(false);
    expect(result.missingCapabilities).toEqual(["network_destination_restriction"]);
    expect(result.fallback?.recommendedCommand).toBe("aiqt autonomous run");
  });
});
