import type { WorkUnit } from "../../schema/work-unit.schema.js";
import type { AgentPacketMetadata } from "../../schema/agent-packet.schema.js";

function listOrNone(items: readonly string[]): string {
  return items.length > 0 ? items.join(", ") : "(none)";
}

const CHECKPOINT_JSON_SHAPE = {
  summary: "...",
  completed: ["..."],
  notCompleted: [],
  filesChanged: ["..."],
  validationResult: "passed",
  acceptanceCriteriaResult: "passed",
  validationCommands: [{ command: "...", result: "passed", summary: "..." }],
  acceptanceCriteria: [{ criterion: "...", result: "passed", evidence: "..." }],
  issues: [],
  targetStatus: "done",
  notes: [],
};

/** Deterministic prompt for aiqt prompt checkpoint (§9, §13.4). */
export function renderCheckpointPrompt(
  workUnit: WorkUnit,
  packet: AgentPacketMetadata,
): string {
  const lines: string[] = [];
  lines.push(
    "You are helping create an AIQT checkpoint input from a coding agent's implementation report.",
  );
  lines.push("Return JSON only. Do not wrap the JSON in markdown.");
  lines.push("");
  lines.push(`Work unit: ${workUnit.id} - ${workUnit.title}`);
  lines.push(`Objective: ${workUnit.objective}`);
  lines.push(`Acceptance criteria: ${listOrNone(workUnit.acceptanceCriteria)}`);
  lines.push(`Validation commands: ${listOrNone(workUnit.validationCommands)}`);
  lines.push("");
  lines.push(`Packet ID: ${packet.id}`);
  lines.push(`Packet created at: ${packet.createdAt}`);
  lines.push("");
  lines.push("Paste the coding agent's implementation report below this line:");
  lines.push("<paste the agent's report here>");
  lines.push("");
  lines.push("Create a checkpoint JSON with this shape:");
  lines.push(JSON.stringify(CHECKPOINT_JSON_SHAPE, null, 2));
  lines.push("");
  lines.push("Preferred agent path:");
  lines.push("Pipe the JSON directly into:");
  lines.push("aiqt import checkpoint --stdin");
  lines.push("");
  lines.push("Optional human-review path:");
  lines.push("Save the JSON under .aiqt/inputs/ and run:");
  lines.push("aiqt import checkpoint --from-file .aiqt/inputs/checkpoint.json");
  return lines.join("\n");
}
