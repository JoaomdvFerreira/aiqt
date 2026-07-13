import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { readStdinText, isStdinInteractiveTty, type StdinLike } from "../../src/core/filesystem/stdin.js";

/** A minimal fake stdin stream driven manually via emit(). */
function fakeStdin(isTTY?: boolean): StdinLike & EventEmitter {
  const emitter = new EventEmitter() as EventEmitter & StdinLike;
  emitter.isTTY = isTTY;
  emitter.setEncoding = () => emitter as unknown as ReturnType<StdinLike["setEncoding"]>;
  return emitter;
}

describe("isStdinInteractiveTty", () => {
  it("is true when the stream reports isTTY: true", () => {
    expect(isStdinInteractiveTty(fakeStdin(true))).toBe(true);
  });

  it("is false when the stream reports isTTY: false", () => {
    expect(isStdinInteractiveTty(fakeStdin(false))).toBe(false);
  });

  it("is false when isTTY is undefined (piped/redirected input)", () => {
    expect(isStdinInteractiveTty(fakeStdin(undefined))).toBe(false);
  });
});

describe("readStdinText", () => {
  it("resolves accumulated data chunks on end", async () => {
    const stream = fakeStdin(false);
    const promise = readStdinText(stream);
    stream.emit("data", '{"a":');
    stream.emit("data", "1}");
    stream.emit("end");
    await expect(promise).resolves.toBe('{"a":1}');
  });

  it("resolves to an empty string when the stream ends with no data", async () => {
    const stream = fakeStdin(false);
    const promise = readStdinText(stream);
    stream.emit("end");
    await expect(promise).resolves.toBe("");
  });

  it("rejects when the stream errors", async () => {
    const stream = fakeStdin(false);
    const promise = readStdinText(stream);
    const err = new Error("boom");
    stream.emit("error", err);
    await expect(promise).rejects.toThrow("boom");
  });
});
