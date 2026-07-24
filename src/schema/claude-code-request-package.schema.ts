import { z } from "zod";
import { AdapterIdSchema, AdapterRequestModeSchema } from "./execution-adapter-request.schema.js";
import { MAX_BOUNDED_TEXT_CHARS } from "./execution-session.schema.js";

/**
 * M27 §3.3: the fixed, reviewed Claude Code command template. Only these
 * flags are ever generated -- no arbitrary user-supplied argument, model
 * selection, MCP/plugin flag, or permission-bypass flag exists anywhere in
 * this contract. `--session-id` is used for `start`; `--resume` is used
 * for `resume`. `--continue` is deliberately never used (M27-R10): the
 * generated/persisted external session UUID is always exact.
 */
export const CLAUDE_CODE_EXECUTABLE = "claude" as const;
export const CLAUDE_CODE_FIXED_FLAGS = ["-p", "--output-format", "stream-json", "--verbose"] as const;

export function buildClaudeCodeCommandArguments(mode: "start" | "resume", externalSessionId: string): string[] {
  const sessionFlag = mode === "start" ? "--session-id" : "--resume";
  return [...CLAUDE_CODE_FIXED_FLAGS, sessionFlag, externalSessionId];
}

export const RequestPromptSchema = z
  .object({
    boundedText: z.literal(true),
    source: z.literal("current_agent_packet"),
  })
  .strict();

export const RequestCommandTemplateSchema = z
  .object({
    executable: z.literal(CLAUDE_CODE_EXECUTABLE),
    arguments: z.array(z.string()),
  })
  .strict();

export const RequestOutputInstructionsSchema = z
  .object({
    format: z.literal("stream-json"),
    capture: z.literal("file_or_pipe_to_import"),
  })
  .strict();

/**
 * M27 §3.3: the generated, non-canonical, never-executed request export.
 * Not persisted to state.json -- state.json holds only the bounded
 * ExecutionAdapterRequest metadata record; this full package is emitted
 * as command output (and optionally to --output <path>) each time it is
 * requested.
 */
export const ClaudeCodeExecutionRequestSchema = z
  .object({
    contractVersion: z.literal("claude-code-stream-json-request@1"),
    requestId: z.string().min(1),
    adapterId: AdapterIdSchema,
    executionSessionId: z.string().min(1),
    workUnitId: z.string().min(1),
    packetId: z.string().min(1),
    workspacePath: z.string().nullable(),
    externalSessionId: z.string().uuid(),
    mode: AdapterRequestModeSchema,
    prompt: RequestPromptSchema,
    commandTemplate: RequestCommandTemplateSchema,
    outputInstructions: RequestOutputInstructionsSchema,
    createdAt: z.string(),
    expiresAt: z.string(),
    userActionRequired: z.array(z.string().max(MAX_BOUNDED_TEXT_CHARS)),
  })
  .strict();
export type ClaudeCodeExecutionRequest = z.infer<typeof ClaudeCodeExecutionRequestSchema>;
