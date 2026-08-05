import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M38-WU02 (build spec: "Implement one real backend..."; cross-Work-Unit
 * invariants: "no cwd-only sandbox claims", "no live execution without
 * capability confirmation", "no silent unsandboxed fallback", "network
 * denied by default", "no AIQT self-management", "no privileged host
 * operations" (Sec 4, Out of Scope)). Unlike WU38-01's boundary scan
 * (which forbids ALL process-spawning surfaces), this Work Unit's own
 * files are EXPECTED to spawn real `docker` subprocesses -- the checks
 * here are narrower and more specific: exactly one real
 * `execFileSync` call site, no privileged-container flag, no
 * container-runtime-socket bind mount, no unpinned "latest" image tag,
 * and the real security-hardening flags this Work Unit's own commit
 * claims to set are actually present in the source.
 */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/**");
    })
    .join("\n");
}

describe("M38-WU02 boundary scan: exactly one real execFileSync call site for Docker", () => {
  it("sandbox-docker-command-runner.ts is the only file under src/workspaces/sandbox-*.ts that calls execFileSync/spawn/exec directly", () => {
    const runnerCode = codeOnly(readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-command-runner.ts"), "utf8"));
    expect(runnerCode).toMatch(/execFileSync\(/);

    const backendCode = codeOnly(readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8"));
    expect(backendCode).not.toMatch(/\bexecFileSync\s*\(|\bspawnSync\s*\(|\bspawn\s*\(|\bexecSync\s*\(|\bexecFile\s*\(/);
  });

  it("sandbox-docker-backend.ts only ever invokes Docker through runDockerCommand", () => {
    const text = readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8");
    expect(text).toMatch(/import\s*\{\s*runDockerCommand\s*\}\s*from\s*["']\.\/sandbox-docker-command-runner\.js["']/);
  });
});

describe("M38-WU02 boundary scan: no privileged container or host-socket exposure (threat model Sec 4.7)", () => {
  it("no file references --privileged", () => {
    for (const relPath of ["src/workspaces/sandbox-docker-backend.ts", "src/workspaces/sandbox-docker-command-runner.ts"]) {
      const code = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(code.toLowerCase()).not.toContain("--privileged");
    }
  });

  it("no file references the Docker/container-runtime control socket", () => {
    for (const relPath of ["src/workspaces/sandbox-docker-backend.ts", "src/workspaces/sandbox-docker-command-runner.ts"]) {
      const code = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(code).not.toMatch(/docker\.sock/);
    }
  });

  it("the sandbox image tag is pinned, never 'latest'", () => {
    const text = readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8");
    expect(text).not.toMatch(/aiqt-sandbox-base:latest/);
    expect(text).toMatch(/aiqt-sandbox-base:1/);
  });

  it("real security-hardening flags are present: --cap-drop ALL, --security-opt no-new-privileges, non-root --user", () => {
    const text = readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8");
    expect(text).toMatch(/--cap-drop/);
    expect(text).toMatch(/ALL/);
    expect(text).toMatch(/no-new-privileges/);
    expect(text).toMatch(/--user/);
    expect(text).not.toMatch(/"--user",\s*\n?\s*"0:0"/);
  });

  it("--network is always 'none' in the literal create() args -- no branch ever passes a different value", () => {
    const text = readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8");
    const networkFlagOccurrences = text.match(/"--network",/g) ?? [];
    expect(networkFlagOccurrences.length).toBe(1);
    expect(text).toMatch(/"--network",\s*\n?\s*"none",/);
  });
});

describe("M38-WU02 boundary scan: no AIQT self-management path exists", () => {
  it("create() validates the filesystem policy (which itself calls isAiqtOwnRepository) before ever building a docker create command", () => {
    const text = readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8");
    expect(text).toMatch(/import\s*\{\s*validateSandboxFilesystemPolicy\s*\}\s*from\s*["']\.\.\/workflow\/sandbox-filesystem-policy\.js["']/);
    expect(text).toMatch(/validateSandboxFilesystemPolicy\(/);
  });

  it("package.json declares no new runtime dependency for M38-WU02 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });
});

// "None of the stub methods return ok:true" was a true WU38-02 invariant
// (launchProcess/streamEvents/cancel/collectResult/exportEvidence were
// all explicit "not yet supported" stubs then). WU38-03 deliberately
// lifts it -- those methods are real now (see tests/integration/
// sandbox-docker-backend.test.ts's WU38-03 describe block for their real
// coverage, and sandbox-command-loop.test.ts for the mediation logic
// that decides what may ever reach launchProcess in the first place).
// Removed here rather than left to fail silently; the narrower invariant
// that replaces it -- cleanup()/destroy() always verify their real
// outcome via a follow-up `docker inspect`, never assume success -- is
// checked below.
describe("M38-WU03 boundary scan: cleanup/destroy always verify their real outcome, never assume success", () => {
  it("cleanup() and destroy() both call docker inspect after their own stop/rm to confirm the real outcome", () => {
    const text = readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8");
    const cleanupBody = text.match(/cleanup\(handle: SandboxHandle\): SandboxCleanupResult \{([\s\S]*?)\n\s{2}\}/)?.[1] ?? "";
    const destroyBody = text.match(/destroy\(handle: SandboxHandle\): SandboxDestroyResult \{([\s\S]*?)\n\s{2}\}/)?.[1] ?? "";
    expect(cleanupBody).toMatch(/"inspect"/);
    expect(destroyBody).toMatch(/"inspect"/);
  });

  it("cancel() re-verifies via docker inspect after stop, and escalates to kill only if still running", () => {
    const text = readFileSync(join(repoRoot, "src/workspaces/sandbox-docker-backend.ts"), "utf8");
    const cancelBody = text.match(/cancel\(handle: SandboxHandle\): SandboxCancellationResult \{([\s\S]*?)\n\s{2}\}/)?.[1] ?? "";
    expect(cancelBody).toMatch(/"inspect"/);
    expect(cancelBody).toMatch(/"kill"/);
  });
});
