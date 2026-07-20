import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "../../src/core/filesystem/atomic-write.js";
import { writeJsonFile, serializeJson } from "../../src/core/filesystem/safe-writer.js";
import { makeTempDir, removeDir } from "../helpers.js";

// M21-WU07: `vi.spyOn` cannot redefine non-configurable properties on
// Node's built-in module namespace objects in this runtime -- `vi.mock`
// with a passthrough factory is the supported way to make `randomUUID` and
// `renameSync` deterministic for a single call while every other export
// (and every other test in this file) keeps its real implementation.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const { randomUUID } = await import("node:crypto");
const { renameSync } = await import("node:fs");
const mockedRandomUUID = vi.mocked(randomUUID);
const mockedRenameSync = vi.mocked(renameSync);

describe("atomic writes", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
    mockedRandomUUID.mockClear();
    mockedRenameSync.mockClear();
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

  // M21-WU07: collision-resistant exclusive temp-file creation.
  it("uses a UUID-based, dot-prefixed, .tmp-suffixed temp name (same directory as the target)", () => {
    dir = makeTempDir();
    const target = join(dir, "out.json");
    mockedRandomUUID.mockImplementationOnce(() => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    atomicWriteFileSync(target, "{}\n");
    expect(mockedRandomUUID).toHaveBeenCalledTimes(1);
    // The temp name must never survive past a successful write.
    expect(readdirSync(dir)).toEqual(["out.json"]);
  });

  it("retries with a new name on a temp-name collision and leaves no orphan temp file", () => {
    dir = makeTempDir();
    const target = join(dir, "out.json");
    const first = "11111111-1111-1111-1111-111111111111";
    const second = "22222222-2222-2222-2222-222222222222";
    // Pre-create a file at the first candidate temp path so the exclusive
    // ("wx") open collides deterministically on the first attempt.
    writeFileSync(join(dir, `.${first}.tmp`), "stale");
    mockedRandomUUID.mockImplementationOnce(() => first).mockImplementationOnce(() => second);

    atomicWriteFileSync(target, "{}\n");

    expect(mockedRandomUUID).toHaveBeenCalledTimes(2);
    // Successful write leaves only the target and the untouched stale file
    // from the first (colliding) name -- no new orphan from the retry.
    const entries = readdirSync(dir).sort();
    expect(entries).toEqual(["out.json", `.${first}.tmp`].sort());
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({});
  });

  it("throws and cleans up when exclusive creation collides on every bounded attempt", () => {
    dir = makeTempDir();
    const target = join(dir, "out.json");
    for (let i = 0; i < 5; i++) {
      const id = `00000000-0000-0000-0000-00000000000${i}`;
      mockedRandomUUID.mockImplementationOnce(() => {
        writeFileSync(join(dir as string, `.${id}.tmp`), "stale");
        return id;
      });
    }

    expect(() => atomicWriteFileSync(target, "{}\n")).toThrow(/exhausted/i);

    expect(mockedRandomUUID).toHaveBeenCalledTimes(5);
    // The target must never be created when every attempt collides.
    expect(readdirSync(dir)).not.toContain("out.json");
  });

  it("leaves the pre-existing target unchanged and cleans up when the rename step fails", () => {
    dir = makeTempDir();
    const target = join(dir, "out.json");
    writeJsonFile(target, { original: true });
    mockedRenameSync.mockImplementationOnce(() => {
      throw new Error("simulated rename failure");
    });

    expect(() => atomicWriteFileSync(target, JSON.stringify({ mutated: true }))).toThrow(
      /simulated rename failure/,
    );

    // The pre-existing target's content survives the failed overwrite.
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ original: true });
    // And no orphan temp file was left behind from the failed attempt.
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("persists deterministic content unchanged by successful atomic writes", () => {
    dir = makeTempDir();
    const target = join(dir, "out.json");
    const value = { nested: { a: [1, 2, 3] }, z: "text" };
    writeJsonFile(target, value);
    const first = readFileSync(target, "utf8");
    writeJsonFile(target, value);
    const second = readFileSync(target, "utf8");
    expect(second).toBe(first);
  });
});
