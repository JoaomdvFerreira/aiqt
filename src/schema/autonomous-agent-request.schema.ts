import { z } from "zod";
import { AutonomousCandidateSchema, AutonomousBudgetsSchema, AutonomousExecutionPolicySchema, CommandClassSchema } from "./autonomous-run.schema.js";

/**
 * M37-WU02 (build spec Sec 7 WU37-02 Scope: "adapter interface; executable/
 * provider configuration; bounded prompt/context; minimal environment
 * projection; ... wall-clock and command budgets; ... failure
 * classification"). Contract-only schemas for the bounded coding-agent
 * adapter -- the request/import pattern, adapted from this repository's
 * only existing real-agent-integration precedent (M27's Claude Code
 * execution adapter, src/schema/execution-adapter-request.schema.ts):
 * AIQT builds a bounded request package to a file; the operator runs
 * their OWN coding-agent tool manually, in an environment they control
 * and are responsible for confining; AIQT later imports the resulting
 * response file. AIQT itself never spawns the agent process -- see
 * docs/engineering/m37-wu02-agent-adapter-design-note.md for why this
 * was chosen over a live-spawned subprocess (a live spawn cannot satisfy
 * "adapter cannot escape worktree" with Node's child_process alone, since
 * `cwd` is a starting directory, not a filesystem jail).
 *
 * "Exactly one provider" (build spec Sec 5 Out of Scope: "arbitrary
 * provider plugins"): AUTONOMOUS_AGENT_PROVIDER_ID is the one and only
 * fixed provider identity this schema recognizes, mirroring
 * adapter-registry.ts's "no dynamic adapter loading... a future adapter
 * requires a separate reviewed milestone" principle. Deliberately a new,
 * dedicated identity (not reused from adapter-registry.ts's
 * GENERIC_ADAPTER_ID/CLAUDE_ADAPTER_ID) -- those belong to the unrelated
 * M26/M27 execution-session domain, and conflating the two would blur
 * which system's request lifecycle a given id belongs to.
 */
const MAX_BOUNDED_TEXT_CHARS = 4000;
const MAX_BOUNDED_KEY_CHARS = 200;
const MAX_LIST_ITEMS = 50;

export const AUTONOMOUS_AGENT_PROVIDER_ID = "external-coding-agent-manual@1" as const;
export const AutonomousAgentProviderIdSchema = z.literal(AUTONOMOUS_AGENT_PROVIDER_ID);

/** Bounded default request lifetime -- mirrors M27's ADAPTER_REQUEST_EXPIRY_SECONDS (execution-adapter-claude-code-request.command.ts). A request older than this can never be imported, only expired/cancelled. */
export const AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS = 86400;

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const AutonomousAgentRequestStatusSchema = z.enum(["pending", "imported", "expired", "cancelled"]);
export type AutonomousAgentRequestStatus = z.infer<typeof AutonomousAgentRequestStatusSchema>;

/**
 * Minimal environment projection (build spec Sec 6.7 "Security and
 * privacy": "Environment projection must be explicit and minimal"; "must
 * not receive... unrelated environment variables"). An explicit allowlist
 * of variable NAMES the operator is told it is safe to expose to their
 * own coding-agent tool -- never actual values, and never a full
 * process.env projection. Default is empty: no environment variable is
 * assumed safe to expose unless the operator's own policy says so.
 */
export const AutonomousAgentEnvironmentProjectionSchema = z.array(z.string().min(1).max(MAX_BOUNDED_KEY_CHARS)).max(MAX_LIST_ITEMS).default([]);

/**
 * The bounded prompt/context package (build spec: "bounded prompt/
 * context"). Every field here is already-validated M36 data (candidate,
 * budgets, policy) plus explicit instructions text -- never raw
 * repository content, never a secret, never an unbounded transcript.
 */
export const AutonomousAgentPromptPackageSchema = z
  .object({
    objective: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    acceptanceCriteria: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
    constraints: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
    instructions: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
  })
  .strict();
export type AutonomousAgentPromptPackage = z.infer<typeof AutonomousAgentPromptPackageSchema>;

export const AutonomousAgentRequestSchema = z
  .object({
    requestId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    runId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    providerId: AutonomousAgentProviderIdSchema,
    status: AutonomousAgentRequestStatusSchema,
    candidate: AutonomousCandidateSchema,
    promptPackage: AutonomousAgentPromptPackageSchema,
    budgets: AutonomousBudgetsSchema,
    policy: AutonomousExecutionPolicySchema,
    allowedCommandClasses: z.array(CommandClassSchema).max(MAX_LIST_ITEMS),
    environmentProjection: AutonomousAgentEnvironmentProjectionSchema,
    requestDigest: Sha256DigestSchema,
    createdAt: z.string().min(1),
    expiresAt: z.string().min(1),
    importedAt: z.string().min(1).optional(),
    cancelledAt: z.string().min(1).optional(),
  })
  .strict();
export type AutonomousAgentRequest = z.infer<typeof AutonomousAgentRequestSchema>;

/**
 * The response the operator's own coding-agent tool produces, which AIQT
 * later imports. `commandsProposed` mirrors WU36-03's
 * AutonomousCommandRequest shape ({command, args}) -- these are PROPOSED
 * commands only; importing a response never executes anything (import is
 * a pure parse + validate + record operation, see
 * autonomous-agent-response-import-service.ts). `rawResponseDigest`
 * binds the imported record to the exact bytes imported, without
 * persisting the raw content itself (same "identity + digest metadata
 * only, never raw provider transcript content" principle as M27's
 * ExecutionAdapterRequestSchema).
 */
export const AutonomousAgentProposedCommandSchema = z
  .object({
    command: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    args: z.array(z.string().max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
  })
  .strict();
export type AutonomousAgentProposedCommand = z.infer<typeof AutonomousAgentProposedCommandSchema>;

export const AutonomousAgentResponseSchema = z
  .object({
    requestId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    providerId: AutonomousAgentProviderIdSchema,
    commandsProposed: z.array(AutonomousAgentProposedCommandSchema).max(MAX_LIST_ITEMS),
    notes: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  })
  .strict();
export type AutonomousAgentResponse = z.infer<typeof AutonomousAgentResponseSchema>;
