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
import { StateModelSchema, type StateModel } from "../schema/state.schema.js";
import { assertCompatibleVersion } from "./versioning.js";

const STATE_LABEL = "state.json";

/** Build the canonical initial workflow state for `aiqt init`. */
export function buildInitialStateModel(createdAt: string): StateModel {
  return {
    version: AIQT_SCHEMA_VERSION,
    projectStatus: "draft",
    currentMilestoneId: null,
    currentWorkUnitId: null,
    workGraph: {
      milestones: [],
      workUnits: [],
      dependencies: [],
    },
    checkpoints: [],
    lastAgentPacket: null,
    nextRecommendedCommand: "aiqt update",
    lastUpdatedAt: createdAt,
  };
}

export function writeStateModel(path: string, model: StateModel): void {
  assertCompatibleVersion(model.version, STATE_LABEL);
  writeJsonFile(path, model);
}

function invalidStateIssue(message: string): Issue {
  return {
    id: "STATE-INVALID",
    severity: "critical",
    area: "state",
    message,
    suggestedAction: "Restore a valid .aiqt/state.json.",
    agentCanFix: false,
  };
}

/**
 * Read, version-check, and schema-validate state.json.
 * Any missing/unreadable/malformed/invalid file blocks with exit code 3.
 */
export function readStateModel(path: string): StateModel {
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
  assertCompatibleVersion(version, STATE_LABEL);

  const parsed = StateModelSchema.safeParse(raw);
  if (!parsed.success) {
    const message = `Invalid ${STATE_LABEL}: ${parsed.error.issues
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
