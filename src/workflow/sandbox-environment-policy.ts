import type { SandboxEnvironmentPolicy } from "../schema/sandbox-backend.schema.js";

/**
 * M38-WU01 (build spec Sec 6 "Environment policy": "Only explicit
 * variables may be projected. Do not inherit the host environment
 * wholesale. Blocked by default: cloud credentials; Git credentials;
 * SSH agent sockets; registry tokens; API keys; CI secrets"). Pure name
 * pattern matching only -- this module never reads a real environment
 * variable's value, never sets one, and never inherits `process.env`.
 * `SandboxEnvironmentPolicySchema` itself already has no field capable
 * of expressing wholesale inheritance (schema.ts's own comment); this
 * module is the second, independent layer: even an explicit allowlist
 * entry naming a blocked pattern is rejected.
 */
const BLOCKED_ENV_VAR_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /^AWS_/i, label: "AWS cloud credentials" },
  { pattern: /^AZURE_/i, label: "Azure cloud credentials" },
  { pattern: /^GOOGLE_(APPLICATION_)?CREDENTIALS/i, label: "Google Cloud credentials" },
  { pattern: /^GCP_/i, label: "Google Cloud credentials" },
  { pattern: /^GIT(HUB|LAB)?_TOKEN$/i, label: "Git hosting token" },
  { pattern: /^GH_TOKEN$/i, label: "GitHub CLI token" },
  { pattern: /^GIT_(SSH|ASKPASS|CREDENTIAL)/i, label: "Git credential/SSH configuration" },
  { pattern: /^SSH_AUTH_SOCK$/i, label: "SSH agent socket" },
  { pattern: /^SSH_AGENT_PID$/i, label: "SSH agent process" },
  { pattern: /^NPM_TOKEN$/i, label: "npm registry token" },
  { pattern: /^NODE_AUTH_TOKEN$/i, label: "npm/registry auth token" },
  { pattern: /^DOCKER_(AUTH|PASSWORD|TOKEN)/i, label: "Docker registry credentials" },
  { pattern: /(^|_)(SECRET|PASSWORD|CREDENTIALS?|API_KEY|TOKEN)(_|$)/i, label: "generic secret-shaped variable name" },
  { pattern: /^CI$/i, label: "CI environment indicator" },
  { pattern: /^ANTHROPIC_API_KEY$/i, label: "Anthropic API key" },
  { pattern: /^OPENAI_API_KEY$/i, label: "OpenAI API key" },
];

export interface SandboxEnvironmentAllowlistValidation {
  ok: boolean;
  blockedNames: { name: string; label: string }[];
}

export function validateSandboxEnvironmentAllowlist(policy: SandboxEnvironmentPolicy): SandboxEnvironmentAllowlistValidation {
  const blockedNames: { name: string; label: string }[] = [];
  for (const name of policy.allowedVariableNames) {
    for (const { pattern, label } of BLOCKED_ENV_VAR_PATTERNS) {
      if (pattern.test(name)) {
        blockedNames.push({ name, label });
        break;
      }
    }
  }
  return { ok: blockedNames.length === 0, blockedNames };
}
