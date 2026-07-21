import { describe, it, expect } from "vitest";
import { validateArtifactLocator } from "../../src/schema/external-evidence/artifact-safety.js";

describe("validateArtifactLocator (M23 §11)", () => {
  it("accepts a repository-relative path", () => {
    const result = validateArtifactLocator("logs/run-1/output.txt");
    expect(result.ok).toBe(true);
  });

  it("normalizes backslashes to forward slashes in relative paths", () => {
    const result = validateArtifactLocator("logs\\run-1\\output.txt");
    expect(result).toEqual({ ok: true, normalized: "logs/run-1/output.txt" });
  });

  it("accepts an opaque provider reference with no scheme", () => {
    expect(validateArtifactLocator("run-12345-artifact").ok).toBe(true);
  });

  it("accepts a clean https URL", () => {
    expect(validateArtifactLocator("https://example.com/artifacts/report.json").ok).toBe(true);
  });

  it("rejects a data: URL", () => {
    expect(validateArtifactLocator("data:text/plain;base64,aGVsbG8=").ok).toBe(false);
  });

  it("rejects non-https schemes", () => {
    for (const scheme of ["http", "ftp", "file", "javascript"]) {
      expect(validateArtifactLocator(`${scheme}://example.com/x`).ok).toBe(false);
    }
  });

  it("rejects a URL with userinfo", () => {
    expect(validateArtifactLocator("https://user:pass@example.com/x").ok).toBe(false);
  });

  it("rejects a URL with a query string (covers signed/tokenized URLs)", () => {
    expect(validateArtifactLocator("https://example.com/x?token=abc").ok).toBe(false);
  });

  it("rejects a URL with a fragment", () => {
    expect(validateArtifactLocator("https://example.com/x#section").ok).toBe(false);
  });

  it("rejects an out-of-root POSIX absolute path", () => {
    expect(validateArtifactLocator("/etc/passwd").ok).toBe(false);
  });

  it("rejects an out-of-root Windows absolute path", () => {
    expect(validateArtifactLocator("C:\\secrets\\file.txt").ok).toBe(false);
  });

  it("rejects a UNC path", () => {
    expect(validateArtifactLocator("\\\\server\\share\\file.txt").ok).toBe(false);
  });

  it("rejects a device path", () => {
    expect(validateArtifactLocator("\\\\.\\PhysicalDrive0").ok).toBe(false);
    expect(validateArtifactLocator("/dev/sda").ok).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(validateArtifactLocator("../../etc/passwd").ok).toBe(false);
    expect(validateArtifactLocator("logs/../../etc/passwd").ok).toBe(false);
  });

  it("rejects an empty locator", () => {
    expect(validateArtifactLocator("   ").ok).toBe(false);
  });
});
