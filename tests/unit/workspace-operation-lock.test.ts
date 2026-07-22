import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireWorkspaceOperationLock,
  WorkspaceOperationLockError,
  WORKSPACE_OPERATION_LOCK_FILE_NAME,
} from "../../src/workspaces/workspace-operation-lock.js";

const dirs: string[] = [];
function tempAiqtDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aiqt-lock-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

describe("acquireWorkspaceOperationLock (M25 §20/§25.15)", () => {
  it("acquires exclusively and creates a bounded-metadata lock file", () => {
    const aiqtDir = tempAiqtDir();
    const handle = acquireWorkspaceOperationLock(aiqtDir, "op-1");
    const path = join(aiqtDir, WORKSPACE_OPERATION_LOCK_FILE_NAME);
    expect(existsSync(path)).toBe(true);
    const contents = JSON.parse(readFileSync(path, "utf8"));
    expect(typeof contents.pid).toBe("number");
    expect(typeof contents.createdAt).toBe("string");
    expect(contents.operationId).toBe("op-1");
    handle.release();
    expect(existsSync(path)).toBe(false);
  });

  it("blocks a concurrent acquisition while the lock is held (live process)", () => {
    const aiqtDir = tempAiqtDir();
    const handle = acquireWorkspaceOperationLock(aiqtDir, "op-1");
    expect(() => acquireWorkspaceOperationLock(aiqtDir, "op-2")).toThrow(WorkspaceOperationLockError);
    handle.release();
  });

  it("release always removes the lock file, callable from a finally block", () => {
    const aiqtDir = tempAiqtDir();
    let threw = false;
    try {
      const handle = acquireWorkspaceOperationLock(aiqtDir, "op-1");
      try {
        throw new Error("simulated failure mid-operation");
      } finally {
        handle.release();
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(existsSync(join(aiqtDir, WORKSPACE_OPERATION_LOCK_FILE_NAME))).toBe(false);
  });

  it("reclaims a stale lock left by a dead process", () => {
    const aiqtDir = tempAiqtDir();
    const path = join(aiqtDir, WORKSPACE_OPERATION_LOCK_FILE_NAME);
    // A PID astronomically unlikely to exist, well past the 30-minute
    // staleness threshold.
    const staleContents = {
      pid: 999999,
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      operationId: "dead-op",
    };
    writeFileSync(path, JSON.stringify(staleContents));
    const handle = acquireWorkspaceOperationLock(aiqtDir, "new-op");
    const contents = JSON.parse(readFileSync(path, "utf8"));
    expect(contents.operationId).toBe("new-op");
    handle.release();
  });

  it("does not reclaim a lock from a live process even if it were old (age check honored, pid is this process)", () => {
    const aiqtDir = tempAiqtDir();
    const path = join(aiqtDir, WORKSPACE_OPERATION_LOCK_FILE_NAME);
    const oldButLiveContents = {
      pid: process.pid,
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      operationId: "old-but-live",
    };
    writeFileSync(path, JSON.stringify(oldButLiveContents));
    expect(() => acquireWorkspaceOperationLock(aiqtDir, "new-op")).toThrow(WorkspaceOperationLockError);
  });

  it("blocks safely on malformed lock contents rather than guessing it is reclaimable", () => {
    const aiqtDir = tempAiqtDir();
    const path = join(aiqtDir, WORKSPACE_OPERATION_LOCK_FILE_NAME);
    writeFileSync(path, "{ not valid json");
    expect(() => acquireWorkspaceOperationLock(aiqtDir, "new-op")).toThrow(WorkspaceOperationLockError);
  });

  it("does not reclaim a lock that is recent even though its process cannot be verified as dead", () => {
    const aiqtDir = tempAiqtDir();
    const path = join(aiqtDir, WORKSPACE_OPERATION_LOCK_FILE_NAME);
    const recentDeadPid = { pid: 999999, createdAt: new Date().toISOString(), operationId: "recent" };
    writeFileSync(path, JSON.stringify(recentDeadPid));
    expect(() => acquireWorkspaceOperationLock(aiqtDir, "new-op")).toThrow(WorkspaceOperationLockError);
  });
});
