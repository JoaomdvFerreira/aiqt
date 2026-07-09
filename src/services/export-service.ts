import { join } from "node:path";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewResult } from "./review-service.js";
import {
  renderProjectPlan,
  renderStatusReport,
  renderTechnicalSpec,
  renderAgentPacketExport,
} from "./export-templates.js";

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

export function resolveTargets(target: ExportTarget): ConcreteExportTarget[] {
  return target === "all" ? [...CONCRETE_EXPORT_TARGETS] : [target];
}

function exportFileName(target: ConcreteExportTarget, state: StateModel): string {
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

/** §11/13 step 7: status-report, project-plan, technical-spec are always
 * available after initialization; agent-packet requires lastAgentPacket. */
export function checkTargetAvailability(
  target: ConcreteExportTarget,
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
  target: ConcreteExportTarget,
  project: ProjectModel,
  state: StateModel,
  review: ReviewResult,
): string {
  switch (target) {
    case "project-plan":
      return renderProjectPlan(project, state);
    case "status-report":
      return renderStatusReport(project, state, review);
    case "technical-spec":
      return renderTechnicalSpec(project, state);
    case "agent-packet":
      return renderAgentPacketExport(state);
  }
}

export interface ExportDocumentPlan {
  target: ConcreteExportTarget;
  path: string;
  relativePath: string;
  available: boolean;
  skipReason: string | null;
  content: string | null;
}

/** Build the plan (availability + rendered content) for each requested target. */
export function planExportDocuments(params: {
  targets: readonly ConcreteExportTarget[];
  project: ProjectModel;
  state: StateModel;
  review: ReviewResult;
  exportsDir: string;
}): ExportDocumentPlan[] {
  const { targets, project, state, review, exportsDir } = params;
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
        ? renderExportDocument(target, project, state, review)
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
