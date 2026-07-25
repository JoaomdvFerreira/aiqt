import { z } from "zod";

/**
 * M27R §3.3/§9: opaque, syntactically-namespaced agent identity. Never
 * used to load code, resolve credentials, call a service, or execute a
 * command -- purely descriptive per-request/result metadata. Reuses the
 * exact provider-ID pattern already established for M26's
 * ExecutionProviderRefSchema (src/schema/execution-session.schema.ts) so
 * `external/agent`, `openai/codex`, `anthropic/claude-code`,
 * `github/copilot`, and `custom/local-agent` are all equally valid,
 * unprivileged values.
 */
export const GENERIC_MAX_AGENT_FIELD_CHARS = 256;

export const AgentProviderIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/);

export const ExternalAgentRefSchema = z
  .object({
    providerId: AgentProviderIdSchema,
    product: z.string().max(GENERIC_MAX_AGENT_FIELD_CHARS).optional(),
    version: z.string().max(GENERIC_MAX_AGENT_FIELD_CHARS).optional(),
    externalSessionId: z.string().max(GENERIC_MAX_AGENT_FIELD_CHARS).optional(),
    externalRunId: z.string().max(GENERIC_MAX_AGENT_FIELD_CHARS).optional(),
  })
  .strict();
export type ExternalAgentRef = z.infer<typeof ExternalAgentRefSchema>;
