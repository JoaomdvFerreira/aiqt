import { readFileSync } from "node:fs";
import { isFile } from "./file-exists.js";

export class FileReadError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "FileReadError";
  }
}

export class JsonParseError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "JsonParseError";
  }
}

/** Read a UTF-8 text file, throwing FileReadError if it is missing/unreadable. */
export function readTextFile(path: string): string {
  if (!isFile(path)) {
    throw new FileReadError(path, `File not found: ${path}`);
  }
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new FileReadError(
      path,
      `Unable to read file: ${path} (${(err as Error).message})`,
    );
  }
}

/** Read and parse a JSON file, throwing typed errors for missing/malformed input. */
export function readJsonFile(path: string): unknown {
  const raw = readTextFile(path);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new JsonParseError(
      path,
      `Malformed JSON in ${path}: ${(err as Error).message}`,
    );
  }
}
