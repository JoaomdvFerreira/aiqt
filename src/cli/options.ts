export interface RawInitOptions {
  json?: boolean;
  objective?: string;
  targetUser?: string;
  agent?: string;
}

export interface InitOptions {
  objective: string;
  targetUsers: string[];
  preferredAgent: string | null;
}

/** Normalize commander-parsed init flags into canonical init input. */
export function normalizeInitOptions(raw: RawInitOptions): InitOptions {
  return {
    objective: raw.objective ?? "",
    targetUsers:
      raw.targetUser && raw.targetUser.trim() !== "" ? [raw.targetUser] : [],
    preferredAgent:
      raw.agent && raw.agent.trim() !== "" ? raw.agent : null,
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
}

/** Accumulate repeatable commander flag values into an array. */
export function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export interface RawPlanOptions {
  json?: boolean;
  fromFile?: string;
  example?: boolean;
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
}

export interface RawImportOptions {
  json?: boolean;
  fromFile?: string;
  stdin?: boolean;
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
