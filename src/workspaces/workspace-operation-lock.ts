import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * M25 §20: the local operation lock guarding generation allocation and
 * provider mutation. Exclusive create only (`wx`), bounded metadata (PID,
 * created timestamp, operation ID), 30-minute staleness ceiling, always
 * released in `finally` by the caller. Read-only status/preview never
 * acquires this lock. No OS-global or database lock is used.
 */

export const WORKSPACE_OPERATION_LOCK_FILE_NAME = "workspace-operation.lock";
const STALE_LOCK_MAX_AGE_MS = 30 * 60 * 1000;

export class WorkspaceOperationLockError extends Error {
  constructor(
    public readonly code: "LOCK_HELD" | "LOCK_MALFORMED" | "LOCK_IO_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceOperationLockError";
  }
}

interface LockContents {
  pid: number;
  createdAt: string;
  operationId: string;
}

function lockPath(aiqtDir: string): string {
  return join(aiqtDir, WORKSPACE_OPERATION_LOCK_FILE_NAME);
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs no actual kill; it only tests existence/permission.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ESRCH: no such process (dead). EPERM: process exists but we lack
    // permission to signal it -- treat as alive, since we cannot prove
    // it is safe to reclaim the lock.
    return code === "EPERM";
  }
}

function readLockContents(path: string): LockContents {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).pid !== "number" ||
    typeof (parsed as Record<string, unknown>).createdAt !== "string" ||
    typeof (parsed as Record<string, unknown>).operationId !== "string"
  ) {
    throw new SyntaxError("malformed lock contents");
  }
  return parsed as LockContents;
}

/** True only when the existing lock is provably stale (age exceeded AND owning process no longer exists). A lock that cannot be proven stale is never removed. */
function isReclaimable(path: string): boolean {
  let contents: LockContents;
  try {
    contents = readLockContents(path);
  } catch {
    // Malformed lock content: cannot verify age or owner -- block safely,
    // never guess it is reclaimable.
    return false;
  }
  const ageMs = Date.now() - new Date(contents.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < STALE_LOCK_MAX_AGE_MS) return false;
  return !isProcessAlive(contents.pid);
}

export interface WorkspaceOperationLockHandle {
  release: () => void;
}

/**
 * Acquires the workspace-operation lock, reclaiming a provably stale lock
 * (age > 30 minutes AND owning process no longer running) exactly once
 * before re-attempting exclusive creation. Throws WorkspaceOperationLockError
 * (LOCK_HELD) otherwise -- callers must map this to exit code 2.
 */
export function acquireWorkspaceOperationLock(aiqtDir: string, operationId: string): WorkspaceOperationLockHandle {
  const path = lockPath(aiqtDir);
  const contents: LockContents = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
    operationId,
  };

  const tryCreate = (): boolean => {
    try {
      writeFileSync(path, JSON.stringify(contents), { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw new WorkspaceOperationLockError("LOCK_IO_ERROR", "Failed to create workspace operation lock.");
    }
  };

  if (tryCreate()) {
    return { release: () => releaseLock(path) };
  }

  if (isReclaimable(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Another process may have reclaimed/released it first -- fall
      // through and retry the exclusive create below.
    }
    if (tryCreate()) {
      return { release: () => releaseLock(path) };
    }
  }

  throw new WorkspaceOperationLockError(
    "LOCK_HELD",
    "A workspace operation is already in progress (workspace-operation.lock is held).",
  );
}

function releaseLock(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best-effort release; a missing lock file at release time is not an error.
  }
}
