import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import { readTextFile } from "../core/filesystem/file-store.js";
import { writeJsonFile } from "../core/filesystem/safe-writer.js";
import { resolveAiqtPaths, type AiqtPaths } from "../core/filesystem/paths.js";
import { appendRunlogEvent } from "./runlog-store.js";

const MARKER_VERSION = 1;
const INIT_LOCK_FILE_NAME = ".aiqt-init-mutation.lock";
const INIT_MARKER_FILE_NAME = ".aiqt-init-interruption.json";

interface CanonicalDigests {
  project: string | null;
  state: string | null;
}

interface MutationMarker {
  version: number;
  mutationId: string;
  command: string;
  startedAt: string;
  initial: CanonicalDigests;
}

interface LockContents {
  pid: number;
  mutationId: string;
}

export interface ProjectMutationGuard {
  /** Clears the durable interruption marker only after the dispatched action completed. */
  complete: () => void;
  /** Releases the exclusive lock while deliberately retaining the marker (used only for process-unwind tests). */
  abandon: () => void;
}

function guardFailure(message: string, id: string): AiqtError {
  return new AiqtError(message, ExitCode.WorkflowBlocked, {
    id,
    severity: "high",
    area: "mutation",
    message,
    agentCanFix: false,
  });
}

function digestFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function currentDigests(paths: AiqtPaths): CanonicalDigests {
  return { project: digestFile(paths.projectFile), state: digestFile(paths.stateFile) };
}

function sameDigests(left: CanonicalDigests, right: CanonicalDigests): boolean {
  return left.project === right.project && left.state === right.state;
}

function markerPaths(root: string, create: boolean): { paths: AiqtPaths; markerFile: string; lockFile: string } {
  const paths = resolveAiqtPaths(root);
  if (create) {
    return {
      paths,
      markerFile: join(root, INIT_MARKER_FILE_NAME),
      lockFile: join(root, INIT_LOCK_FILE_NAME),
    };
  }
  return { paths, markerFile: paths.mutationMarkerFile, lockFile: paths.mutationLockFile };
}

function readMarker(path: string): MutationMarker | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw guardFailure(`Mutation interruption marker is unreadable: ${path}.`, "MUTATION-MARKER-INVALID");
  }
  const marker = parsed as Partial<MutationMarker>;
  if (
    marker.version !== MARKER_VERSION ||
    typeof marker.mutationId !== "string" ||
    typeof marker.command !== "string" ||
    typeof marker.startedAt !== "string" ||
    typeof marker.initial?.project !== "string" && marker.initial?.project !== null ||
    typeof marker.initial?.state !== "string" && marker.initial?.state !== null
  ) {
    throw guardFailure(`Mutation interruption marker is malformed: ${path}.`, "MUTATION-MARKER-INVALID");
  }
  return marker as MutationMarker;
}

function releaseLock(path: string, mutationId: string): void {
  try {
    const lock = JSON.parse(readFileSync(path, "utf8")) as Partial<LockContents>;
    if (lock.mutationId === mutationId) unlinkSync(path);
  } catch {
    // A missing/replaced lock must never cause a second mutation to be unlocked.
  }
}

function acquireLock(path: string, mutationId: string): void {
  const contents: LockContents = { pid: process.pid, mutationId };
  try {
    writeFileSync(path, JSON.stringify(contents), { flag: "wx" });
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw guardFailure(`Failed to acquire project mutation lock: ${(err as Error).message}`, "MUTATION-LOCK-IO");
    }
  }

  let existing: LockContents;
  try {
    existing = JSON.parse(readFileSync(path, "utf8")) as LockContents;
    if (typeof existing.pid !== "number" || typeof existing.mutationId !== "string") throw new Error("malformed lock");
  } catch {
    throw guardFailure(`Project mutation lock is malformed and cannot be reclaimed: ${path}.`, "MUTATION-LOCK-MALFORMED");
  }

  try {
    process.kill(existing.pid, 0);
    throw guardFailure("Another supported mutation is already in progress for this project.", "MUTATION-LOCK-HELD");
  } catch (err) {
    if (err instanceof AiqtError || (err as NodeJS.ErrnoException).code === "EPERM") throw err;
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
      throw guardFailure("Unable to determine whether the existing project mutation lock is live.", "MUTATION-LOCK-HELD");
    }
  }

  try {
    const latest = JSON.parse(readFileSync(path, "utf8")) as Partial<LockContents>;
    if (latest.mutationId !== existing.mutationId) {
      throw guardFailure("Another supported mutation is already in progress for this project.", "MUTATION-LOCK-HELD");
    }
    unlinkSync(path);
  } catch (err) {
    if (err instanceof AiqtError) throw err;
    throw guardFailure("Failed to reclaim an interrupted project mutation lock.", "MUTATION-LOCK-IO");
  }
  acquireLock(path, mutationId);
}

