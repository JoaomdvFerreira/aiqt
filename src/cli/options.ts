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
