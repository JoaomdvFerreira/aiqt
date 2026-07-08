import type { WorkflowAction } from "../core/output/result.js";

/** Canonical CLI command strings mapped to workflow actions. */
export const WorkflowCommand: Record<string, string> = {
  init: "aiqt init",
  update: "aiqt update",
  plan: "aiqt plan",
  next: "aiqt next",
  status: "aiqt status",
};

export function commandForAction(action: WorkflowAction): string | null {
  return WorkflowCommand[action] ?? null;
}
