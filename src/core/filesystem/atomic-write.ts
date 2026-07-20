import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import * as nodeCrypto from "node:crypto";
import { dirname, join } from "node:path";

/**
 * M21-WU07: bounded retry against a name collision on exclusive creation
 * (`wx`). UUID v4 collision probability is astronomically low -- this
 * exists to fail deterministically and cleanly rather than to handle a
 * realistic collision rate.
 */
const MAX_TEMP_NAME_ATTEMPTS = 5;

function openExclusiveTempFile(dir: string): { fd: number; tempPath: string } {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TEMP_NAME_ATTEMPTS; attempt++) {
    const tempPath = join(dir, `.${nodeCrypto.randomUUID()}.tmp`);
    try {
      // "wx": O_WRONLY | O_CREAT | O_EXCL -- fails with EEXIST instead of
      // silently truncating or following a pre-existing path at this name.
      const fd = openSync(tempPath, "wx");
      return { fd, tempPath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `atomicWriteFileSync: exhausted ${MAX_TEMP_NAME_ATTEMPTS} exclusive temp-file creation attempts in "${dir}": ${String(lastError)}`,
  );
}

/**
 * Atomically write `contents` to `targetPath`:
 *  - create a collision-resistant, exclusively-created temp file beside the
 *    target (same directory, so the eventual rename is same-filesystem),
 *  - write and flush it to disk,
 *  - rename it over the target,
 *  - clean up the temp file on any failure so no partial target is left
 *    and no orphan temp file remains.
 */
export function atomicWriteFileSync(targetPath: string, contents: string): void {
  const dir = dirname(targetPath);
  const { fd: openedFd, tempPath } = openExclusiveTempFile(dir);

  let fd: number | null = openedFd;
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, targetPath);
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(tempPath, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}
