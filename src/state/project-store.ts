import { AIQT_SCHEMA_VERSION } from "../core/constants/schema-version.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { AiqtError } from "../core/output/aiqt-error.js";
import type { Issue } from "../core/output/issue.js";
import { writeJsonFile } from "../core/filesystem/safe-writer.js";
import {
  readJsonFile,
  FileReadError,
  JsonParseError,
} from "../core/filesystem/file-store.js";
import {
  ProjectModelSchema,
  type ProjectModel,
} from "../schema/project.schema.js";
import { assertCompatibleVersion } from "./versioning.js";

const PROJECT_LABEL = "project.json";

export interface CreateProjectInput {
  id: string;
  name: string;
  objective: string;
  targetUsers: string[];
  preferredAgent: string | null;
  createdAt: string;
  /** M16: clearer-alias init input, written straight to existingRepositoryPath. Null for same-root projects. */
  existingRepositoryPath?: string | null;
}

/** Build the canonical initial project model for `aiqt init`. */
export function buildInitialProjectModel(
  input: CreateProjectInput,
): ProjectModel {
  return {
    version: AIQT_SCHEMA_VERSION,
    project: {
      id: input.id,
      name: input.name,
      objective: input.objective,
      targetUsers: input.targetUsers,
      preferredAgent: input.preferredAgent,
      existingRepositoryPath: input.existingRepositoryPath ?? null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
    context: {
      constraints: [],
      nonGoals: [],
      technologyPreferences: [],
      businessRules: [],
      architectureNotes: [],
    },
    requirements: [],
    decisions: [],
    risks: [],
    assumptions: [],
    openQuestions: [],
    quality: {
      acceptanceCriteriaRequired: true,
      validationRequiredBeforeDone: true,
      preferredValidationCommands: [],
    },
    integrations: {},
  };
}

export function writeProjectModel(path: string, model: ProjectModel): void {
  assertCompatibleVersion(model.version, PROJECT_LABEL);
  writeJsonFile(path, model);
}

function invalidStateIssue(message: string): Issue {
  return {
    id: "PROJECT-INVALID",
    severity: "critical",
    area: "project",
    message,
    suggestedAction: "Restore a valid .aiqt/project.json.",
    agentCanFix: false,
  };
}

/**
 * Read, version-check, and schema-validate project.json.
 * Any missing/unreadable/malformed/invalid file blocks with exit code 3.
 */
export function readProjectModel(path: string): ProjectModel {
  let raw: unknown;
  try {
    raw = readJsonFile(path);
  } catch (err) {
    if (err instanceof FileReadError || err instanceof JsonParseError) {
      throw new AiqtError(
        err.message,
        ExitCode.InvalidInput,
        invalidStateIssue(err.message),
      );
    }
    throw err;
  }

  const version = (raw as { version?: unknown } | null)?.version;
  assertCompatibleVersion(version, PROJECT_LABEL);

  const parsed = ProjectModelSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid ${PROJECT_LABEL}: ${parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ")}`;
    throw new AiqtError(
      message,
      ExitCode.InvalidInput,
      invalidStateIssue(message),
    );
  }

  return parsed.data;
}
