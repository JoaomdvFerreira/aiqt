import { appendFileSync } from "node:fs";
import { atomicWriteFileSync } from "./atomic-write.js";

/** Serialize a value to stable, deterministic JSON with a trailing newline. */
export function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Write a JSON document atomically with stable formatting. */
export function writeJsonFile(targetPath: string, value: unknown): void {
  atomicWriteFileSync(targetPath, serializeJson(value));
}

/** Serialize a single JSONL record (compact, one line). */
export function serializeJsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/** Append a single JSONL event to a runlog file. */
export function appendJsonLine(targetPath: string, value: unknown): void {
  appendFileSync(targetPath, serializeJsonLine(value));
}
