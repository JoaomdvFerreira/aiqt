import type { ExcludedWorkUnit } from "../workflow/parallel-batch.js";
import type { WorkspaceReadinessSummary } from "../workflow/workspace-readiness-advisory.js";

export interface ParallelStatusData {
  advisory: true;
  activeWorkUnitIds: string[];
  readyWorkUnitIds: string[];
  recommendedBatch: string[];
  manualReviewWorkUnitIds: string[];
  excluded: ExcludedWorkUnit[];
  metadataCoverage: { complete: number; missing: number; invalid: number };
  /** M25 §19: bounded physical-workspace readiness facts, scoped to readyWorkUnitIds. Never changes M24 logical eligibility. */
  workspaceReadiness: WorkspaceReadinessSummary;
}

function bulletList(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

/**
 * M24 §11.1: the required minimum sections, in order, plus the mandatory
 * advisory disclaimer. Deterministic and stable so it is safe to snapshot
 * in tests.
 */
export function renderParallelStatusText(data: ParallelStatusData): string {
  const lines: string[] = [];
  lines.push("# Parallel execution advisory", "");

  lines.push("## Active Work Units", "");
  lines.push(bulletList(data.activeWorkUnitIds), "");

  lines.push("## Recommended batch", "");
  lines.push(bulletList(data.recommendedBatch), "");

  lines.push("## Manual review", "");
  lines.push(bulletList(data.manualReviewWorkUnitIds), "");

  lines.push("## Excluded Work Units and reasons", "");
  if (data.excluded.length === 0) {
    lines.push("- None.");
  } else {
    for (const entry of data.excluded) {
      lines.push(`- ${entry.workUnitId}: ${entry.reasons.join(", ")}`);
    }
  }
  lines.push("");

  lines.push("## Metadata coverage", "");
  lines.push(
    bulletList([
      `complete: ${data.metadataCoverage.complete}`,
      `missing: ${data.metadataCoverage.missing}`,
      `invalid: ${data.metadataCoverage.invalid}`,
    ]),
    "",
  );

  lines.push("## Workspace readiness", "");
  lines.push(
    bulletList([
      `prepared: ${data.workspaceReadiness.prepared}`,
      `unprepared: ${data.workspaceReadiness.unprepared}`,
      `recoveryRequired: ${data.workspaceReadiness.recoveryRequired}`,
      `dirty: ${data.workspaceReadiness.dirty}`,
      `drifted: ${data.workspaceReadiness.drifted}`,
    ]),
    "",
  );

  lines.push("Advisory only -- no workspace was created and no Work Unit was started.");

  return lines.join("\n").trimEnd();
}
