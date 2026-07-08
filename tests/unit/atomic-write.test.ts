import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../../src/core/filesystem/atomic-write.js";
import { writeJsonFile, serializeJson } from "../../src/core/filesystem/safe-writer.js";
import { makeTempDir, removeDir } from "../helpers.js";

describe("atomic writes", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("writes valid JSON that round-trips", () => {
    dir = makeTempDir();
    const target = join(dir, "out.json");
    const value = { a: 1, b: ["x", "y"], c: null };
    writeJsonFile(target, value);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(value);
  });

  it("serializes JSON deterministically with stable formatting", () => {
    const value = { a: 1, b: 2 };
    expect(serializeJson(value)).toBe(serializeJson(value));
    expect(serializeJson(value).endsWith("\n")).toBe(true);
  });

  it("leaves no temp files behind on success", () => {
    dir = makeTempDir();
    const target = join(dir, "out.json");
    atomicWriteFileSync(target, "{}\n");
    const entries = readdirSync(dir);
    expect(entries).toEqual(["out.json"]);
  });

  it("does not leave a partial target file when the write fails", () => {
    dir = makeTempDir();
    // Target path points at a non-existent nested directory, so the rename
    // fails; the target must not exist afterward.
    const target = join(dir, "missing-subdir", "out.json");
    expect(() => atomicWriteFileSync(target, "{}\n")).toThrow();
    const entries = readdirSync(dir);
    expect(entries).not.toContain("missing-subdir");
  });
});
