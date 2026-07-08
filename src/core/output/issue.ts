export type IssueSeverity = "low" | "medium" | "high" | "critical";

export interface Issue {
  id: string;
  severity: IssueSeverity;
  area: string;
  message: string;
  affectedItems?: string[];
  suggestedAction?: string;
  agentCanFix?: boolean;
}
