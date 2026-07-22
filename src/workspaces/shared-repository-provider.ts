import type { StateModel } from "../schema/state.schema.js";
import type { ManagedWorkspace, ManagedWorkspaceAccess } from "../schema/managed-workspace.schema.js";
import type { WorkspaceBinding } from "../schema/workspace-binding.schema.js";
import type { RunlogEvent } from "../schema/runlog-event.schema.js";
import {
  getManagedWorkspaces,
  getWorkspaceBindings,
  findWorkspacesBySeriesKey,
  findActiveBindingForWorkUnit,
  findActiveBindingsForWorkspace,
} from "../services/workspace-state-service.js";
import { deriveWorkspaceSeriesKey, resolveGenerationForSeries } from "./workspace-identity.js";
import { nextId } from "../state/ids.js";
import {
  buildWorkspacePreparedEvent,
  buildWorkspaceBindingCreatedEvent,
  buildWorkspaceBindingReleasedEvent,
  buildWorkspaceReleasedEvent,
} from "../state/runlog-store.js";

const SHARED_PROVIDER_ID = "shared-repository@1" as const;

/**
 * M25 §9: `shared-repository@1` resolves the physical workspace to the
 * verified implementation root -- it creates no directory, no branch,
 * and runs no mutating Git command. Because there is no external side
 * effect to interrupt (the "physical workspace" already exists as the
 * implementation root itself), this provider skips the general §14
 * pending-operation protocol entirely and persists its candidate state
 * in one atomic step -- there is no failure window between "decided" and
 * "done" for it to protect against. `headCommit` and `isDirty` are
 * gathered by the caller via the read-only Git runner (WU25-02); this
 * module performs no I/O of its own.
 */
export interface SharedPrepareParams {
  state: StateModel;
  projectId: string;
  workUnitId: string;
  assignmentKey: string;
  access: ManagedWorkspaceAccess;
  implementationRoot: string;
  headCommit: string;
  isDirty: boolean;
  timestamp: string;
  nextEventId: () => string;
}

export interface SharedPrepareSuccess {
  ok: true;
  changed: boolean;
  outcome: "created" | "linked" | "no_op";
  managedWorkspaces: ManagedWorkspace[];
  workspaceBindings: WorkspaceBinding[];
  runlogEvents: RunlogEvent[];
  workspace: ManagedWorkspace;
  binding: WorkspaceBinding;
  warnings: string[];
}

export interface SharedPrepareFailure {
  ok: false;
  error: string;
}

export type SharedPrepareResult = SharedPrepareSuccess | SharedPrepareFailure;

export function buildSharedWorkspacePrepareCandidate(params: SharedPrepareParams): SharedPrepareResult {
  const existingWorkspaces = getManagedWorkspaces(params.state);
  const existingBindings = getWorkspaceBindings(params.state);
  const warnings: string[] = [];
  if (params.isDirty) {
    warnings.push(
      "The shared implementation repository has uncommitted changes. This is reported, not modified -- M25 never mutates the implementation repository.",
    );
  }

  const seriesKey = deriveWorkspaceSeriesKey({
    mode: "shared",
    projectId: params.projectId,
    providerId: SHARED_PROVIDER_ID,
    assignmentKey: params.assignmentKey,
    implementationRoot: params.implementationRoot,
  });

  const existingBindingForWorkUnit = findActiveBindingForWorkUnit(params.workUnitId, existingBindings);
  if (existingBindingForWorkUnit) {
    const boundWorkspace = existingWorkspaces.find((w) => w.id === existingBindingForWorkUnit.workspaceId);
    if (boundWorkspace && boundWorkspace.workspaceSeriesKey === seriesKey) {
      return {
        ok: true,
        changed: false,
        outcome: "no_op",
        managedWorkspaces: existingWorkspaces,
        workspaceBindings: existingBindings,
        runlogEvents: [],
        workspace: boundWorkspace,
        binding: existingBindingForWorkUnit,
        warnings,
      };
    }
    return {
      ok: false,
      error: `Work unit ${params.workUnitId} already has an active workspace binding to a different workspace.`,
    };
  }

  const seriesWorkspaces = findWorkspacesBySeriesKey(seriesKey, existingWorkspaces);
  const conflictingIsolated = seriesWorkspaces.find(
    (w) => w.lifecycleStatus === "ready" && w.providerId === "git-worktree@1",
  );
  if (conflictingIsolated) {
    return {
      ok: false,
      error: `An active isolated workspace already owns this canonical workspace identity (${conflictingIsolated.id}).`,
    };
  }

  const activeWorkspace = seriesWorkspaces.find((w) => w.lifecycleStatus === "ready");

  const runlogEvents: RunlogEvent[] = [];
  let workspace: ManagedWorkspace;
  let managedWorkspaces = existingWorkspaces;
  let outcome: "created" | "linked";

  if (activeWorkspace) {
    workspace = activeWorkspace;
    outcome = "linked";
  } else {
    const generationResolution = resolveGenerationForSeries(
      seriesWorkspaces.map((w) => ({ id: w.id, generation: w.generation, lifecycleStatus: w.lifecycleStatus })),
      [],
    );
    const generation = generationResolution.generation;
    const workspaceId = nextId("WS", existingWorkspaces.map((w) => w.id));
    workspace = {
      id: workspaceId,
      workspaceSeriesKey: seriesKey,
      generation,
      providerId: SHARED_PROVIDER_ID,
      assignmentKey: params.assignmentKey,
      mode: "shared",
      access: params.access,
      implementationRoot: params.implementationRoot,
      workspacePath: params.implementationRoot,
      baseCommit: params.headCommit,
      lifecycleStatus: "ready",
      createdAt: params.timestamp,
    };
    managedWorkspaces = [...existingWorkspaces, workspace];
    outcome = "created";
    runlogEvents.push(
      buildWorkspacePreparedEvent({
        id: params.nextEventId(),
        timestamp: params.timestamp,
        relatedIds: [workspace.id],
        data: {
          workspaceId: workspace.id,
          providerId: workspace.providerId,
          workspaceSeriesKey: seriesKey,
          generation,
          lifecycleStatus: "ready",
          outcome: "created",
        },
      }),
    );
  }

  const bindingId = nextId("WSB", existingBindings.map((b) => b.id));
  const binding: WorkspaceBinding = {
    id: bindingId,
    workUnitId: params.workUnitId,
    workspaceId: workspace.id,
    status: "active",
    boundAt: params.timestamp,
  };
  const workspaceBindings = [...existingBindings, binding];
  runlogEvents.push(
    buildWorkspaceBindingCreatedEvent({
      id: params.nextEventId(),
      timestamp: params.timestamp,
      relatedIds: [workspace.id, params.workUnitId],
      data: { workspaceId: workspace.id, workUnitId: params.workUnitId, providerId: workspace.providerId },
    }),
  );

  return {
    ok: true,
    changed: true,
    outcome,
    managedWorkspaces,
    workspaceBindings,
    runlogEvents,
    workspace,
    binding,
    warnings,
  };
}

