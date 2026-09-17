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

/** M48: shared `aiqt review night *` target-selection flags. */
export interface RawReviewNightTargetOptions {
  json?: boolean;
  repository?: string;
  portfolio?: string;
  member?: string;
}

export interface RawReviewNightRunOptions extends RawReviewNightTargetOptions {
  targetDurationMinutes?: number;
  hardStopMinutes?: number;
  maxReviewTasks?: number;
  maxNewIssues?: number;
  maxOpenAuditIssueBacklog?: number;
}

export interface RawReviewNightSubmitOptions extends RawReviewNightTargetOptions {
  domain?: string;
  scope?: string;
  commit?: string;
  fromFile?: string;
  tokenEnv?: string;
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
  resolveNotCompleted?: string;
  resolutionEvidence?: string;
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

export interface RawEvidenceGateSimulateOptions {
  json?: boolean;
  project?: boolean;
  workUnit?: string;
  checkpoint?: string;
  policy?: string;
  version?: string;
  asOf?: string;
  output?: string;
}

export interface RawEvidenceGateAdvisoryRefreshOptions {
  json?: boolean;
  checkpoint?: string;
  asOf?: string;
  preview?: boolean;
}

export interface RawEvidenceGateAdvisoryFeedbackOptions {
  json?: boolean;
  classification?: string;
  rationale?: string;
  preview?: boolean;
}

export interface RawEvidenceGateEnforcementProfileImportOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  preview?: boolean;
  asOf?: string;
}

export interface RawEvidenceGateEnforcementProfileShowOptions {
  json?: boolean;
  version?: string;
}

export interface RawEvidenceGateEnforcementRecoveryImportOptions {
  json?: boolean;
  profile?: string;
  version?: string;
  gate?: string;
  rule?: string;
  before?: string;
  after?: string;
  recoveryKind?: string;
  preview?: boolean;
  asOf?: string;
}

export interface RawEvidenceGateEnforcementActivationPrepareOptions {
  json?: boolean;
  profile?: string;
  version?: string;
  preview?: boolean;
  asOf?: string;
}

export interface RawEvidenceGateEnforcementActivationActivateOptions {
  json?: boolean;
  plan?: string;
  activatedBy?: string;
  reason?: string;
  confirmRequired?: string;
}

export interface RawEvidenceGateExceptionCreateOptions {
  json?: boolean;
  activation?: string;
  gate?: string;
  workUnit?: string;
  rules?: string;
  authorizedBy?: string;
  reason?: string;
  expiresAt?: string;
  confirmException?: string;
  preview?: boolean;
}

export interface RawEvidenceGateExceptionRevokeOptions {
  json?: boolean;
  revokedBy?: string;
  reason?: string;
  preview?: boolean;
}

export interface RawEvidenceGateEnforcementActivationDeactivateOptions {
  json?: boolean;
  activation?: string;
  deactivatedBy?: string;
  reason?: string;
  confirmDeactivate?: string;
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

// ---------------------------------------------------------------------------
// M37-WU01: aiqt autonomous ... (public CLI, configuration, and
// simulation wiring for the M36 autonomous-run contract).
// ---------------------------------------------------------------------------

export interface RawAutonomousInspectOptions {
  json?: boolean;
  repository?: string;
  baseRef?: string;
}

export interface RawAutonomousClassifyOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  issueId?: string;
  source?: string;
  repository?: string;
  baseRef?: string;
  objective?: string;
  acceptanceCriterion?: string[];
  constraint?: string[];
  requestedPermission?: string[];
  prohibitedArea?: string[];
  validationAvailable?: boolean;
  targetedValidationCommand?: string[];
  authoritativeValidationCommand?: string[];
  config?: string;
  evidenceDir?: string;
}

export interface RawAutonomousApproveOptions {
  json?: boolean;
  run?: string;
  yes?: boolean;
  config?: string;
  evidenceDir?: string;
}

export interface RawAutonomousRunOptions {
  json?: boolean;
  run?: string;
  simulate?: boolean;
  config?: string;
  evidenceDir?: string;
}

export interface RawAutonomousStatusOptions {
  json?: boolean;
  run?: string;
  config?: string;
  evidenceDir?: string;
}

export interface RawAutonomousCancelOptions {
  json?: boolean;
  run?: string;
  reason?: string;
  config?: string;
  evidenceDir?: string;
}

export interface RawAutonomousResultOptions {
  json?: boolean;
  run?: string;
  patch?: boolean;
  prDraft?: boolean;
  config?: string;
  evidenceDir?: string;
}

export interface RawAutonomousCleanupOptions {
  json?: boolean;
  run?: string;
  config?: string;
  evidenceDir?: string;
}

export interface RawAutonomousAgentImportOptions {
  json?: boolean;
  run?: string;
  fromFile?: string;
  stdin?: boolean;
  config?: string;
  evidenceDir?: string;
  live?: boolean;
}

