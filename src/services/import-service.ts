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

/**
 * Map a delegated command's raw next-command recommendation to its guided
 * equivalent, when a guided path exists. Reused as-is rather than duplicated
 * so aiqt import never recommends hand-authoring JSON when aiqt prompt can
 * generate it instead (RC1 hardening).
 */
export function preferGuidedCommand(command: string | null): string | null {
  switch (command) {
    case "aiqt plan":
      return "aiqt prompt plan";
    case "aiqt checkpoint":
      return "aiqt prompt checkpoint";
    default:
      return command;
  }
}
