import { describe, it, expect } from "vitest";
import { validateSandboxEnvironmentAllowlist } from "../../src/workflow/sandbox-environment-policy.js";
import { DEFAULT_SANDBOX_ENVIRONMENT_POLICY } from "../../src/schema/sandbox-backend.schema.js";

describe("M38-WU01 sandbox-environment-policy: environment allowlist validation", () => {
  it("the default policy (empty allowlist) is valid -- no wholesale host inheritance", () => {
    const result = validateSandboxEnvironmentAllowlist(DEFAULT_SANDBOX_ENVIRONMENT_POLICY);
    expect(result.ok).toBe(true);
    expect(result.blockedNames).toEqual([]);
  });

  it("accepts ordinary, non-secret-shaped variable names", () => {
    const result = validateSandboxEnvironmentAllowlist({ allowedVariableNames: ["NODE_ENV", "LANG", "TZ"] });
    expect(result.ok).toBe(true);
  });

  it.each([
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AZURE_CLIENT_SECRET",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GIT_ASKPASS",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "DOCKER_AUTH_CONFIG",
    "CI",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "STRIPE_SECRET_KEY",
    "SOME_SERVICE_PASSWORD",
  ])("blocks %s by default", (name) => {
    const result = validateSandboxEnvironmentAllowlist({ allowedVariableNames: [name] });
    expect(result.ok).toBe(false);
    expect(result.blockedNames.map((b) => b.name)).toContain(name);
  });

  it("reports every blocked name, not just the first, when multiple are present", () => {
    const result = validateSandboxEnvironmentAllowlist({ allowedVariableNames: ["NODE_ENV", "AWS_SECRET_ACCESS_KEY", "SSH_AUTH_SOCK"] });
    expect(result.ok).toBe(false);
    expect(result.blockedNames.map((b) => b.name).sort()).toEqual(["AWS_SECRET_ACCESS_KEY", "SSH_AUTH_SOCK"]);
  });
});
