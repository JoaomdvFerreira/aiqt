import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { dedupeAppend, deepEqual } from "../core/util/merge.js";
import { nextId } from "../state/ids.js";
import { isPlanningContextReady } from "../workflow/planning-readiness.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type {
  Requirement,
  Decision,
  Assumption,
  Risk,
  OpenQuestion,
} from "../schema/common.schema.js";
import type {
  UpdateInput,
  RequirementInput,
  DecisionInput,
  AssumptionInput,
  RiskInput,
  OpenQuestionInput,
} from "../schema/update-input.schema.js";

// ---------------------------------------------------------------------------
// Input precedence: merge a --from-file patch with direct CLI flags.
// ---------------------------------------------------------------------------

export interface UpdateFlagInput {
  objective?: string;
  targetUsers?: string[];
  agent?: string;
  repositoryPath?: string;
}

/**
 * Combine a --from-file patch with direct flags using M2's deterministic
 * precedence: file loaded first, flags applied second. Scalar project fields
 * from flags override file values; targetUsers append-and-dedupe instead of
 * replacing, since M2 has no destructive replace semantics.
 */
export function mergeFileAndFlagPatches(
  filePatch: UpdateInput | undefined,
  flags: UpdateFlagInput,
): UpdateInput {
  const base: UpdateInput = filePatch ? { ...filePatch } : {};
  const project = { ...(base.project ?? {}) };

  if (flags.objective !== undefined && flags.objective.trim() !== "") {
    project.objective = flags.objective;
  }
  if (flags.agent !== undefined && flags.agent.trim() !== "") {
    project.preferredAgent = flags.agent;
  }
  if (flags.repositoryPath !== undefined && flags.repositoryPath.trim() !== "") {
    project.existingRepositoryPath = flags.repositoryPath;
  }
  if (flags.targetUsers !== undefined && flags.targetUsers.length > 0) {
    const cleaned = flags.targetUsers.filter((u) => u.trim() !== "");
    if (cleaned.length > 0) {
      project.targetUsers = dedupeAppend(project.targetUsers ?? [], cleaned);
    }
  }

  if (Object.keys(project).length > 0) {
    base.project = project;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Field merge helpers for record updates.
// ---------------------------------------------------------------------------

function setStringField(existing: string, incoming: string | undefined): string {
  if (incoming === undefined || incoming.trim() === "") return existing;
  return incoming;
}

function setNullableStringField(
  existing: string | null,
  incoming: string | null | undefined,
): string | null {
  if (incoming === undefined) return existing;
  if (incoming === null) return null;
  if (incoming.trim() === "") return existing;
  return incoming;
}

function setEnumField<T>(existing: T, incoming: T | undefined): T {
  return incoming === undefined ? existing : incoming;
}

function unknownIdError(recordTypeLabel: string, id: string): AiqtError {
  return new AiqtError(
    `Unknown ${recordTypeLabel} id "${id}" in update input.`,
    ExitCode.InvalidInput,
    {
      id: "UPDATE-UNKNOWN-ID",
      severity: "critical",
      area: "input",
      message: `No existing ${recordTypeLabel} record with id "${id}".`,
      agentCanFix: false,
    },
  );
}

function missingCreateFieldsError(
  recordTypeLabel: string,
  fields: string[],
): AiqtError {
  const message = `A new ${recordTypeLabel} requires: ${fields.join(", ")}.`;
  return new AiqtError(message, ExitCode.InvalidInput, {
    id: "UPDATE-MISSING-CREATE-FIELDS",
    severity: "critical",
    area: "input",
    message,
    agentCanFix: false,
  });
}

// ---------------------------------------------------------------------------
// Generic identity-based array merge (id/clientKey resolution + idempotency).
// ---------------------------------------------------------------------------

interface MergeArraySectionResult<TCanonical> {
  records: TCanonical[];
  createdIds: string[];
  updatedIds: string[];
  changed: boolean;
}

function mergeArraySection<
  TInput extends { id?: string; clientKey?: string },
  TCanonical extends { id: string; clientKey?: string },
>(params: {
  existing: TCanonical[];
  inputs: TInput[] | undefined;
  idPrefix: string;
  idSeparator: string;
  recordTypeLabel: string;
  createFn: (input: TInput, id: string, timestamp: string) => TCanonical;
  updateFn: (record: TCanonical, input: TInput) => TCanonical;
  timestamp: string;
}): MergeArraySectionResult<TCanonical> {
  const {
    existing,
    inputs,
    idPrefix,
    idSeparator,
    recordTypeLabel,
    createFn,
    updateFn,
    timestamp,
  } = params;

  if (!inputs || inputs.length === 0) {
    return { records: existing, createdIds: [], updatedIds: [], changed: false };
  }

  const records = [...existing];
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  let changed = false;
  let knownIds = records.map((r) => r.id);

  for (const input of inputs) {
    let matchIndex = -1;

    if (input.id !== undefined) {
      matchIndex = records.findIndex((r) => r.id === input.id);
      if (matchIndex === -1) {
        throw unknownIdError(recordTypeLabel, input.id);
      }
    } else if (input.clientKey !== undefined) {
      matchIndex = records.findIndex((r) => r.clientKey === input.clientKey);
    }

    if (matchIndex >= 0) {
      const before = records[matchIndex];
      const merged = updateFn(before, input);
      if (!deepEqual(before, merged)) {
        records[matchIndex] = { ...merged, updatedAt: timestamp };
        updatedIds.push(before.id);
        changed = true;
      }
    } else {
      const newId = nextId(idPrefix, knownIds, idSeparator);
      knownIds = [...knownIds, newId];
      const created = createFn(input, newId, timestamp);
      records.push(created);
      createdIds.push(newId);
      changed = true;
    }
  }

  return { records, createdIds, updatedIds, changed };
}

// ---------------------------------------------------------------------------
// Per-record-type create/update functions.
// ---------------------------------------------------------------------------

function createRequirement(
  input: RequirementInput,
  id: string,
  timestamp: string,
): Requirement {
  if (!input.title?.trim() || !input.description?.trim()) {
    throw missingCreateFieldsError("requirement", ["title", "description"]);
  }
  return {
    id,
    clientKey: input.clientKey,
    title: input.title,
    description: input.description,
    priority: input.priority ?? "medium",
    type: input.type ?? "functional",
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    status: input.status ?? "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateRequirement(
  existing: Requirement,
  input: RequirementInput,
): Requirement {
  return {
    ...existing,
    clientKey: input.clientKey ?? existing.clientKey,
    title: setStringField(existing.title, input.title),
    description: setStringField(existing.description, input.description),
    priority: setEnumField(existing.priority, input.priority),
    type: setEnumField(existing.type, input.type),
    acceptanceCriteria:
      input.acceptanceCriteria && input.acceptanceCriteria.length > 0
        ? dedupeAppend(existing.acceptanceCriteria, input.acceptanceCriteria)
        : existing.acceptanceCriteria,
    status: setEnumField(existing.status, input.status),
  };
}

function createDecision(
  input: DecisionInput,
  id: string,
  timestamp: string,
): Decision {
  if (!input.decision?.trim()) {
    throw missingCreateFieldsError("decision", ["decision"]);
  }
  return {
    id,
    clientKey: input.clientKey,
    decision: input.decision,
    reason: input.reason ?? "",
    impact: input.impact ?? "",
    status: input.status ?? "decided",
    date: input.date && input.date.trim() !== "" ? input.date : timestamp.slice(0, 10),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateDecision(existing: Decision, input: DecisionInput): Decision {
  return {
    ...existing,
    clientKey: input.clientKey ?? existing.clientKey,
    decision: setStringField(existing.decision, input.decision),
    reason: setStringField(existing.reason, input.reason),
    impact: setStringField(existing.impact, input.impact),
    status: setEnumField(existing.status, input.status),
    date: setStringField(existing.date, input.date),
  };
}

function createAssumption(
  input: AssumptionInput,
  id: string,
  timestamp: string,
): Assumption {
  if (!input.statement?.trim()) {
    throw missingCreateFieldsError("assumption", ["statement"]);
  }
  return {
    id,
    clientKey: input.clientKey,
    statement: input.statement,
    reason: input.reason ?? null,
    source: input.source ?? "human",
    status: input.status ?? "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateAssumption(
  existing: Assumption,
  input: AssumptionInput,
): Assumption {
  return {
    ...existing,
    clientKey: input.clientKey ?? existing.clientKey,
    statement: setStringField(existing.statement, input.statement),
    reason: setNullableStringField(existing.reason, input.reason),
    source: setEnumField(existing.source, input.source),
    status: setEnumField(existing.status, input.status),
  };
}

function createRisk(input: RiskInput, id: string, timestamp: string): Risk {
  if (!input.title?.trim() || !input.description?.trim()) {
    throw missingCreateFieldsError("risk", ["title", "description"]);
  }
  return {
    id,
    clientKey: input.clientKey,
    title: input.title,
    description: input.description,
    severity: input.severity ?? "medium",
    mitigation: input.mitigation ?? null,
    status: input.status ?? "open",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateRisk(existing: Risk, input: RiskInput): Risk {
  return {
    ...existing,
    clientKey: input.clientKey ?? existing.clientKey,
    title: setStringField(existing.title, input.title),
    description: setStringField(existing.description, input.description),
    severity: setEnumField(existing.severity, input.severity),
    mitigation: setNullableStringField(existing.mitigation, input.mitigation),
    status: setEnumField(existing.status, input.status),
  };
}

function createOpenQuestion(
  input: OpenQuestionInput,
  id: string,
  timestamp: string,
): OpenQuestion {
  if (!input.question?.trim()) {
    throw missingCreateFieldsError("open question", ["question"]);
  }
  return {
    id,
    clientKey: input.clientKey,
    question: input.question,
    impact: input.impact ?? "medium",
    status: input.status ?? "open",
    answer: input.answer ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateOpenQuestion(
  existing: OpenQuestion,
  input: OpenQuestionInput,
): OpenQuestion {
  return {
    ...existing,
    clientKey: input.clientKey ?? existing.clientKey,
    question: setStringField(existing.question, input.question),
    impact: setEnumField(existing.impact, input.impact),
    status: setEnumField(existing.status, input.status),
    answer: setNullableStringField(existing.answer, input.answer),
  };
}

// ---------------------------------------------------------------------------
// Top-level patch application.
// ---------------------------------------------------------------------------

export interface ApplyUpdateResult {
  project: ProjectModel;
  state: StateModel;
  projectChanged: boolean;
  stateChanged: boolean;
  changedFields: string[];
  changedSections: string[];
  createdRecordIds: string[];
  updatedRecordIds: string[];
  createdDecisionIds: string[];
  planningContextReady: boolean;
}

/**
 * Apply a validated UpdateInput patch to the current project/state models.
 * Pure and side-effect free: callers are responsible for writing files and
 * appending runlog events based on the returned change flags.
 */
export function applyUpdatePatch(
  project: ProjectModel,
  state: StateModel,
  patch: UpdateInput,
  timestamp: string,
): ApplyUpdateResult {
  const changedFields = new Set<string>();
  const changedSections = new Set<string>();

  // ---- project scalar fields ----
  const projectFields = { ...project.project };

  if (
    patch.project?.objective !== undefined &&
    patch.project.objective.trim() !== "" &&
    projectFields.objective !== patch.project.objective
  ) {
    projectFields.objective = patch.project.objective;
    changedFields.add("project.objective");
  }

  if (patch.project?.targetUsers !== undefined && patch.project.targetUsers.length > 0) {
    const merged = dedupeAppend(projectFields.targetUsers, patch.project.targetUsers);
    if (!deepEqual(merged, projectFields.targetUsers)) {
      projectFields.targetUsers = merged;
      changedFields.add("project.targetUsers");
    }
  }

  if (patch.project?.preferredAgent !== undefined) {
    if (patch.project.preferredAgent === null) {
      if (projectFields.preferredAgent !== null) {
        projectFields.preferredAgent = null;
        changedFields.add("project.preferredAgent");
      }
    } else if (
      patch.project.preferredAgent.trim() !== "" &&
      projectFields.preferredAgent !== patch.project.preferredAgent
    ) {
      projectFields.preferredAgent = patch.project.preferredAgent;
      changedFields.add("project.preferredAgent");
    }
  }

  if (patch.project?.existingRepositoryPath !== undefined) {
    if (patch.project.existingRepositoryPath === null) {
      if (projectFields.existingRepositoryPath !== null) {
        projectFields.existingRepositoryPath = null;
        changedFields.add("project.existingRepositoryPath");
      }
    } else if (
      patch.project.existingRepositoryPath.trim() !== "" &&
      projectFields.existingRepositoryPath !== patch.project.existingRepositoryPath
    ) {
      projectFields.existingRepositoryPath = patch.project.existingRepositoryPath;
      changedFields.add("project.existingRepositoryPath");
    }
  }

  if (
    changedFields.has("project.objective") ||
    changedFields.has("project.targetUsers") ||
    changedFields.has("project.preferredAgent") ||
    changedFields.has("project.existingRepositoryPath")
  ) {
    changedSections.add("project");
  }

  // ---- context ----
  const context = { ...project.context };
  const contextFieldMap: Array<[keyof typeof context, string[] | undefined]> = [
    ["constraints", patch.context?.constraints],
    ["nonGoals", patch.context?.nonGoals],
    ["technologyPreferences", patch.context?.technologyPreferences],
    ["businessRules", patch.context?.businessRules],
    ["architectureNotes", patch.context?.architectureNotes],
  ];
  for (const [field, incoming] of contextFieldMap) {
    if (incoming !== undefined && incoming.length > 0) {
      const merged = dedupeAppend(context[field], incoming);
      if (!deepEqual(merged, context[field])) {
        context[field] = merged;
        changedFields.add(`context.${field}`);
        changedSections.add("context");
      }
    }
  }

  // ---- quality ----
  const quality = { ...project.quality };
  if (
    patch.quality?.acceptanceCriteriaRequired !== undefined &&
    quality.acceptanceCriteriaRequired !== patch.quality.acceptanceCriteriaRequired
  ) {
    quality.acceptanceCriteriaRequired = patch.quality.acceptanceCriteriaRequired;
    changedFields.add("quality.acceptanceCriteriaRequired");
    changedSections.add("quality");
  }
  if (
    patch.quality?.validationRequiredBeforeDone !== undefined &&
    quality.validationRequiredBeforeDone !== patch.quality.validationRequiredBeforeDone
  ) {
    quality.validationRequiredBeforeDone = patch.quality.validationRequiredBeforeDone;
    changedFields.add("quality.validationRequiredBeforeDone");
    changedSections.add("quality");
  }
  if (
    patch.quality?.preferredValidationCommands !== undefined &&
    patch.quality.preferredValidationCommands.length > 0
  ) {
    const merged = dedupeAppend(
      quality.preferredValidationCommands,
      patch.quality.preferredValidationCommands,
    );
    if (!deepEqual(merged, quality.preferredValidationCommands)) {
      quality.preferredValidationCommands = merged;
      changedFields.add("quality.preferredValidationCommands");
      changedSections.add("quality");
    }
  }

  // ---- record arrays ----
  const reqResult = mergeArraySection({
    existing: project.requirements,
    inputs: patch.requirements,
    idPrefix: "REQ",
    idSeparator: "-",
    recordTypeLabel: "requirement",
    createFn: createRequirement,
    updateFn: updateRequirement,
    timestamp,
  });
  if (reqResult.changed) {
    changedFields.add("requirements");
    changedSections.add("requirements");
  }

  const decResult = mergeArraySection({
    existing: project.decisions,
    inputs: patch.decisions,
    idPrefix: "D",
    idSeparator: "",
    recordTypeLabel: "decision",
    createFn: createDecision,
    updateFn: updateDecision,
    timestamp,
  });
  if (decResult.changed) {
    changedFields.add("decisions");
    changedSections.add("decisions");
  }

  const asmResult = mergeArraySection({
    existing: project.assumptions,
    inputs: patch.assumptions,
    idPrefix: "ASM",
    idSeparator: "-",
    recordTypeLabel: "assumption",
    createFn: createAssumption,
    updateFn: updateAssumption,
    timestamp,
  });
  if (asmResult.changed) {
    changedFields.add("assumptions");
    changedSections.add("assumptions");
  }

  const riskResult = mergeArraySection({
    existing: project.risks,
    inputs: patch.risks,
    idPrefix: "RISK",
    idSeparator: "-",
    recordTypeLabel: "risk",
    createFn: createRisk,
    updateFn: updateRisk,
    timestamp,
  });
  if (riskResult.changed) {
    changedFields.add("risks");
    changedSections.add("risks");
  }

  const oqResult = mergeArraySection({
    existing: project.openQuestions,
    inputs: patch.openQuestions,
    idPrefix: "Q",
    idSeparator: "",
    recordTypeLabel: "open question",
    createFn: createOpenQuestion,
    updateFn: updateOpenQuestion,
    timestamp,
  });
  if (oqResult.changed) {
    changedFields.add("openQuestions");
    changedSections.add("openQuestions");
  }

  const createdRecordIds = [
    ...reqResult.createdIds,
    ...decResult.createdIds,
    ...asmResult.createdIds,
    ...riskResult.createdIds,
    ...oqResult.createdIds,
  ];
  const updatedRecordIds = [
    ...reqResult.updatedIds,
    ...decResult.updatedIds,
    ...asmResult.updatedIds,
    ...riskResult.updatedIds,
    ...oqResult.updatedIds,
  ];

  const projectChanged = changedFields.size > 0;

  const newProject: ProjectModel = projectChanged
    ? {
        ...project,
        project: { ...projectFields, updatedAt: timestamp },
        context,
        quality,
        requirements: reqResult.records,
        decisions: decResult.records,
        assumptions: asmResult.records,
        risks: riskResult.records,
        openQuestions: oqResult.records,
      }
    : project;

  const planningContextReady = isPlanningContextReady(newProject);
  const nextRecommendedCommand = planningContextReady ? "aiqt plan" : "aiqt update";
  const stateChanged = state.nextRecommendedCommand !== nextRecommendedCommand;

  const newState: StateModel = stateChanged
    ? { ...state, nextRecommendedCommand, lastUpdatedAt: timestamp }
    : state;

  return {
    project: newProject,
    state: newState,
    projectChanged,
    stateChanged,
    changedFields: [...changedFields],
    changedSections: [...changedSections],
    createdRecordIds,
    updatedRecordIds,
    createdDecisionIds: decResult.createdIds,
    planningContextReady,
  };
}