export interface SharedReleaseParams {
  state: StateModel;
  workUnitId: string;
  timestamp: string;
  nextEventId: () => string;
}

export interface SharedReleaseSuccess {
  ok: true;
  changed: boolean;
  managedWorkspaces: ManagedWorkspace[];
  workspaceBindings: WorkspaceBinding[];
  runlogEvents: RunlogEvent[];
}

export interface SharedReleaseFailure {
  ok: false;
  error: string;
}

export type SharedReleaseResult = SharedReleaseSuccess | SharedReleaseFailure;

/** M25 §12.1: releases only the selected binding; the shared workspace record becomes released only when no active bindings remain. Never modifies the implementation repository. Repeated release is a no-op. */
export function buildSharedWorkspaceReleaseCandidate(params: SharedReleaseParams): SharedReleaseResult {
  const existingWorkspaces = getManagedWorkspaces(params.state);
  const existingBindings = getWorkspaceBindings(params.state);
  const binding = findActiveBindingForWorkUnit(params.workUnitId, existingBindings);
  if (!binding) {
    return {
      ok: true,
      changed: false,
      managedWorkspaces: existingWorkspaces,
      workspaceBindings: existingBindings,
      runlogEvents: [],
    };
  }

  const workspace = existingWorkspaces.find((w) => w.id === binding.workspaceId);
  if (!workspace || workspace.providerId !== SHARED_PROVIDER_ID) {
    return {
      ok: false,
      error: `Binding for work unit ${params.workUnitId} does not reference a shared-repository@1 workspace.`,
    };
  }

  const runlogEvents: RunlogEvent[] = [];
  const releasedBinding: WorkspaceBinding = { ...binding, status: "released", releasedAt: params.timestamp };
  const workspaceBindings = existingBindings.map((b) => (b.id === binding.id ? releasedBinding : b));
  runlogEvents.push(
    buildWorkspaceBindingReleasedEvent({
      id: params.nextEventId(),
      timestamp: params.timestamp,
      relatedIds: [workspace.id, params.workUnitId],
      data: { workspaceId: workspace.id, workUnitId: params.workUnitId, providerId: workspace.providerId },
    }),
  );

  let managedWorkspaces = existingWorkspaces;
  const remainingActiveBindings = findActiveBindingsForWorkspace(workspace.id, workspaceBindings);
  if (remainingActiveBindings.length === 0) {
    const releasedWorkspace: ManagedWorkspace = {
      ...workspace,
      lifecycleStatus: "released",
      releasedAt: params.timestamp,
    };
    managedWorkspaces = existingWorkspaces.map((w) => (w.id === workspace.id ? releasedWorkspace : w));
    runlogEvents.push(
      buildWorkspaceReleasedEvent({
        id: params.nextEventId(),
        timestamp: params.timestamp,
        relatedIds: [workspace.id],
        data: { workspaceId: workspace.id, providerId: workspace.providerId },
      }),
    );
  }

  return { ok: true, changed: true, managedWorkspaces, workspaceBindings, runlogEvents };
}
