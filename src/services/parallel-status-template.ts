import type { ExcludedWorkUnit } from "../workflow/parallel-batch.js";

export interface ParallelStatusData {
  advisory: true;
  activeWorkUnitIds: string[];
  readyWorkUnitIds: string[];
  recommendedBatch: string[];
  manualReviewWorkUnitIds: string[];
  excluded: ExcludedWorkUnit[];
  metadataCoverage: { complete: number; missing: number; invalid: number };
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

  lines.push("Advisory only -- no workspace was created and no Work Unit was started.");

  return lines.join("\n").trimEnd();
}
