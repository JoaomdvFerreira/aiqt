import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { makeTempDir, removeDir } from "../helpers.js";
import { loadOperatorConfigFile } from "../../src/services/autonomous-run-operator-config-file.js";

/**
 * M37-WU01: loads the operator's project-level configuration file. Plain
 * filesystem I/O only -- no subprocess.
 */
describe("loadOperatorConfigFile (M37-WU01, real disposable directory)", () => {
  it("returns ok:true, config:null when the file does not exist (config is optional)", () => {
    const dir = makeTempDir("aiqt-config-file-");
    try {
      const result = loadOperatorConfigFile(join(dir, "does-not-exist.json"));
      expect(result).toEqual({ ok: true, config: null });
    } finally {
      removeDir(dir);
    }
  });

  it("loads a valid partial config file", () => {
    const dir = makeTempDir("aiqt-config-file-");
    try {
      const path = join(dir, "config.json");
      writeFileSync(path, JSON.stringify({ evidenceOutputDir: "/custom/evidence", networkPolicy: "denied" }));
      const result = loadOperatorConfigFile(path);
      expect(result).toEqual({ ok: true, config: { evidenceOutputDir: "/custom/evidence", networkPolicy: "denied" } });
    } finally {
      removeDir(dir);
    }
  });

  it("fails closed with a reason for invalid JSON", () => {
    const dir = makeTempDir("aiqt-config-file-");
    try {
      const path = join(dir, "config.json");
      writeFileSync(path, "{not valid json");
      const result = loadOperatorConfigFile(path);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/not valid JSON/);
    } finally {
      removeDir(dir);
    }
  });

  it("fails closed with a reason for a schema-invalid field value", () => {
    const dir = makeTempDir("aiqt-config-file-");
    try {
      const path = join(dir, "config.json");
      writeFileSync(path, JSON.stringify({ networkPolicy: "not-a-real-policy" }));
      const result = loadOperatorConfigFile(path);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/schema validation/);
    } finally {
      removeDir(dir);
    }
  });

  it("an empty object is a valid partial config (every field optional)", () => {
    const dir = makeTempDir("aiqt-config-file-");
    try {
      const path = join(dir, "config.json");
      writeFileSync(path, "{}");
      const result = loadOperatorConfigFile(path);
      expect(result).toEqual({ ok: true, config: {} });
    } finally {
      removeDir(dir);
    }
  });
});
