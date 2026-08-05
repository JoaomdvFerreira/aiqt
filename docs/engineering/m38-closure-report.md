# M38 Closure Report — Sandboxed Live Agent Execution

## Entry-gate evidence (verified before WU38-01 began)

- `docs/engineering/m37-closure-report.md` and `docs/engineering/m37-wu05-operator-workflow.md` present.
- Tag `m37-autonomous-runner-cli` present, pointing at the M37 closure commit (`749fd1f`), confirmed identical to the working tree's `HEAD` at the time WU38-01 began.
- Final M37 CI green on Node 24: 6/6 jobs, 3/3 test shards, 2804/2804 tests, 0 timeouts, 0 assertion failures.
- M37 controlled-pilot evidence present for all 10 required scenarios (`docs/engineering/m37-wu05-controlled-pilot-evidence.generated.json`).
- `ImportedResponseAgentAdapter` and the request/import workflow present and unmodified throughout M38.
- Working tree clean; no `.aiqt/` directory.
- No automatic merge, real PR creation, deployment, or AIQT self-management path existed anywhere in the M37 codebase.

Also triaged before WU38-02 began, per the build spec's own requirement: Dependabot alert #9 (`brace-expansion` DoS, GHSA-rgw5-rvv9-x895) — a dev-only, transitive dependency (via eslint's glob chain), remediated (not merely accepted) by bumping the existing pnpm override from `>=5.0.8` to `>=5.0.9`. GitHub's own re-scan confirmed `state: "fixed"` before WU38-02 work began.

## Starting / ending commit and version range

