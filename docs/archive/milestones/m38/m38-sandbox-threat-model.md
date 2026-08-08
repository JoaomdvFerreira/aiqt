# M38-WU01: Sandbox Threat Model and Capability Inventory

## Purpose

WU38-01 (build spec: "Sandbox Threat Model, Platform Decision, and Backend Contract") is contract-only: no process launch, no container, no namespace, no mount, no network configuration, no privileged command. This document records the capability inventory this Work Unit's investigation produced, and the threat model its schemas/policies/guards are built to close (or, where a real backend does not exist yet, to explicitly leave open and name as residual risk).

## 1. Entry Gate Verification

Verified before any WU38-01 change (see the final report for the exact commands run):

- `docs/engineering/m37-closure-report.md` and `docs/engineering/m37-wu05-operator-workflow.md` exist.
- Tag `m37-autonomous-runner-cli` exists and points to the working tree's current `HEAD` (the M37 closure commit).
- Final M37 Node 24 CI: 6/6 jobs green, 3/3 test shards green, 2804/2804 tests passed, 0 timeouts, 0 assertion failures.
- M37 controlled-pilot evidence exists for all 10 required scenarios (`docs/engineering/m37-wu05-controlled-pilot-evidence.generated.json`).
- `src/workflow/autonomous-imported-response-agent-adapter.ts` (`ImportedResponseAgentAdapter`) exists and is unmodified.
- Working tree clean; no `.aiqt/` directory present.
- No automatic merge, real PR creation, deployment, or AIQT self-management path exists anywhere in the M37 codebase (M37 closure report's own explicit statement, re-verified by the M37 boundary scan).

## 2. Capability Inventory

### 2.1 Reusable capabilities (M36/M37, unchanged, available to a future live-execution Work Unit)

| Capability | Location | Notes |
|---|---|---|
| Eight public `aiqt autonomous ...` commands | `src/cli/commands/autonomous-*.command.ts` | `classify/approve/run/agent-import/status/cancel/result/cleanup`. M38 must add opt-in live execution on top of this surface (WU38-04), never replace it. |
| `ImportedResponseAgentAdapter` / request-import architecture | `src/workflow/autonomous-imported-response-agent-adapter.ts`, `src/services/autonomous-agent-response-import-service.ts` | The permanent lower-risk fallback (see Sec 4). Every M38 fallback path in this Work Unit (`sandbox-fallback-policy.ts`) points back at this exact workflow. |
| Persisted agent-request state across process boundaries | `src/services/autonomous-agent-request-store.ts` | Proven resumability pattern (M37-WU03/WU05 Scenario 8) a live-execution backend's own sandbox-handle persistence could mirror in a later Work Unit -- not reused directly by WU38-01 (no sandbox handle exists yet). |
| Branch/patch/PR-draft handoff | `src/services/autonomous-run-patch-export-service.ts`, `src/workflow/autonomous-run-pr-draft.ts` | Unaffected by M38; a live-execution run's evidence must still be able to flow into `aiqt autonomous result --patch/--pr-draft` in a later Work Unit. |
| Isolated worktree creation | `src/workspaces/autonomous-worktree-lifecycle.ts` (`gitWorktreeAdd`/`gitWorktreeRemove`) | The worktree itself remains the correct writable filesystem unit (build spec Sec 8 invariant 6: "Worktree is the only writable repository mount") -- a sandbox backend's `worktreeMount` (this Work Unit's schema) is expected to point at exactly this kind of path in WU38-02, not a copy or a different directory. |
| Command policy (classification) | `src/workflow/autonomous-run-command-policy.ts` | `CommandClassSchema`'s 7 classes and `ALWAYS_DENIED_COMMAND_CLASSES` are the existing command-mediation vocabulary. Build spec Sec 6 "Command mediation" for M38 describes the same shape (classify/approve-or-reject/execute/bound/record) one level lower, inside a sandbox rather than a bare worktree -- WU38-03 is expected to reuse this classifier, not reinvent one. |
| Budgets | `src/schema/autonomous-run.schema.ts` (`AutonomousBudgetsSchema`), `src/workflow/autonomous-run-budget.ts` | `SandboxResourcePolicySchema` (this Work Unit) is a distinct, sandbox-specific superset (adds CPU seconds, memory bytes, disk-write bytes, process count, output bytes -- dimensions a bare worktree execution never needed to bound because it never ran inside an isolated resource boundary at all). |
| Process execution (bare, unsandboxed) | `src/workspaces/autonomous-command-runner.ts` (`runAutonomousCommand`) | The M36/M37 execution primitive -- `execFileSync` with structured args, `shell:false`, policy-checked, but scoped only by filesystem-boundary path-prefix checks against the worktree, never a real OS isolation boundary. Build spec Sec 2's core invariant explicitly names this insufficient for live execution ("`cwd`, prompt instructions, path-prefix checks, or post-hoc diff inspection are not sandboxing"). Not reused by any WU38-01 file; carried forward to WU38-02/03 as "the thing a real sandbox backend must NOT merely be a rename of." |
| Cancellation | `src/workflow/autonomous-agent-request-lifecycle.ts`, `AbortSignal`-based cancellation in `produceAutonomousEvidencePacket` | M36/M37 cancellation stops before or between command executions in a bare `execFileSync` loop -- it has no concept of a process tree, so "process-tree cancellation" (build spec Sec 6) is new capability, not reusable as-is. `SandboxCancellationResult` (this Work Unit's contract) is deliberately a distinct, stronger shape (`processTreeFullyStopped: boolean`, never assumed true). |
| Validation | `src/services/autonomous-run-validation-service.ts` | Two-tier targeted/authoritative validation, already policy-mediated through the same command runner named above -- reusable verbatim once a sandboxed command runner exists to route validation commands through (WU38-04 scope). |
| Evidence | `src/schema/autonomous-run.schema.ts` (`AutonomousEvidencePacketSchema`), `src/services/autonomous-run-evidence-binding-service.ts` | `SandboxEvidenceSchema` (this Work Unit) is deliberately not a subtype of this -- it is a distinct evidence shape for the sandbox layer itself (backend/capabilities/mounts/environment-variable-names/network-policy/resource-policy/commands/output-size/termination-reason/cleanup), meant to compose alongside an `AutonomousEvidencePacket` in a later Work Unit, not replace it. |
| CLI configuration | `src/workflow/autonomous-run-config-resolution.ts`, `src/schema/autonomous-run-operator.schema.ts` | `AutonomousOperatorConfigSchema` has no sandbox-related field yet -- WU38-04 is expected to add one (e.g. an opt-in `liveExecutionEnabled`/backend-selection field), not this Work Unit. |
| Platform detection (general codebase precedent) | `src/workspaces/workspace-path-policy.ts` (`homedir()` via `node:os`), `src/tooling/repeated-run-validation-cli.ts`, `src/workflow/autonomous-run-config-resolution.ts` (`tmpdir()`) | `node:os` (not `node:net`/`node:http`/etc.) is already an established, boundary-scan-safe import in this codebase for read-only host inspection -- reused directly by `sandbox-filesystem-policy.ts` (this Work Unit) and expected to be reused by `sandbox-platform-decision.ts`'s real `process.platform` caller in WU38-04. |
| Path/symlink safety | `src/workspaces/workspace-path-policy.ts` (`validateWorkspaceRoot`, `lstatSync`-based symlink detection) | Established, reusable pattern for detecting a symlinked ancestor path; not imported directly by this Work Unit (`sandbox-filesystem-policy.ts` implements its own, narrower checks scoped to what is evaluable without a concrete run), but the pattern is available for WU38-02's real mount-path validation. |
| Environment projection | none | No prior AIQT capability ever selectively projects a curated environment into a child process -- `runAutonomousCommand` (M36) uses whatever `process.env` `execFileSync` inherits by default. `SandboxEnvironmentPolicySchema`/`sandbox-environment-policy.ts` (this Work Unit) are new. |
| Network policy (sandbox-specific) | none | M36/M37's `networkPolicy: "denied"\|"explicitly_enabled"` (`autonomous-run.schema.ts`) is a per-run *command-classification* flag, not a real network boundary (nothing in M36/M37 could actually enforce a destination allowlist -- there was no sandbox to enforce it inside). `SandboxNetworkPolicySchema`'s bound approval (candidate/provider/destination-allowlist/reason/duration/budget) is new, matching build spec Sec 6 exactly. |
| Cleanup/recovery | `src/workspaces/autonomous-worktree-lifecycle.ts` (`removeAutonomousWorktree`), the M37-WU03 `cleanupStatus` honesty fix | Directly analogous pattern (`SandboxCleanupStatusSchema`: `"cleaned"`/`"cleanup_failed"`, this Work Unit) -- WU38-02's real backend cleanup should follow the same "never hardcode success, always capture the real outcome" discipline the M37-WU03 bug fix established. |

### 2.2 Missing capabilities (not present anywhere in the repository; must be built in WU38-02 through WU38-05, not this Work Unit)

- A real sandbox backend implementation (any `SandboxBackend` implementer).
- Real container/namespace creation, mount configuration, or network interface configuration.
- Real process-tree ownership, orphan detection, or forced termination.
- Real resource enforcement (cgroup limits or equivalent).
- Real event streaming from a live sandboxed process.
- Real evidence export from an actual sandbox run.
- CLI wiring for any of the above (no `aiqt autonomous ...` command references anything in this Work Unit's new files).

### 2.3 Architecture ownership map (this Work Unit)

| Concern | Owner |
|---|---|
| Sandbox data contract (capabilities, policies, evidence shape) | `src/schema/sandbox-backend.schema.ts` |
| Backend interface (pure type, no implementer) | `src/workflow/sandbox-backend-contract.ts` |
| Platform/backend decision | `src/workflow/sandbox-platform-decision.ts` |
| Minimum-capability evaluation | `src/workflow/sandbox-capability-evaluation.ts` |
| Fallback recommendation (the only fallback decision point) | `src/workflow/sandbox-fallback-policy.ts` |
| Filesystem policy validation | `src/workflow/sandbox-filesystem-policy.ts` |
| Environment allowlist validation | `src/workflow/sandbox-environment-policy.ts` |
| Network policy validation | `src/workflow/sandbox-network-policy.ts` |
| Process policy validation | `src/workflow/sandbox-process-policy.ts` |
| Resource policy validation | `src/workflow/sandbox-resource-policy.ts` |

## 3. M37 Compatibility Requirement

The M37 request/import workflow (`aiqt autonomous run` without `--simulate`, followed by `aiqt autonomous agent-import`) is a **permanent** lower-risk fallback, not a temporary implementation M38 replaces. WU38-01 does not modify, bypass, deprecate, or even import any M37 CLI command file -- verified structurally by this document's own boundary scan (`tests/unit/sandbox-wu01-boundary-scan.test.ts`). Every fallback decision this Work Unit's code can produce (`sandbox-fallback-policy.ts`) points at the exact same command, `aiqt autonomous run`, and nothing in this Work Unit's schema or interface removes, narrows, or reinterprets any M37 contract.

## 4. Threat Model

For each threat: precondition, impact, required capability, prevention, detection, recovery, residual risk, test strategy.

### 4.1 Parent-repository and sibling-worktree access

- **Precondition:** a live agent process running inside a sandbox reads or writes files outside its assigned worktree -- the parent repository the worktree was created from, or another run's sibling worktree under the same worktree root.
- **Impact:** cross-run contamination, disclosure of another candidate's in-progress (possibly sensitive) repair, or corruption of the source repository this run was supposed to leave untouched.
- **Required capability:** `filesystem_isolation`, `read_only_mounts`, `writable_worktree` (`SandboxCapabilitySchema`).
- **Prevention:** `SandboxFilesystemPolicySchema.worktreeMount` is the sole `read_write` mount; every other mount must be `read_only` (`validateSandboxFilesystemPolicy`, `checkMount`). A real backend (WU38-02) must translate this into an actual OS-level bind mount/namespace view that structurally excludes the parent repository and sibling worktree directories -- not merely a path-prefix check inside the guest process (build spec Sec 2: path-prefix checks are not sandboxing).
- **Detection:** `SandboxEvidence.mounts` records every mount actually configured; a future evidence-review step can assert the parent repository/sibling worktree paths never appear there.
- **Recovery:** none once real access has occurred (an OS-level isolation failure is not something evidence review can undo) -- this is precisely why prevention must be a real kernel/container boundary, not application-level.
- **Residual risk:** WU38-01 defines the policy shape but no real enforcement exists yet -- `validateSandboxFilesystemPolicy` only rejects a policy that already fails abstract, evaluable checks (writable-mount-mode, home-directory, self-management); it cannot detect "this specific worktree's actual parent/sibling paths" because it has no real run's worktree path to compare against yet (Sec 2.1's own note). Closed concretely in WU38-02.
- **Test strategy:** `tests/unit/sandbox-filesystem-policy.test.ts` (this Work Unit, abstract checks only); a real cross-mount-escape integration test is WU38-05's "sibling-worktree access" required pilot scenario.

### 4.2 Host home directory and secret-store files

- **Precondition:** a sandboxed process reads `~/.ssh`, `~/.aws`, `~/.npmrc`, `~/.gitconfig`, or any other file under the operator's home directory.
- **Impact:** credential/secret disclosure to a live, less-trusted agent process.
- **Required capability:** `filesystem_isolation`.
- **Prevention:** `validateSandboxFilesystemPolicy`'s `checkMount` rejects any mount (worktree or read-only) whose host path resolves to `homedir()`. A real backend must not project the home directory into the sandbox at all, by default, under any mount.
- **Detection:** `SandboxEvidence.mounts` audit, same as 4.1.
- **Recovery:** none (same reasoning as 4.1).
- **Residual risk:** this check only catches a mount whose host path is *exactly* the home directory -- a policy naming a specific file *inside* the home directory (e.g. `~/.ssh/id_rsa` as its own explicit mount) would not be caught by this exact-match check. Closed by combining this with the environment-policy's separate secret-name blocklist (4.4) and, in WU38-02, a real backend that never grants filesystem access outside the two named categories (worktree, explicit read-only runtime paths) at all -- there is no "mount an arbitrary file" capability in the contract to misuse in the first place.
- **Test strategy:** `tests/unit/sandbox-filesystem-policy.test.ts` ("rejects a mount whose host path is the home directory"); WU38-05's "host-home read" required pilot scenario.

### 4.3 Environment variable leakage

- **Precondition:** a sandboxed process receives the operator's full host environment instead of an explicit, curated subset.
- **Impact:** wholesale credential/configuration disclosure via `process.env` inside the sandbox.
- **Required capability:** `environment_allowlist`.
- **Prevention:** `SandboxEnvironmentPolicySchema` has no field capable of expressing "inherit everything" -- only `allowedVariableNames: string[]`. A real backend (WU38-02) must construct the sandboxed process's environment from this allowlist alone, never by copying `process.env`.
- **Detection:** `SandboxEvidence.environmentVariableNames` records every name actually projected (never a value) -- a future audit can confirm it is a subset of the declared allowlist.
- **Recovery:** none once leaked; prevention is the only real control.
- **Residual risk:** WU38-01 defines the allowlist contract; no real backend enforces it yet.
- **Test strategy:** `tests/unit/sandbox-environment-policy.test.ts`.

### 4.4 SSH/Git credential exposure

- **Precondition:** a sandboxed process gains access to `SSH_AUTH_SOCK`, a Git credential helper, or a Git hosting token, and uses it to authenticate as the operator.
- **Impact:** unauthorized push/access to real repositories or services using the operator's own identity.
- **Required capability:** `environment_allowlist`, `filesystem_isolation`.
- **Prevention:** `validateSandboxEnvironmentAllowlist`'s `BLOCKED_ENV_VAR_PATTERNS` explicitly rejects `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `GIT_*`, `GH_TOKEN`, `GIT(HUB|LAB)?_TOKEN` even if named in an operator-supplied allowlist. Combined with 4.2's home-directory mount rejection (which would otherwise expose `~/.ssh` directly).
- **Detection:** same as 4.3.
- **Recovery:** if a leak is suspected, the operator must rotate the exposed credential/token outside AIQT -- no code in this repository can undo an external credential use.
- **Residual risk:** the blocklist is pattern-based and not exhaustive; a credential exposed under a genuinely novel variable name would not be caught. Mitigated by the allowlist being opt-in in the first place (an unknown variable is excluded by default, never included by default) -- the blocklist is defense in depth on top of that, not the primary control.
- **Test strategy:** `tests/unit/sandbox-environment-policy.test.ts` (parametrized over `SSH_AUTH_SOCK`, `GH_TOKEN`, `GIT_ASKPASS`, etc.); WU38-05's "secret access" required pilot scenario.

### 4.5 Network and DNS exfiltration

- **Precondition:** a sandboxed process opens an outbound network connection (including DNS resolution as a side channel) to exfiltrate repository contents or receive unauthorized instructions.
- **Impact:** data exfiltration or command-and-control channel outside AIQT's own mediation.
- **Required capability:** `network_deny` (always), `network_destination_restriction` (only when network is explicitly enabled).
- **Prevention:** `DEFAULT_SANDBOX_NETWORK_POLICY = {mode:"denied", approval:null}`; `validateSandboxNetworkPolicy` rejects any `"denied"` policy that carries an approval (inconsistent state) and rejects any `"explicitly_enabled"` policy missing a fully-bound approval (candidate/provider/non-empty destination allowlist/reason/duration/budget). `evaluateSandboxNetworkCapability` additionally requires the backend to report `network_destination_restriction` before any network-enabled run may proceed -- build spec Sec 6: "If destination controls cannot be enforced, network-enabled live execution is unsupported."
- **Detection:** `SandboxEvidence.networkPolicy` records the exact policy a run used; DNS resolution itself is a real backend's enforcement concern (WU38-02), not evaluable here.
- **Recovery:** none once exfiltration has occurred.
- **Residual risk:** no real backend enforces network denial or destination restriction yet; DNS-as-exfiltration-channel specifically requires the real backend to block DNS resolution to arbitrary resolvers, not merely block TCP/UDP to arbitrary IPs -- a requirement recorded here for WU38-02 to satisfy, not yet verifiable.
- **Test strategy:** `tests/unit/sandbox-network-policy.test.ts`; WU38-05's "network access" required pilot scenario.

### 4.6 Symlink, path, and mount escape

- **Precondition:** a mount's host path (or an ancestor of it) is itself a symlink pointing outside the intended boundary, or a policy names an arbitrary absolute path never intended to be reachable.
- **Impact:** the sandbox's own filesystem view silently includes something outside its declared mounts.
- **Required capability:** `filesystem_isolation`.
- **Prevention:** WU38-01 defines the mount schema (`SandboxMountSchema`) as an explicit, closed list -- there is no "mount everything under this glob" field. Real symlink-ancestor detection (M25's `validateWorkspaceRoot`/`lstatSync` pattern) is available to reuse in WU38-02's real mount-path resolution; this Work Unit's `sandbox-filesystem-policy.ts` does not yet call it (Sec 2.1).
- **Detection:** `SandboxEvidence.mounts` audit.
- **Recovery:** none.
- **Residual risk:** real symlink-ancestor walking is not implemented in this Work Unit. Explicitly carried to WU38-02.
- **Test strategy:** WU38-05's escape-testing required scope (build spec Sec "Escape Testing").

### 4.7 Privileged container or host socket exposure

- **Precondition:** a sandbox is created with a privileged flag, or the host's container/Docker socket is bind-mounted into the sandbox, granting the sandboxed process control over the host's container runtime itself.
- **Impact:** full host compromise -- privileged container escape is a well-known, complete sandbox bypass.
- **Required capability:** `filesystem_isolation`, `process_tree_control`.
- **Prevention:** the backend contract (`SandboxCreateRequest`) has no field for a "privileged" flag or an arbitrary host-socket mount at all -- there is no capability to misuse in the contract as defined. A real backend (WU38-02) must never run its container/namespace privileged and must never bind-mount its own control socket into the sandbox it creates.
- **Detection:** `SandboxEvidence.mounts`/`capabilities` audit -- any future mount list containing a Docker/container-runtime socket path should be treated as a policy violation regardless of any other passing check.
- **Recovery:** none (host compromise, same class as 4.1).
- **Residual risk:** WU38-01 has no real backend to audit yet.
- **Test strategy:** WU38-05's escape-testing scope; a future boundary-scan-style guard could assert no WU38-02+ backend file ever references a known container-socket path literal.

### 4.8 Process-tree escape and orphaning

- **Precondition:** a sandboxed agent process forks a child that survives the sandbox's own termination/cancellation, either by escaping the sandbox's process-tree ownership or by being reparented to the host `init`.
- **Impact:** an unbounded, unmonitored process continues running (resource consumption, or a residual attack surface) after AIQT believes the run has ended.
- **Required capability:** `process_tree_control`.
- **Prevention:** `SandboxCancellationResult.processTreeFullyStopped` is a required boolean a real backend must compute honestly (never assumed `true` by any caller) -- mirrors the exact "never hardcode success" discipline the M37-WU03 `cleanupStatus` bug fix established (Sec 2.1). A real backend (WU38-02/03) must own the sandbox's PID namespace (or container-runtime equivalent) so no child process can be reparented outside it.
- **Detection:** `SandboxProcessEvent`'s `"orphan_detected"` kind exists in the contract specifically for a real backend to report this.
- **Recovery:** a real backend's `destroy()` must be able to forcibly terminate the entire sandbox (namespace/container teardown), which also removes any orphan still inside it, even if `cancel()` alone could not stop it gracefully.
- **Residual risk:** real as of WU38-03 -- `DockerSandboxBackend.cancel()` stops (escalating to kill) the one container every command runs inside, re-verified via `docker inspect`, giving a genuine kernel-enforced (PID namespace) guarantee that the whole tree is gone. Not yet exercised against a REAL adversarial fork/reparent attempt -- WU38-05's escape test is the first Work Unit that actually tries to defeat this, not merely exercises the happy path.
- **Test strategy:** `tests/integration/sandbox-docker-backend.test.ts`'s WU38-03 cancellation tests (real container, real `docker inspect` confirmation); WU38-05's "orphan process" required pilot scenario for a real adversarial attempt.

### 4.9 Fork bomb / process-count exhaustion

- **Precondition:** a sandboxed process rapidly forks children without bound, exhausting host process table or scheduler capacity.
- **Impact:** host-level denial of service, potentially affecting processes outside the sandbox if the process-count limit is not enforced at a real kernel boundary (a cgroup `pids` controller or namespace-level limit, not an application-level counter).
- **Required capability:** `process_count_limit`, `process_tree_control`.
- **Prevention:** `SandboxProcessPolicySchema.processCountLimit` and `SandboxResourcePolicySchema.maxProcessCount` are both required, positive, finite, and bounded to a reasonable ceiling (`validateSandboxProcessPolicy`/`validateSandboxResourcePolicy`). A real backend must enforce this via a kernel-level primitive (e.g. a cgroup `pids.max`), not a userspace count that a fast-forking process could race past.
- **Detection:** `SandboxProcessEvent` stream; a real backend should emit a `"terminated"` event with `terminationReason:"resource_limit_exceeded"` (`SandboxTerminationReasonSchema`) the moment the limit is hit.
- **Recovery:** `destroy()` (namespace/container teardown) is the guaranteed-effective recovery even if graceful/forced termination of individual processes cannot keep up with the fork rate.
- **Residual risk:** `--pids-limit` is applied at real `docker create` time as of WU38-02 (a real cgroup `pids` controller, kernel-enforced, verifiable via `docker inspect` even before WU38-03's process launch existed). Not yet exercised against a real fork bomb -- WU38-05's escape test is where that actually gets attempted.
- **Test strategy:** WU38-05's "process-limit escape" and CPU/memory/disk-exhaustion required pilot scenarios.

### 4.10 CPU, memory, disk, and output exhaustion

- **Precondition:** a sandboxed process consumes CPU, memory, disk writes, or produces output beyond any reasonable bound, whether maliciously or through a genuine runaway bug in the agent's own proposed commands.
- **Impact:** host resource starvation, disk exhaustion, or an unbounded evidence-capture buffer.
- **Required capability:** `cpu_limit`, `memory_limit`, `disk_limit`.
- **Prevention:** `SandboxResourcePolicySchema` requires `maxCpuSeconds`, `maxMemoryBytes`, `maxDiskWriteBytes`, `maxOutputBytes` (in addition to `maxWallClockSeconds`/`maxCommandCount`/`maxRetryCount` already established by M36's `AutonomousBudgetsSchema` precedent) -- `validateSandboxResourcePolicy` rejects any non-positive, non-finite, or unreasonably large value for every one of these. A real backend must enforce CPU/memory/disk via kernel cgroup limits, and output capture must be bounded and truncated (mirroring `git-command-runner.ts`'s existing `sanitizeGitOutput` bounded-output discipline) rather than buffered without limit.
- **Detection:** `SandboxEvidence.outputBytesCaptured` records the real captured size; a real backend's termination event carries `terminationReason:"resource_limit_exceeded"` when any of these limits is hit.
- **Recovery:** `destroy()`, same as 4.9.
- **Residual risk:** CPU (`--cpus`, a real rate limit, not a total-seconds accounting mechanism) and memory (`--memory`/`--memory-swap`) are real, kernel-enforced cgroup limits as of WU38-02. Disk-write-byte enforcement is real but DETECTIVE as of WU38-03 (`checkDiskUsageBytes`, a real `docker exec ... du -sb`, called by `sandbox-command-loop.ts` after every command) -- not a kernel-preventive limit; a single command that writes an enormous amount in one shot before the next check runs could still exceed the budget before being caught. Output-byte bounding exists at the event-capture layer (`MAX_EVENT_DETAIL_CHARS`) but `maxOutputBytes` is not yet independently enforced as a run-stopping budget by the command loop.
- **Test strategy:** `tests/unit/sandbox-resource-policy.test.ts` (policy-shape validation); `tests/unit/sandbox-command-loop.test.ts` (disk-budget-triggered `resource_limit_exceeded` termination, using a fake backend); `tests/integration/sandbox-docker-backend.test.ts`'s real `checkDiskUsageBytes` test; WU38-05's CPU/memory/disk-exhaustion required pilot scenarios for real adversarial enforcement.

### 4.11 Cleanup failure

- **Precondition:** sandbox teardown (mount unmount, container/namespace removal, temp-directory deletion) fails partway, leaving residual state.
- **Impact:** disk space leak, a stale sandbox instance an operator does not know exists, or (worst case) a still-running orphaned process (overlaps 4.8).
- **Required capability:** `deterministic_cleanup`.
- **Prevention:** `SandboxCleanupStatusSchema` is exactly `"cleaned"` | `"cleanup_failed"` -- there is no third, ambiguous state, and (per the M37-WU03 precedent named throughout this document) a real backend's `cleanup()` must capture its own real outcome rather than assume success.
- **Detection:** `SandboxEvidence.cleanupStatus` plus `SandboxCleanupResult.reason` (a human-readable explanation of what remains, mirroring `aiqt autonomous cleanup`'s own M37 refusal-to-delete-record behavior for a failed cleanup).
- **Recovery:** real as of WU38-04: `aiqt autonomous cleanup` detects a run whose `sandboxContainerId` is set but whose `sandboxEvidence.cleanupStatus` is not confirmed `"cleaned"`, and attempts a real `backend.destroy()` (a fresh Docker connection, possibly a fresh process entirely -- this is also the crash-recovery mechanism for 4.8/threat "AIQT itself dies mid-run") before allowing the run record to be deleted. If the sandbox backend is unavailable at that moment, cleanup refuses outright, preserving the only reference to the possibly-still-orphaned container -- the same "never delete the only reference to an orphaned resource" discipline M37 established for worktrees.
- **Residual risk:** the crash-recovery retry itself has not been exercised against a genuinely crashed AIQT process (only a hand-constructed "orphaned container + edited run record" simulation, `tests/integration/sandbox-live-execution.test.ts`'s crash-recovery test) -- a real kill -9 mid-run scenario is WU38-05 escape-testing scope, not yet attempted.
- **Test strategy:** `tests/integration/sandbox-live-execution.test.ts`'s crash-recovery test (real orphaned container, real destroy retry, real confirmation via `docker inspect` that it is gone); WU38-05's controlled pilot must include at least one deliberately-forced cleanup-failure scenario, mirroring M36-WU05/M37-WU05's own dirty-worktree regression tests.

### 4.12 Stale sandbox reuse

- **Precondition:** a sandbox handle from a prior, already-terminated run is reused for a new run instead of creating a fresh sandbox.
- **Impact:** cross-run contamination -- a new run could inherit files, environment, or process state left over from a previous, unrelated (possibly compromised) run.
- **Required capability:** `deterministic_cleanup`, `filesystem_isolation`.
- **Prevention:** `SandboxHandle`/`SandboxProcessHandle` are opaque, single-use identifiers scoped to one `create()` call each -- the contract has no "reset and reuse an existing handle" method at all, only `create`/`destroy`. A real backend must generate a fresh sandbox identity per run and must never accept a handle from a prior `create()` call as input to a new one.
- **Detection:** a future evidence-review step could assert every run's `SandboxHandle.sandboxId` is unique across all persisted run records.
- **Recovery:** discard the reused sandbox and its evidence; treat the run as `sandbox_creation_failed`.
- **Residual risk:** no real backend exists yet to enforce single-use handles at runtime; the contract only makes reuse structurally awkward (no method to reuse), not impossible for a non-conforming implementation.
- **Test strategy:** WU38-05's escape-testing scope; a future backend-conformance test suite (WU38-02) should assert two consecutive `create()` calls never return the same `sandboxId`.

### 4.13 Evidence tampering

- **Precondition:** a sandboxed process (or a compromised backend) modifies or fabricates its own evidence packet before export.
- **Impact:** a human reviewer trusts a false account of what happened during the run.
- **Required capability:** `forensic_capture`.
- **Prevention:** `exportEvidence()` (the backend contract) is a distinct method from anything the sandboxed process itself has access to -- the sandboxed process has no contract-level capability to write to wherever `SandboxEvidence` is ultimately persisted; evidence collection is the backend's own responsibility, mirroring how M36's `produceAutonomousEvidencePacket` derives evidence from real command results and real diffs, never from anything the agent adapter itself asserts about its own behavior.
- **Detection:** (future) evidence could be bound with a digest the way M37's approval binding already is (`computeApprovalBindingDigest`, `autonomous-run-approval.ts`) -- not built in this Work Unit, but the same canonicalize-and-hash primitive (`src/schema/external-evidence/canonical-json.ts`, per the repository owner map's `canonicalJson` entry) is available to reuse.
- **Recovery:** discard the run's result; do not act on unverifiable evidence.
- **Residual risk:** evidence integrity binding is not implemented in this Work Unit or contract; recorded here as a concrete recommendation for WU38-04.
- **Test strategy:** not testable until a real evidence-export implementation exists (WU38-04).

### 4.14 Silent unsandboxed fallback

- **Precondition:** sandbox creation or capability verification fails, and the system proceeds to execute the agent's proposed commands anyway, without real isolation, without telling the operator.
- **Impact:** the single most severe failure mode this milestone exists to prevent -- an operator believes their run is sandboxed when it is not, exactly build spec Sec 4's "Out of Scope: silent fallback to unsandboxed execution."
- **Required capability:** none -- this is a structural/behavioral guarantee, not a capability.
- **Prevention:** `evaluateSandboxCapabilities`/`evaluateSandboxNetworkCapability` return exactly two outcomes: `sufficient:true` (proceed) or a `SandboxFallbackRecommendation` naming the M37 request/import workflow. There is no third return value meaning "proceed anyway, unsandboxed" -- the type system itself has no branch that would let a caller silently execute without checking this result. `buildSandboxFallbackRecommendation`'s own doc comment states this module "contains no process-spawning ... code of any kind."
- **Detection:** the boundary scan (`tests/unit/sandbox-wu01-boundary-scan.test.ts`) asserts none of this Work Unit's files contain any process-execution surface at all -- there is nothing to silently fall back to inside this Work Unit's own code.
- **Recovery:** N/A at this Work Unit (no execution path exists to have silently fallen back from).
- **Residual risk:** real as of WU38-04 -- `aiqt autonomous agent-import --live` calls `prepareLiveSandbox`, which runs the same two-outcome `checkAvailability`/`evaluateSandboxCapabilities` check for real before ever calling `backend.create()`; any failure returns a CLI-level refusal naming the fallback recommendation, never an execution. The two-outcome shape from WU38-01 was preserved exactly, not widened. The remaining residual risk is narrower now: no code path in this codebase can proceed unsandboxed, but a MISCONFIGURED operator (setting `liveExecutionEnabled: true` without understanding what it does) could still be surprised by real sandboxed execution happening at all -- mitigated by requiring the explicit `--live` flag on top of the config opt-in (two independent, both-required gates), never either alone.
- **Test strategy:** `tests/unit/sandbox-capability-evaluation.test.ts` ("insufficient capabilities recommend request/import, never a silent proceed"); the boundary scan; `tests/integration/sandbox-live-execution.test.ts`'s "opt-in gate" test (refused before any Docker check when the config gate is off).

### 4.15 AIQT self-targeting

- **Precondition:** a sandbox is created for a run whose target repository is the AIQT product's own repository.
- **Impact:** AIQT modifying its own source inside a live, less-supervised sandbox -- the exact scenario M36 Sec 3.21 and every M37 Work Unit's self-management guard exists to prevent, now with a live process instead of a bare `execFileSync` call.
- **Required capability:** none -- structural guard, reused directly from M37.
- **Prevention:** `validateSandboxFilesystemPolicy`'s `checkMount` calls `isAiqtOwnRepository` (M37's own self-management guard, `src/workflow/autonomous-run-self-management-guard.ts`, imported unmodified) against every mount's host path -- the same fail-closed check M37 re-verifies at every real-execution boundary, now extended to the sandbox filesystem policy layer.
- **Detection:** a rejected `SandboxFilesystemPolicyValidation.issues` entry naming the specific mount.
- **Recovery:** N/A -- the policy is rejected before any sandbox is created.
- **Residual risk:** none beyond `isAiqtOwnRepository`'s own documented limitation (a `package.json` `name:"aiqt"` marker check, not a `cwd`/install-location comparison) -- unchanged from M37, not newly introduced by this Work Unit.
- **Test strategy:** `tests/unit/sandbox-filesystem-policy.test.ts` ("rejects a mount whose host path is the AIQT product's own repository").

## 4.16 M38-WU04 Addendum: `sourceRepositoryMount` -- a Deliberate, Narrow Exception to "Worktree Is the Only Writable Mount"

Build spec Sec 8 invariant 6 states "Worktree is the only writable repository mount." A real CI failure during WU38-04 (this project's own development machine has no Docker to have caught it locally) revealed this could not be honored literally: a linked Git worktree's own `.git` file is a plain-text pointer ("gitdir: `<absolute host path>`") into its parent repository's `.git/worktrees/<id>` administrative directory -- required, real-write Git state (that worktree's own HEAD, index, etc.) that Git itself manages, not something AIQT invented. Without it mounted at the identical absolute path inside the sandbox, every Git command fails with `fatal: not a git repository`.

**The fix, scoped as narrowly as the requirement allows:** `SandboxFilesystemPolicy.sourceRepositoryMount` (nullable; null for any sandbox not backing a Git worktree) mounts only `<repositoryPath>/.git` -- never the source repository's own working tree -- read-write, at the identical host path (`validateSandboxFilesystemPolicy` structurally enforces hostPath === sandboxPath, since the gitdir pointer is an absolute path baked in at `git worktree add` time and cannot be remapped). This is not a new capability beyond what the non-sandboxed M36/M37 bare-worktree path already had: a bare `execFileSync` call there has unrestricted host filesystem access to begin with, so gating an already-existing dependency behind an explicit, validated, narrowly-scoped mount is strictly more restrictive than the pre-M38 baseline, not less. The self-management guard (`isAiqtOwnRepository`) applies to this mount exactly as it does to every other one.

- **Test strategy:** `tests/unit/sandbox-filesystem-policy.test.ts` (hostPath/sandboxPath-must-match rejection, read-only rejection, self-management rejection, null-is-valid); `tests/integration/sandbox-live-execution.test.ts`'s real `--live` tests (a real `git mv`/`git commit` succeeding inside the sandbox is the real proof this mount works as intended).

## 5. Explicit Statement: No Live Sandbox or Agent Process Exists Yet

Nothing in this Work Unit creates a container, namespace, mount, network interface, or process. `src/workflow/sandbox-backend-contract.ts` defines an interface with zero implementers. `tests/unit/sandbox-wu01-boundary-scan.test.ts` verifies every file this Work Unit added contains no process-spawning, networking, or dynamic-code-execution surface, matching the exact pattern `tests/unit/autonomous-run-boundary-scan.test.ts` established for M36-WU01.
