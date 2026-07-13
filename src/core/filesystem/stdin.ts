import type { Readable } from "node:stream";

/** Minimal shape needed from a stdin-like stream: readable data plus an optional TTY flag. */
export interface StdinLike extends Pick<Readable, "on" | "setEncoding"> {
  isTTY?: boolean;
}

/** True when the given stream is an interactive terminal (defaults to the real process.stdin). */
export function isStdinInteractiveTty(stdin: StdinLike = process.stdin): boolean {
  return Boolean(stdin.isTTY);
}

/**
 * Read the entire stream as UTF-8 text. Defaults to the real process.stdin;
 * a fake stream may be injected for tests. Resolves to "" for an
 * immediately-closed/empty stream.
 */
export function readStdinText(stdin: StdinLike = process.stdin): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    stdin.on("end", () => resolvePromise(data));
    stdin.on("error", (err: Error) => reject(err));
  });
}
