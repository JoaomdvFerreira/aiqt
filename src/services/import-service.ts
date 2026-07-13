export type ImportType = "update" | "plan" | "checkpoint";

const IMPORT_TYPES: readonly ImportType[] = ["update", "plan", "checkpoint"];

export function isValidImportType(value: string): value is ImportType {
  return (IMPORT_TYPES as readonly string[]).includes(value);
}

export interface ImportResultData {
  importType: ImportType;
  sourcePath: string;
  delegatedAction: ImportType;
  followUpCommand: string | null;
}
