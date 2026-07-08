import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * Atomically write `contents` to `targetPath`:
 *  - write to a temp file beside the target,
 *  - flush to disk,
 *  - rename over the target,
 *  - clean up the temp file on any failure so no partial target is left.
 */
export function atomicWriteFileSync(targetPath: string, contents: string): void {
  const dir = dirname(targetPath);
  const tempPath = join(
    dir,
    `.${Math.random().toString(36).slice(2)}.tmp`,
  );

  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "w");
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
