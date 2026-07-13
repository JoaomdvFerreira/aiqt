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
}

export interface RawImportOptions {
  json?: boolean;
  fromFile?: string;
}
