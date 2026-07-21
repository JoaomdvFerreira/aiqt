import { describe, it, expect } from "vitest";
import {
  parseAndValidateExternalJson,
  assertSafeParsedJson,
  ProhibitedKeyError,
  ExcessiveNestingError,
  TopLevelNotObjectError,
  TooManyTopLevelKeysError,
  EXTERNAL_INPUT_MAX_TOP_LEVEL_KEYS,
  EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH,
} from "../../src/schema/external-evidence/limits.js";

describe("parseAndValidateExternalJson (M23 §4.4/§6.2/§8)", () => {
  it("parses a well-formed object payload", () => {
    expect(parseAndValidateExternalJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAndValidateExternalJson("{not json")).toThrow(SyntaxError);
  });

  it("rejects a non-object top-level value (array)", () => {
    expect(() => parseAndValidateExternalJson("[1,2,3]")).toThrow(TopLevelNotObjectError);
  });

  it("rejects a non-object top-level value (scalar)", () => {
    expect(() => parseAndValidateExternalJson('"hello"')).toThrow(TopLevelNotObjectError);
  });

  it("rejects a top-level object with more than the max allowed keys", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < EXTERNAL_INPUT_MAX_TOP_LEVEL_KEYS + 1; i++) obj[`k${i}`] = i;
    expect(() => parseAndValidateExternalJson(JSON.stringify(obj))).toThrow(TooManyTopLevelKeysError);
  });

  it("accepts exactly the max allowed top-level keys", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < EXTERNAL_INPUT_MAX_TOP_LEVEL_KEYS; i++) obj[`k${i}`] = i;
    expect(() => parseAndValidateExternalJson(JSON.stringify(obj))).not.toThrow();
  });

  it("rejects a __proto__ key at the top level", () => {
    expect(() => parseAndValidateExternalJson('{"__proto__":{"x":1}}')).toThrow(ProhibitedKeyError);
  });

  it("rejects a prototype/constructor key nested deeply", () => {
    expect(() => parseAndValidateExternalJson('{"a":{"b":{"constructor":1}}}')).toThrow(ProhibitedKeyError);
    expect(() => parseAndValidateExternalJson('{"a":[{"prototype":1}]}')).toThrow(ProhibitedKeyError);
  });

  it("rejects nesting deeper than the configured maximum", () => {
    let value: unknown = 1;
    for (let i = 0; i < EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH + 5; i++) value = { nested: value };
    expect(() => assertSafeParsedJson(value)).toThrow(ExcessiveNestingError);
  });

  it("accepts nesting at or below the configured maximum", () => {
    let value: unknown = 1;
    for (let i = 0; i < EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH - 1; i++) value = { nested: value };
    expect(() => assertSafeParsedJson(value)).not.toThrow();
  });

  it("preserves array order and does not treat arrays as prohibited-key carriers", () => {
    expect(() => assertSafeParsedJson({ list: [1, 2, { ok: true }] })).not.toThrow();
  });
});