function recoveryEventExists(runlogFile: string, mutationId: string): boolean {
  if (!existsSync(runlogFile)) return false;
  try {
    return readTextFile(runlogFile)
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          const event = JSON.parse(line) as { type?: unknown; data?: { mutationId?: unknown } };
          return event.type === "mutation.interruption_recovered" && event.data?.mutationId === mutationId;
        } catch {
          return false;
        }
      });
  } catch (err) {
    throw guardFailure(`Unable to inspect mutation recovery audit history: ${(err as Error).message}`, "MUTATION-RECOVERY-READ-FAILED");
  }
}

function recoverMarker(markerFile: string, paths: AiqtPaths): void {
  const marker = readMarker(markerFile);
  if (!marker) return;

  const changed = !sameDigests(marker.initial, currentDigests(paths));
  if (existsSync(paths.runlogFile)) {
    if (!recoveryEventExists(paths.runlogFile, marker.mutationId)) {
      try {
        appendRunlogEvent(paths.runlogFile, {
          id: `MUTREC-${createHash("sha256").update(marker.mutationId).digest("hex").slice(0, 16)}`,
          type: "mutation.interruption_recovered",
          timestamp: new Date().toISOString(),
          actor: "system",
          summary: "Recovered a previously interrupted supported mutation boundary.",
          relatedIds: [],
          data: {
            mutationId: marker.mutationId,
            command: marker.command,
            startedAt: marker.startedAt,
            canonicalStateChanged: changed,
          },
        });
      } catch (err) {
        throw guardFailure(`Failed to persist mutation recovery audit: ${(err as Error).message}`, "MUTATION-RECOVERY-AUDIT-FAILED");
      }
    }
  } else if (changed) {
    throw guardFailure("Interrupted mutation changed canonical state but no runlog is available for its recovery audit.", "MUTATION-RECOVERY-AUDIT-UNAVAILABLE");
  }

  try {
    unlinkSync(markerFile);
  } catch (err) {
    throw guardFailure(`Recovered mutation audit but could not clear its interruption marker: ${(err as Error).message}`, "MUTATION-MARKER-CLEAR-FAILED");
  }
}

/**
 * M49-WU3's only general mutation boundary. CLI command handlers are
 * implementation functions (exported for tests), not a supported API; the
 * Commander dispatcher invokes this guard around their complete lifecycle.
 * Specialized workspace, maintenance, Night Audit, and remote reconciliation
 * retain their own intent/reconciliation logic inside this enclosing boundary.
 * Portfolio manifests, autonomous-run artifacts, release-preparation plans,
 * and PR integration plans are not project canonical state and remain their
 * existing create/external-reconciliation surfaces rather than entering this
 * guard.
 */
export function acquireProjectMutationGuard(input: { root: string; command: string; create?: boolean }): ProjectMutationGuard {
  const root = resolve(input.root);
  const { paths, markerFile, lockFile } = markerPaths(root, input.create === true);
  // Preserve each command family's established no-project result. A normal
  // mutation cannot reach a canonical write without .aiqt/, so there is no
  // boundary to acquire in this error path.
  if (!input.create && !existsSync(paths.aiqtDir)) {
    return { complete: () => undefined, abandon: () => undefined };
  }
  const mutationId = `MUT-${randomUUID()}`;
  acquireLock(lockFile, mutationId);
  try {
    recoverMarker(markerFile, paths);
    const marker: MutationMarker = {
      version: MARKER_VERSION,
      mutationId,
      command: input.command,
      startedAt: new Date().toISOString(),
      initial: currentDigests(paths),
    };
    writeJsonFile(markerFile, marker);
  } catch (err) {
    releaseLock(lockFile, mutationId);
    throw err;
  }

  let settled = false;
  const release = () => {
    if (!settled) {
      settled = true;
      releaseLock(lockFile, mutationId);
    }
  };
  return {
    complete: () => {
      if (settled) return;
      try {
        unlinkSync(markerFile);
      } finally {
        release();
      }
    },
    abandon: release,
  };
}
