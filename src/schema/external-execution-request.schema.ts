import { z } from "zod";
import { ExecutionWorkspaceRefSchema } from "./execution-session.schema.js";

const BOUNDED_STRING = z.string().max(2000);
const BOUNDED_ARRAY = z.array(z.string().max(2000)).max(50);

/** M27R §3.4: the exact packet-bounded content exported to the external agent. Never the full agent packet document -- only these fields. */
export const RequestPacketSummarySchema = z
  .object({
    sourcePacketId: z.string().min(1),
    role: BOUNDED_STRING,
    scope: BOUNDED_ARRAY,
    outOfScope: BOUNDED_ARRAY,
    constraints: BOUNDED_ARRAY,
    acceptanceCriteria: BOUNDED_ARRAY,
    validationCommands: BOUNDED_ARRAY,
  })
  .strict();
export type RequestPacketSummary = z.infer<typeof RequestPacketSummarySchema>;

/**
 * M27R §3.4: the generic, vendor-neutral request. Canonical identity is
 * derived from this machine-readable document; any human/agent-readable
 * instructions live in the separate instructions.md bundle file, never
 * inside this JSON.
 */
export const ExternalExecutionRequestSchema = z
  .object({
    protocolVersion: z.literal("aiqt-external-execution-request@1"),
    requestId: z.string().min(1),
    executionSessionId: z.string().min(1),
    sessionClientKey: z.string().min(1),
    workUnitId: z.string().min(1),
    packetId: z.string().min(1),
    workspaceRef: ExecutionWorkspaceRefSchema,
    requestSequence: z.number().int().positive(),
    objective: BOUNDED_STRING,
    packet: RequestPacketSummarySchema,
    expectedResultProtocol: z.literal("aiqt-external-execution-result@1"),
    createdAt: z.string(),
    expiresAt: z.string(),
  })
  .strict();
export type ExternalExecutionRequest = z.infer<typeof ExternalExecutionRequestSchema>;
