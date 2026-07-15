import type { WorkUnit } from "../../schema/work-unit.schema.js";
import type { AgentPacketMetadata } from "../../schema/agent-packet.schema.js";
import { renderCheckpointSourceControlGuidance } from "../../workflow/source-control-discipline.js";
import type { RootResolution } from "../../workflow/root-resolution.js";

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

/** Deterministic prompt for aiqt prompt checkpoint (§9, §13.4, M16 §13.4). */
export function renderCheckpointPrompt(
  workUnit: WorkUnit,
  packet: AgentPacketMetadata,
  roots?: RootResolution | null,
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
  // M14 §7/§12: soft reminder only -- does not add new checkpoint schema
  // fields. Reuses the existing filesChanged/notes fields to help audit
  // F053/F054/F055-style deviations after the fact.
  lines.push(
    "If working-directory or component-system guidance was provided in the agent packet, report any deviations (e.g. wrong working directory, hand-rolled primitives instead of the declared component system) in notes, and report filesChanged relative to the implementation root.",
  );
  lines.push("");
  // M15 §11.4/M16 §13.4: source-control and risk reporting, self-attested in
  // existing checkpoint fields only -- no new checkpoint schema fields. Names
  // the resolved implementation root when known.
  lines.push(renderCheckpointSourceControlGuidance(roots?.implementationRoot ?? null));
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