| | Commit | Package version |
|---|---|---|
| Start (M37 close) | `749fd1f` | 0.28.0 |
| Dependabot remediation | `1989133` | 0.29.1 |
| WU38-01 close | `a8b620a` | 0.29.0 |
| WU38-02 close (fixed) | `e42ae64` | 0.30.0 |
| WU38-03 close (fixed) | `8e6c019` | 0.31.0 |
| WU38-04 close (fixed) | `6cf127f` | 0.32.3 |
| WU38-05 close | (this Work Unit's own commit) | 0.32.3 (no `src/` change) |

`AIQT_SCHEMA_VERSION` was never touched by M38 — nothing in this milestone persists to AIQT's own canonical `.aiqt/state.json`/`runlog.jsonl` shape; every sandbox-related schema family (`sandbox-backend.schema.ts` and its extensions to the M37 `autonomous-run-operator`/`autonomous-run-record` schemas) is a separate, additive concern, never a change to the canonical state shape itself.

## Work Unit table

| Work Unit | Tag | Risk score | Summary |
|---|---|---|---|
| WU38-01 | `m38-wu01-sandbox-contract` | 40/100 | Pure architecture: platform decision (Linux only, `oci-container@1`), 15-threat model, capability model, a zero-implementer `SandboxBackend` interface, five pure policy validators, and the single fallback-recommendation function. No process launch, no container, no network. |
| WU38-02 | `m38-wu02-sandbox-isolation-backend` | 60/100 | First real `SandboxBackend`: `DockerSandboxBackend`. Real, tested `checkAvailability`/`reportCapabilities`/`create`/`cleanup`/`destroy` — real mounts, environment allowlist, `--network none`, resource flags, security hardening, a pinned embedded-Dockerfile image. `launchProcess`/`streamEvents`/`cancel`/`collectResult`/`exportEvidence` were honest "not yet supported" stubs. One real CI-only defect found and fixed (cold `docker build` exceeding the per-test timeout). |
| WU38-03 | `m38-wu03-live-agent-process-control` | 70/100 | `launchProcess`/`streamEvents`/`cancel`/`collectResult`/`exportEvidence` made real: `docker exec`-based execution, a real per-sandbox event log, real cancellation (`docker stop` escalating to `kill`, always re-verified via `docker inspect`). New `sandbox-command-loop.ts`'s `executeSandboxedCommandLoop` mediates every command through the same M36 `decideCommand` classifier before ever executing it. Two real defects found and fixed only by CI (a Docker bind-mount UID mismatch; a stale test assertion contradicting the Work Unit's own new capability set). |
| WU38-04 | `m38-wu04-live-execution-cli-and-forensics` | 65/100 | Opt-in live execution wired into the CLI: `aiqt autonomous agent-import --live`, gated by two independent, both-required opt-ins (operator config + per-invocation flag) checked before any capability probe. Real crash recovery via `aiqt autonomous cleanup`. Three real defects found and fixed only by CI, none reproducible on this project's own Docker-less development machine: sandboxed git needing `HOME`/`safe.directory`/identity; a linked Git worktree's `gitdir` pointer requiring the source repository's own `.git` directory mounted into the sandbox too (`sourceRepositoryMount`, a deliberate, narrow, documented exception to "worktree is the only writable mount"); and `filesChanged` evidence needing to be captured via a real committed-diff query before `cleanup()` destroys the container. |
| WU38-05 | `m38-wu05-sandboxed-live-agent-pilot` / `m38-sandboxed-live-agent-execution` | 45/100 | Adversarial escape testing (10 scenarios, real Docker) plus the controlled pilot (satisfied by WU38-04's own real end-to-end `--live` scenarios, not duplicated). This closure report. No new production code — tests and documentation only. |

## Platform decision (WU38-01, unchanged through closure)

Linux only, via an OCI-compatible container runtime (`docker-oci@1`, concretely Docker Engine). Windows and macOS are unsupported initially and fail closed to the M37 request/import fallback — chosen because this repository's own CI runs exclusively on `ubuntu-latest`, so claiming Docker Desktop VM-backed parity on other platforms would be an unverified guarantee. Confirmed by every real-Docker test in this milestone running successfully in CI (Linux) while self-skipping (never failing) on this project's own Windows development machine throughout. See `docs/engineering/m38-sandbox-platform-decision.md` for full detail, including the concrete host-dependency/image/mount/network/resource/hardening/cleanup table added across WU38-02 through WU38-04.

## Threat model

15 named threats (`docs/engineering/m38-sandbox-threat-model.md` Sec 4), each with precondition/impact/required-capability/prevention/detection/recovery/residual-risk/test-strategy: parent-repo/sibling-worktree access, host-home/secret-store files, environment leakage, SSH/Git credential exposure, network/DNS exfiltration, symlink/path/mount escape, privileged container/host-socket exposure, process-tree escape/orphaning, fork bomb, CPU/memory/disk/output exhaustion, cleanup failure, stale sandbox reuse, evidence tampering, silent unsandboxed fallback, and AIQT self-targeting. A WU38-04 addendum (Sec 4.16) documents the one deliberate, narrow exception to "worktree is the only writable mount" (`sourceRepositoryMount`), and residual-risk notes throughout were updated as each threat's real mitigation landed across WU38-02/03/04.

## Capabilities

13 named capabilities (`SandboxCapabilitySchema`). `DockerSandboxBackend` reports 12 of them as of WU38-03/04: `filesystem_isolation`, `read_only_mounts`, `writable_worktree`, `network_deny`, `environment_allowlist`, `cpu_limit`, `memory_limit`, `process_count_limit`, `process_tree_control`, `disk_limit` (real but detective — see below), `deterministic_cleanup`, `forensic_capture`. `network_destination_restriction` is **permanently** never claimed — plain Docker has no destination-allowlist/egress-proxy mechanism, so network-enabled live execution remains unsupported by this backend for the entire milestone, by design, not an oversight.

## Filesystem, environment, network, process, resource policies

- **Filesystem:** exactly one writable mount (the worktree) plus zero or more read-only mounts plus a dedicated output mount, plus (live mode only) the source repository's `.git` directory at an identical host/sandbox path — required for a linked Git worktree to function at all, found via a real CI-only failure and documented as a deliberate, narrow exception.
- **Environment:** an explicit allowlist only (`-e NAME`, sourced from the host by Docker itself — AIQT's own code never touches a value); zero variables projected by default; a fixed `HOME=/tmp` operational variable (not operator-controlled) added in WU38-04 after a real CI-only failure.
- **Network:** always `--network none`; network-enabled live execution is permanently unsupported by this backend.
- **Process:** `--pids-limit` (real cgroup `pids` controller); full process-tree ownership via the container's own PID namespace — cancellation stops/kills the one container every command runs inside, a kernel-enforced guarantee the whole tree is gone.
- **Resources:** `--cpus` (a real rate quota, computed from `maxCpuSeconds/maxWallClockSeconds`, clamped `[0.1, 4]`), `--memory`/`--memory-swap` (real cgroup limits), disk usage checked via a real `docker exec ... du -sb` (detective, not kernel-preventive — a named residual risk).
- **Command mediation:** every proposed command is classified via the same, already-reviewed M36 `decideCommand` classifier before it ever reaches the sandbox — no new policy logic was introduced by M38.

## Escape-test evidence (WU38-05)

10 scenarios, real Docker daemon (`tests/integration/sandbox-escape-testing.test.ts`), all passing in CI:

| Scenario | Result |
|---|---|
| Parent-repo write | Fails — the parent repository's own working tree is never mounted (only `.git`, when present at all). |
| Host-home read | Fails — the operator's real home directory is never mounted; no key material appears in captured output. |
| Sibling-worktree access | Fails — a second run's own worktree is invisible from the first run's sandbox. |
| Secret access | No environment variable beyond the fixed `HOME` appears inside the sandbox by default. |
| Network access | Denied — no real response from an external host ever reaches a command's captured output. |
| Process-limit escape | `--pids-limit` is a real, kernel-enforced value, confirmed via `docker inspect`. |
| Orphan process | A detached background process does not survive `destroy()` — confirmed via `docker inspect` failing afterward. |
| Nested cancellation | `cancel()` while a detached background process is genuinely still active fully stops the container (`processTreeFullyStopped:true`, confirmed via `docker inspect`). |
| CPU exhaustion | The real cgroup CPU quota (`NanoCpus`) matches the computed value, confirmed via `docker inspect`. |
| Memory exhaustion | The real cgroup memory limit matches the configured value, confirmed via `docker inspect`. |
| Disk exhaustion | `checkDiskUsageBytes` detects real usage growth after a real large write. |

"Successful repair" and "crash recovery" (also required scenarios) are not duplicated in the escape-test file — already covered end-to-end, through the real public CLI, by `tests/integration/sandbox-live-execution.test.ts` (WU38-04): a full `classify → run → agent-import --live` pipeline producing `resultState:passed` with real evidence, and a hand-constructed orphaned-container simulation that a later `aiqt autonomous cleanup` invocation really destroys.

## Pilot scenarios (the "controlled pilot")

Satisfied by WU38-04's own real, end-to-end `--live` scenarios (not duplicated by a separate pilot file, a deliberate scope decision recorded here): the opt-in gate refusing before any Docker check; a full successful live repair (real sandbox execution, real evidence, real worktree/branch cleanup, default branch untouched); a validation-failed run (no targeted validation commands); a destructive command denied before it ever reaches the sandbox; and crash recovery (a real orphaned container, hand-attached to a run record the way a genuine mid-run crash would leave it, really destroyed by a later `aiqt autonomous cleanup` call).

## Unsupported-host behavior and fallback

Real on every platform, including this project's own Windows development machine (no Docker required to verify): a fresh `DockerSandboxBackend` on a non-Linux platform reports `available:false` with a clear reason via `checkAvailability()`, before any sandbox is ever attempted. Independently, `evaluateSandboxCapabilities`/`evaluateSandboxNetworkCapability` (WU38-01) return exactly two outcomes — sufficient, or a fallback recommendation naming the M37 request/import workflow — with no third "proceed unsandboxed" branch anywhere in the type system. `aiqt autonomous agent-import --live` reuses this exact same two-outcome check before ever creating a real sandbox. The request/import workflow (`aiqt autonomous agent-import`, without `--live`) is unmodified since M37 and remains the permanent, always-available fallback.

## Validation and CI evidence

Every Work Unit's commit was validated locally (typecheck/lint/build/version:check, full `vitest run`) before push, and confirmed via a real GitHub Actions CI run before the next Work Unit began — per this repository's own established discipline. Three Work Units (WU38-02, WU38-03, WU38-04) required real, CI-only fix-and-retag cycles, since this project's own development machine has no Docker to reproduce container-level defects locally; every one of those defects is documented above and in its own Work Unit's commit history, never silently patched over.

## Residual risks (carried forward, not closed by this milestone)

- **`disk_limit` is detective, not kernel-preventive.** A single command that writes an enormous amount in one shot could exceed the configured budget before the next `checkDiskUsageBytes` check catches it. No portable, real block-device write-rate limit exists for a bind-mounted worktree across CI/host environments.
- **`maxOutputBytes` is not yet independently enforced as its own run-stopping budget** by the command loop (only disk usage is checked after each command).
- **Network-enabled live execution is permanently unsupported by this specific backend.** A future backend/egress-proxy addition could change this; none exists today.
- **Sandbox-specific resource dimensions the M36 `AutonomousBudgetsSchema` never had** (CPU seconds, memory bytes, disk-write bytes, process count, output bytes) use fixed, conservative defaults inside `sandbox-run-execution-service.ts`, not yet exposed as their own operator-configurable budgets.
- **Self-review for live-mode runs is narrower than M36's own** (`reviewAutonomousRun`) — only checks "zero files changed"; no real diff-line-count or unexpected-file-outside-scope detection exists for sandboxed runs yet.
- **`tests/` is excluded from this repository's own `tsc` project** (`tsconfig.json`) — a missing required field in a test fixture is invisible to `pnpm typecheck` and can only be caught by actually running the affected tests. This was a real, pre-existing repository-wide decision (not introduced by M38) that measurably slowed down this milestone's own CI-only debugging cycles; recorded here as a candidate for a future, separate decision, not altered as a side effect of this milestone's own bug fixes.
- **The crash-recovery retry has only been exercised against a hand-constructed simulation**, not a genuine `kill -9` mid-run of the AIQT process itself.
- **The minimum real Docker Engine version is unpinned** — `checkAvailability()` accepts whatever version is present and reports it verbatim; this repository's own CI (`ubuntu-latest`) is the only environment this milestone's own tests have verified against.

## Explicit statement: auto-merge remains disabled

No function anywhere in the M38 codebase merges, pushes, or checks out an `autonomous/`-prefixed branch back onto a target repository's default branch — unchanged from M37, verified across every live-execution test in this milestone (every scenario's target repository's default branch and `HEAD` are asserted byte-identical before and after). `aiqt autonomous agent-import --live` produces the same `CommandResult` shape as the non-live path; nothing in M38 adds a merge, push, or deployment capability of any kind.

## Recommendation on limited operator use

Live sandboxed execution is real, tested against a real Docker daemon in CI, and adversarially probed against 10 escape scenarios, all closed. It remains **opt-in at two independent layers** (operator config + per-invocation flag), requires real capability preflight before every use, and is built entirely on top of the same command-mediation, approval, and evidence discipline M36/M37 already established and this milestone reused unmodified. This milestone recommends **limited, supervised operator use of `--live`**, exactly as M37 recommended for the request/import path: a human still runs their own coding-agent tool (or supplies the command list directly), reviews every evidence packet, and manually integrates the result. `--live` changes *where* an already-decided command list executes — inside a real, isolated sandbox instead of a bare worktree — never *who* decides what to run, and never removes the human integration boundary.
