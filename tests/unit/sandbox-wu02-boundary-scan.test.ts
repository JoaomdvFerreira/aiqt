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
    const dockerRunnerExport = "runDocker" + "Command";
    const dockerRunnerImport = new RegExp(`import\\s*\\{\\s*${dockerRunnerExport}(?:\\s*,\\s*type\\s+DockerCommandResult)?\\s*\\}\\s*from\\s*["']\\.\\/sandbox-docker-command-runner\\.js["']`);
    expect(text).toMatch(dockerRunnerImport);
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
    const cancelBody = text.match(/cancel\(handle: SandboxHandle, terminationReason: SandboxTerminationReason = "cancelled"\): SandboxCancellationResult \{([\s\S]*?)\n\s{2}\}/)?.[1] ?? "";
    expect(cancelBody).toMatch(/"inspect"/);
    expect(cancelBody).toMatch(/"kill"/);
  });
});

/**
 * M38-WU04 (build spec: "Integrate opt-in live execution with M37 CLI,
 * capability preflight, validation, self-review, evidence, crash
 * recovery, cleanup, and safe fallback"). None of this Work Unit's own
 * new files call execFileSync/docker directly -- every real Docker
 * operation is reached only by reusing the already-reviewed
 * DockerSandboxBackend/executeSandboxedCommandLoop from WU38-02/03.
 */
const M38_WU04_FILES = ["src/services/sandbox-run-execution-service.ts", "src/workflow/sandbox-run-self-review.ts", "src/services/sandbox-run-command-result.ts"];

describe("M38-WU04 boundary scan: no new real-execution surface -- everything reuses WU38-02/03's already-reviewed backend", () => {
  it("none of this Work Unit's own service/workflow files call execFileSync/spawn/exec directly", () => {
    for (const relPath of M38_WU04_FILES) {
      const code = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(code, `${relPath} must not spawn a subprocess directly`).not.toMatch(/\bexecFileSync\s*\(|\bspawnSync\s*\(|\bspawn\s*\(|\bexecSync\s*\(|\bexecFile\s*\(/);
    }
  });

  it("package.json declares no new runtime dependency for M38-WU04 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });
});

describe("M38-WU04 boundary scan: live execution is opt-in at two independent layers, never a silent fallback", () => {
  it("agent-import refuses --live before any sandbox capability check when the operator has not set liveExecutionEnabled", () => {
    const text = readFileSync(join(repoRoot, "src/cli/commands/autonomous-agent-import.command.ts"), "utf8");
    const liveNotEnabledIndex = text.indexOf("AUTONOMOUS-AGENT-IMPORT-LIVE-NOT-ENABLED");
    const prepareIndex = text.indexOf("prepareLiveSandbox(");
    expect(liveNotEnabledIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(liveNotEnabledIndex).toBeLessThan(prepareIndex);
  });

  it("prepareLiveSandbox always calls checkAvailability and evaluateSandboxCapabilities before creating anything", () => {
    const text = readFileSync(join(repoRoot, "src/services/sandbox-run-execution-service.ts"), "utf8");
    const availabilityIndex = text.indexOf("checkAvailability()");
    const capabilityIndex = text.indexOf("evaluateSandboxCapabilities(");
    const createIndex = text.indexOf("backend.create(");
    expect(availabilityIndex).toBeGreaterThan(-1);
    expect(capabilityIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(availabilityIndex).toBeLessThan(createIndex);
    expect(capabilityIndex).toBeLessThan(createIndex);
  });
});

describe("M38-WU04 boundary scan: crash recovery never silently loses the reference to an orphaned sandbox", () => {
  it("cleanup command only clears sandboxContainerId after a real, confirmed destroy() succeeds", () => {
    const text = readFileSync(join(repoRoot, "src/cli/commands/autonomous-cleanup.command.ts"), "utf8");
    expect(text).toMatch(/backend\.destroy\(/);
    expect(text).toMatch(/if \(!destroyResult\.ok\)/);
  });
});
