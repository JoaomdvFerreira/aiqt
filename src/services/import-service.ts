export type ImportType = "update" | "plan" | "checkpoint";

const IMPORT_TYPES: readonly ImportType[] = ["update", "plan", "checkpoint"];

export function isValidImportType(value: string): value is ImportType {
  return (IMPORT_TYPES as readonly string[]).includes(value);
}

/**
 * M8 §15: extends the M7 contract additively. delegatedAction is unchanged
 * from M7 and must not be renamed. source/sourcePath/delegatedResultSummary
 * are new in M8.
 *
 * sourcePath behavior: "file" mode -> the supplied --from-file path string;
 * "stdin" mode -> null.
 * delegatedResultSummary is copied verbatim from the delegated command's own
 * result summary -- it must never invent a second, independent summary.
 */
export interface ImportResultData {
  importType: ImportType;
  delegatedAction: ImportType;
  source: "file" | "stdin";
  sourcePath: string | null;
  followUpCommand: string | null;
  delegatedResultSummary: string;
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
