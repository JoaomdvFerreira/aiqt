export interface RawInitOptions {
  json?: boolean;
  objective?: string;
  targetUser?: string;
  agent?: string;
  /** M16: clearer alias for existingRepositoryPath, written at init time. */
  implementationRoot?: string;
}

export interface InitOptions {
  objective: string;
  targetUsers: string[];
  preferredAgent: string | null;
  /** M16: writes project.existingRepositoryPath when supplied. Null means same-root (implementationRoot resolves to controlRoot). */
  existingRepositoryPath: string | null;
}

/** Normalize commander-parsed init flags into canonical init input. */
export function normalizeInitOptions(raw: RawInitOptions): InitOptions {
  return {
    objective: raw.objective ?? "",
    targetUsers:
      raw.targetUser && raw.targetUser.trim() !== "" ? [raw.targetUser] : [],
    preferredAgent:
      raw.agent && raw.agent.trim() !== "" ? raw.agent : null,
    existingRepositoryPath:
      raw.implementationRoot && raw.implementationRoot.trim() !== ""
        ? raw.implementationRoot
        : null,
  };
}

export interface RawUpdateOptions {
  json?: boolean;
  fromFile?: string;
  /** Pre-parsed update JSON (e.g. from aiqt import update --stdin). Not a CLI flag; set internally by import.command.ts. */
  input?: unknown;
  objective?: string;
  targetUser?: string[];
  agent?: string;
  repositoryPath?: string;
  /** M16: clearer alias for --repository-path; both write existingRepositoryPath. */
  implementationRoot?: string;
}

/** Accumulate repeatable commander flag values into an array. */
export function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export interface RawPlanOptions {
  json?: boolean;
  fromFile?: string;
  example?: boolean;
  /** M17/M17-RC1: extend an existing (non-empty) work graph. With no target, appends; with a target, refines. */
  extend?: boolean;
  /** M17-RC1: the work unit to refine. */
  refineWorkUnit?: string;
  /** @deprecated M17-RC1: use --refine-work-unit. Kept functional for M17 backward compatibility. */
  replacePlaceholder?: string;
  /** M17/M17-RC1: validate and report append/refine without persisting or appending runlog events. */
  preview?: boolean;
}

export interface RawCheckpointOptions {
  json?: boolean;
  fromFile?: string;
  example?: boolean;
}

export interface RawExportOptions {
  json?: boolean;
  format?: string;
  dryRun?: boolean;
}

export interface RawPromptOptions {
  json?: boolean;
  out?: string;
  idea?: string;
  /** M17/M17-RC1: render append/refine guidance instead of the initial-plan prompt (plan kind only). */
  extend?: boolean;
  /** M17-RC1: the work unit to refine. */
  refineWorkUnit?: string;
  /** @deprecated M17-RC1: use --refine-work-unit. Kept functional for M17 backward compatibility. */
  replacePlaceholder?: string;
}

export interface RawImportOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  /** M17/M17-RC1: forwarded to `aiqt plan --extend` when importType is "plan". */
  extend?: boolean;
  /** M17-RC1: the work unit to refine. */
  refineWorkUnit?: string;
  /** @deprecated M17-RC1: use --refine-work-unit. Kept functional for M17 backward compatibility. */
  replacePlaceholder?: string;
  preview?: boolean;
}

export interface RawReviewOptions {
  json?: boolean;
  mode?: string;
}

export interface RawReviewAcknowledgeOptions {
  json?: boolean;
  reason?: string;
}

export interface RawNextOptions {
  json?: boolean;
  preview?: boolean;
  /** M20: explicit work unit selector. Mutually exclusive with --milestone. */
  workUnit?: string;
  /** M20: explicit milestone-scoped selector. Mutually exclusive with --work-unit. */
  milestone?: string;
}

export interface RawManageOptions {
  json?: boolean;
}

export interface RawSkillsPlanOptions {
  json?: boolean;
}

export interface RawIssueListOptions {
  json?: boolean;
}

export interface RawIssueUpdateOptions {
  json?: boolean;
  status?: string;
  reason?: string;
}

export interface RawIssuePromoteOptions {
  json?: boolean;
  title?: string;
  reason?: string;
  validationCommand?: string[];
}

export interface RawRepairPlanOptions {
  json?: boolean;
}

export interface RawCheckpointAmendOptions {
  json?: boolean;
  checkpoint?: string;
  acceptance?: string;
  validation?: string;
  reason?: string;
}

export interface RawDependencyUpdateOptions {
  json?: boolean;
  type?: string;
  reason?: string;
}

export interface RawGraphValidateOptions {
  json?: boolean;
}

export interface RawGraphRepairOptions {
  json?: boolean;
  dryRun?: boolean;
  /** M18 §11.2: atomically apply deterministic stale-readiness repairs (ready -> planned). */
  apply?: boolean;
}

export interface RawEvidenceImportOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
}

export interface RawWorkspacePrepareOptions {
  json?: boolean;
  preview?: boolean;
}

export interface RawWorkspaceStatusOptions {
  json?: boolean;
  workUnit?: string;
}

export interface RawWorkspaceReleaseOptions {
  json?: boolean;
  preview?: boolean;
}

export interface RawWorkspaceRecoverOptions {
  json?: boolean;
  apply?: boolean;
}

export interface RawExecutionImportOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
  example?: boolean;
}

export interface RawExecutionStaleOptions {
  json?: boolean;
  preview?: boolean;
  apply?: boolean;
  asOf?: string;
}

export interface RawExecutionStatusOptions {
  json?: boolean;
  session?: string;
  workUnit?: string;
}

export interface RawEvidenceGatePolicyImportOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RawEvidenceGatePolicyListOptions {
  json?: boolean;
}

export interface RawEvidenceGatePolicyShowOptions {
  json?: boolean;
  version?: string;
}

export interface RawEvidenceGatePolicyActivateOptions {
  json?: boolean;
  version?: string;
  preview?: boolean;
  asOf?: string;
}

export interface RawExecutionExternalRequestOptions {
  json?: boolean;
  resumeSession?: string;
  preview?: boolean;
  output?: string;
  asOf?: string;
  example?: boolean;
}

export interface RawExecutionExternalImportOptions {
  json?: boolean;
  request?: string;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RawExecutionExternalStatusOptions {
  json?: boolean;
  session?: string;
  request?: string;
}

export interface RawExecutionAdapterClaudeCodeRequestOptions {
  json?: boolean;
  resumeSession?: string;
  preview?: boolean;
  output?: string;
  asOf?: string;
  example?: boolean;
}

export interface RawExecutionAdapterClaudeCodeImportOptions {
  json?: boolean;
  request?: string;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RawExecutionAdapterClaudeCodeStatusOptions {
  json?: boolean;
  session?: string;
}
