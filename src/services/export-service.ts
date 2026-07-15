import { join } from "node:path";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewResult } from "./review-service.js";
import { buildManageReport } from "./manage-service.js";
import {
  renderProjectPlan,
  renderStatusReport,
  renderTechnicalSpec,
  renderAgentPacketExport,
  renderFinalReview,
} from "./export-templates.js";
import { findAgentPacketAuditMetadata } from "../state/runlog-store.js";

export type ConcreteExportTarget =
  | "project-plan"
  | "status-report"
  | "technical-spec"
  | "agent-packet";
export type ExportTarget = ConcreteExportTarget | "all";

export const CONCRETE_EXPORT_TARGETS: readonly ConcreteExportTarget[] = [
  "project-plan",
  "status-report",
  "technical-spec",
  "agent-packet",
];

const ALL_EXPORT_TARGETS: readonly ExportTarget[] = [...CONCRETE_EXPORT_TARGETS, "all"];

export function isValidExportTarget(value: string): value is ExportTarget {
  return (ALL_EXPORT_TARGETS as readonly string[]).includes(value);
}

/**
 * M10 §8.1: final-review.md is generated only as a side effect of
 * `aiqt export all`. It is deliberately excluded from `ConcreteExportTarget`
 * / `ExportTarget` (the publicly selectable target enum), so
 * `aiqt export final-review` is rejected as an unsupported target -- adding
 * it as a standalone target would require extending the target enum, CLI
 * help, validation, and tests, which is explicitly out of scope for M10.
 */
export type InternalExportTarget = ConcreteExportTarget | "final-review";
const FINAL_REVIEW_TARGET = "final-review" as const;

export function resolveTargets(target: ExportTarget): InternalExportTarget[] {
  return target === "all" ? [...CONCRETE_EXPORT_TARGETS, FINAL_REVIEW_TARGET] : [target];
}

function exportFileName(target: InternalExportTarget, state: StateModel): string {
  if (target === "agent-packet") {
    const packetId = state.lastAgentPacket?.id ?? "unknown";
    return `agent-packet-${packetId}.md`;
  }
  return `${target}.md`;
}

export interface TargetAvailability {
  available: boolean;
  reason: string | null;
}

/** §11/13 step 7: status-report, project-plan, technical-spec, final-review
 * are always available after initialization; agent-packet requires
 * lastAgentPacket. */
export function checkTargetAvailability(
  target: InternalExportTarget,
  state: StateModel,
): TargetAvailability {
  if (target === "agent-packet") {
    return state.lastAgentPacket
      ? { available: true, reason: null }
      : { available: false, reason: "state.lastAgentPacket is not set." };
  }
  return { available: true, reason: null };
}

function renderExportDocument(
  target: InternalExportTarget,
  project: ProjectModel,
  state: StateModel,
  review: ReviewResult,
  runlogPath: string,
): string {
  switch (target) {
    case "project-plan":
      return renderProjectPlan(project, state);
    case "status-report":
      return renderStatusReport(project, state, review);
    case "technical-spec":
      return renderTechnicalSpec(project, state);
    case "agent-packet": {
      // M14 §11.3: read the latest valid agent_packet.created audit
      // metadata for the exported packet from runlog history when
      // available; degrade gracefully (null) for older packets.
      const auditMetadata = state.lastAgentPacket
        ? findAgentPacketAuditMetadata(runlogPath, state.lastAgentPacket.id)
        : null;
      return renderAgentPacketExport(state, auditMetadata);
    }
    case "final-review":
      return renderFinalReview(state, review, buildManageReport(project, state, review));
  }
}

export interface ExportDocumentPlan {
  target: InternalExportTarget;
  path: string;
  relativePath: string;
  available: boolean;
  skipReason: string | null;
  content: string | null;
}

/** Build the plan (availability + rendered content) for each requested target. */
export function planExportDocuments(params: {
  targets: readonly InternalExportTarget[];
  project: ProjectModel;
  state: StateModel;
  review: ReviewResult;
  exportsDir: string;
  runlogPath: string;
}): ExportDocumentPlan[] {
  const { targets, project, state, review, exportsDir, runlogPath } = params;
  return targets.map((target) => {
    const availability = checkTargetAvailability(target, state);
    const fileName = exportFileName(target, state);
    const path = join(exportsDir, fileName);
    const relativePath = `.aiqt/exports/${fileName}`;
    return {
      target,
      path,
      relativePath,
      available: availability.available,
      skipReason: availability.reason,
      content: availability.available
        ? renderExportDocument(target, project, state, review, runlogPath)
        : null,
    };
  });
}

export interface ExportResultData {
  target: ExportTarget;
  format: "markdown";
  dryRun: boolean;
  documents: Array<{
    target: string;
    path: string;
    wouldWrite: boolean;
    written: boolean;
    skipped: boolean;
    skipReason: string | null;
  }>;
}

export function buildExportResultData(params: {
  target: ExportTarget;
  dryRun: boolean;
  plans: readonly ExportDocumentPlan[];
}): ExportResultData {
  return {
    target: params.target,
    format: "markdown",
    dryRun: params.dryRun,
    documents: params.plans.map((p) => ({
      target: p.target,
      path: p.relativePath,
      wouldWrite: p.available,
      written: p.available && !params.dryRun,
      skipped: !p.available,
      skipReason: p.skipReason,
    })),
  };
}