// ---------------------------------------------------------------------------
// M40-WU03: aiqt release ... (release governance CLI surface).
// ---------------------------------------------------------------------------

export interface RawReleaseAssessOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
}

export interface RawReleaseValidateOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
}

export interface RawReleaseNotesOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
}

export interface RawReleasePrepareOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  evidenceDir?: string;
}

export interface RawReleaseStatusOptions {
  json?: boolean;
  candidate?: string;
  evidenceDir?: string;
}

export interface RawReleaseDraftOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
  tokenEnv?: string;
}

export interface RawReleaseHistoryOptions {
  json?: boolean;
}

export interface RawReleaseReconstructOptions {
  json?: boolean;
  repository: string;
  tokenEnv?: string;
}

// ---------------------------------------------------------------------------
// M41-WU03: aiqt validation ... (test-impact selection read-only CLI surface).
// ---------------------------------------------------------------------------

export interface RawValidationSelectOptions {
  json?: boolean;
  workUnit?: string;
}

export interface RawValidationExplainOptions {
  json?: boolean;
  workUnit?: string;
}

// ---------------------------------------------------------------------------
// M42-WU02: aiqt defects discover (bounded discovery/dedup/freshness CLI surface).
// ---------------------------------------------------------------------------

export interface RawDefectsDiscoverOptions {
  json?: boolean;
  workUnit?: string;
  humanTitle?: string;
  humanSummary?: string;
  humanEvidence?: string;
  humanSeverity?: string;
  preview?: boolean;
}

export interface RawDefectsListOptions {
  json?: boolean;
  status?: string;
}

export interface RawDefectsTriageOptions {
  json?: boolean;
  preview?: boolean;
}

export interface RawDefectsTransitionOptions {
  json?: boolean;
  to?: string;
  reason?: string;
  preview?: boolean;
}

export interface RawDefectsRemediateOptions {
  json?: boolean;
  objective?: string;
  scope?: string;
  outOfScope?: string;
  acceptance?: string;
  approvedBy?: string;
  preview?: boolean;
}

export interface RawDefectsRecordValidationOptions {
  json?: boolean;
  outcome?: string;
  evidence?: string;
  note?: string;
  preview?: boolean;
}

// ---------------------------------------------------------------------------
// M45-WU02: aiqt maintenance ... (background maintenance scheduling CLI surface).
// ---------------------------------------------------------------------------

export interface RawMaintenanceScheduleAddOptions {
  json?: boolean;
  taskKind: string;
  cadence: string;
  anchorAt?: string;
  maxAutomaticRisk?: string;
  disabled?: boolean;
}

export interface RawMaintenanceScheduleListOptions {
  json?: boolean;
}

export interface RawMaintenanceScheduleUpdateOptions {
  json?: boolean;
  cadence?: string;
  maxAutomaticRisk?: string;
}

export interface RawMaintenanceStatusOptions {
  json?: boolean;
}

export interface RawMaintenanceHistoryOptions {
  json?: boolean;
  scheduleId?: string;
  limit?: string;
}

// ---------------------------------------------------------------------------
// M46-WU02: aiqt portfolio ... (multi-repository portfolio registry CLI surface).
// ---------------------------------------------------------------------------

export interface RawPortfolioCreateOptions {
  json?: boolean;
  name: string;
}

export interface RawPortfolioListOptions {
  json?: boolean;
}

export interface RawPortfolioInspectOptions {
  json?: boolean;
}

export interface RawPortfolioAddOptions {
  json?: boolean;
  alias?: string;
}

export interface RawPortfolioRemoveOptions {
  json?: boolean;
}

export interface RawPortfolioStatusOptions {
  json?: boolean;
}

export interface RawPortfolioCheckOptions {
  json?: boolean;
}

// ---------------------------------------------------------------------------
// M47: `aiqt pr ...` (controlled Pull Request integration).
// ---------------------------------------------------------------------------

export interface RawPrPrepareOptions {
  json?: boolean;
  repository?: string;
  remote?: string;
  base: string;
  source?: string;
  title?: string;
  bodyFile?: string;
  fromRun?: string;
  evidenceDir?: string;
  configPath?: string;
  reviewer?: string[];
  ready?: boolean;
  requireProtectedBase?: boolean;
  tokenEnv?: string;
  portfolio?: string;
  member?: string;
}

export interface RawPrInspectOptions {
  json?: boolean;
}

export interface RawPrPushOptions {
  json?: boolean;
  tokenEnv?: string;
}

export interface RawPrCreateOptions {
  json?: boolean;
  tokenEnv?: string;
}

export interface RawPrStatusOptions {
  json?: boolean;
  tokenEnv?: string;
}

export interface RawPrValidateOptions {
  json?: boolean;
  tokenEnv?: string;
}
