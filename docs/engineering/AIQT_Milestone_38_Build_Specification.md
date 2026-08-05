# AIQT Milestone 38 Build Specification

## Sandboxed Live Agent Execution

**Product:** AIQT CLI  
**Milestone:** M38  
**Status:** Ready for WU38-01 entry-gate verification  
**Risk classification:** High-risk  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 5  
**Primary objective:** Add optional live coding-agent execution inside a real operating-system isolation boundary, with deterministic process control, restricted filesystem and network access, bounded resources, complete evidence, and no automatic merge.

---

## 1. Entry Gate

M37 is reported formally closed. WU38-01 may begin only after the repository verifies:

- `docs/engineering/m37-closure-report.md` exists.
- `docs/engineering/m37-wu05-operator-workflow.md` exists.
- Tag `m37-autonomous-runner-cli` exists and points to the intended closure commit.
- Final M37 CI is green on Node 24:
  - all 6 jobs passed;
  - all 3 test shards passed;
  - 2804/2804 tests passed;
  - 0 timeouts;
  - 0 assertion failures.
- M37 controlled-pilot evidence for all 10 required scenarios exists.
- `ImportedResponseAgentAdapter` and the request/import workflow remain available as the lower-risk fallback.
- Repository is clean.
- Product `.aiqt/` self-management state is absent.
- No automatic merge, real PR creation, deployment, or AIQT self-management path exists.

WU38-01 remains non-executing even after this gate passes.


## 1.1 M37 Baseline Carried Forward

M38 must preserve the following M37 behavior:

- eight public `aiqt autonomous ...` commands;
- M33-compatible human and JSON results;
- request/import architecture through `ImportedResponseAgentAdapter`;
- deterministic persisted request state across process boundaries;
- approval binding and stale-approval rejection;
- branch, patch, and PR-draft handoff;
- manual external-agent execution;
- manual evidence review and integration;
- no automatic merge;
- no live agent process owned by AIQT.

The request/import workflow is a permanent safe fallback, not a temporary implementation to be removed by M38.

---

## 2. Product Objective

M38 introduces an explicitly sandboxed live-execution mode:

```text
approved candidate
→ sandbox capability check
→ isolated filesystem view
→ restricted environment
→ denied-by-default network
→ live agent process
→ command mediation
→ resource enforcement
→ validation
→ self-review
→ evidence packet
→ human integration decision
```

Core invariant:

```text
No live agent process runs unless the backend can enforce filesystem,
process, network, resource, and environment boundaries.
```

`cwd`, prompt instructions, path-prefix checks, or post-hoc diff inspection are not sandboxing.

---

## 3. Scope

M38 covers:

- sandbox backend abstraction;
- one initial sandbox implementation;
- filesystem mount policy;
- worktree projection;
- restricted process identity where supported;
- network deny-by-default;
- environment projection;
- secret exclusion;
- process-tree ownership;
- deterministic cancellation;
- CPU, memory, disk, process-count, output, and wall-clock limits;
- command mediation;
- output capture;
- cleanup and forensic evidence;
- request/import fallback;
- controlled pilot.

---

## 4. Out of Scope

M38 must not implement:

- automatic merge, push, approval, or deployment;
- unrestricted network access;
- secret provisioning;
- arbitrary provider plugins;
- concurrent agent swarms;
- multi-issue batching;
- privileged host operations;
- AIQT self-management;
- silent fallback to unsandboxed execution;
- unsupported-platform behavior presented as equivalent isolation.

---

## 5. Platform Strategy

WU38-01 must choose the initial supported platform and backend.

Valid initial outcomes include Linux container/runtime isolation, Linux namespace isolation, or another primitive with equivalent enforceable guarantees.

Windows support must be explicit:

- supported through a real backend;
- supported only through WSL/container infrastructure; or
- unsupported initially.

Unsupported hosts must fail closed and recommend request/import.

---

## 6. Governing Decisions

### Sandbox backend contract

The backend must expose capabilities for:

- availability inspection;
- sandbox creation;
- filesystem projection;
- environment projection;
- network policy;
- resource limits;
- process launch;
- event streaming;
- process-tree cancellation;
- result collection;
- evidence export;
- cleanup verification;
- destruction.

### Filesystem policy

Default view:

- approved worktree: read/write;
- approved runtime/tool paths: read-only;
- isolated temp/output directories;
- no host home;
- no parent repository;
- no sibling worktrees;
- no secret stores;
- no arbitrary absolute paths.

### Network policy

Default:

```text
network = denied
```

Network requires explicit approval bound to candidate, provider, destination policy, reason, duration, and budget. If destination controls cannot be enforced, network-enabled live execution is unsupported.

### Environment policy

Only explicit variables may be projected. Do not inherit the host environment wholesale.

Blocked by default:

- cloud credentials;
- Git credentials;
- SSH agent sockets;
- registry tokens;
- API keys;
- CI secrets.

### Process policy

The sandbox must own the complete process tree and support:

- graceful stop;
- forced termination;
- orphan detection;
- process-count limit;
- cleanup verification.

### Resource policy

Enforce:

- wall clock;
- CPU;
- memory;
- disk writes;
- process count;
- command count;
- output size;
- retries.

### Command mediation

Every requested command must be classified, approved or rejected, executed inside the sandbox, bounded, and recorded. Direct host shell access is prohibited.

### Evidence

Record backend/version, capabilities, mounts, environment variable names, network policy, limits, process lifecycle, commands, bounded output, changes, diff, validation, self-review, termination reason, cleanup, and residual risk.

### Fallback

If sandbox capability is insufficient, recommend M37 request/import. Never fall back to `execFile + cwd`.

---

## 7. Work Units

## WU38-01 — Sandbox Threat Model, Platform Decision, and Backend Contract

**Risk:** 40/100  
Define platform, threat model, minimum capabilities, backend interface, unsupported-host behavior, and pure policy decisions. No process launch.

**Tag:** `m38-wu01-sandbox-contract`

## WU38-02 — Filesystem, Environment, Network, and Resource Isolation

**Risk:** 75/100  
Implement one real backend with enforceable mounts, environment allowlist, network denial, resource controls, isolated temp/output, and cleanup.

Before WU38-02 begins, verify that the pre-existing high-severity Dependabot alert reported at M37 closure has been triaged. The alert may be remediated or explicitly accepted with documented rationale, but it must not remain unexamined when sandbox dependencies are introduced.

**Tag:** `m38-wu02-sandbox-isolation-backend`

## WU38-03 — Live Agent Process, Command Mediation, and Cancellation

**Risk:** 80/100  
Run one agent inside the sandbox with structured events, policy-mediated commands, full process-tree ownership, deterministic cancellation, and output/budget limits.

**Tag:** `m38-wu03-live-agent-process-control`

## WU38-04 — Validation, Forensics, Recovery, and CLI Integration

**Risk:** 65/100  
Integrate opt-in live execution with M37 CLI, capability preflight, validation, self-review, evidence, crash recovery, cleanup, and safe fallback.

**Tag:** `m38-wu04-live-execution-cli-and-forensics`

## WU38-05 — Escape Testing, Controlled Pilot, and Closure

**Risk:** 75/100  
Run adversarial escape tests and a controlled live pilot.

Required scenarios include parent-repo write, host-home read, sibling-worktree access, secret access, network access, process-limit escape, orphan process, nested cancellation, CPU/memory/disk exhaustion, crash recovery, successful repair, and fallback on unsupported hosts.

**Tags:**

```text
m38-wu05-sandboxed-live-agent-pilot
m38-sandboxed-live-agent-execution
```

---

## 8. Cross-Work-Unit Invariants

1. No `cwd`-only sandbox claims.
2. No live execution without capability confirmation.
3. No silent unsandboxed fallback.
4. Network denied by default.
5. Environment projection explicit.
6. Worktree is the only writable repository mount.
7. Complete process-tree ownership mandatory.
8. Budgets mandatory.
9. Command policy authoritative.
10. Evidence and cleanup mandatory.
11. No automatic merge, push, or deployment.
12. No AIQT self-management.
13. Request/import remains available.
14. One commit/tag per Work Unit.
15. Every commit includes a 0–100 risk score.

---

## 9. Verification Gate

M38 closes only when:

- M37 is formally closed;
- platform/backend decision is explicit;
- real OS isolation exists;
- filesystem, environment, network, process, and resource boundaries are enforced;
- deterministic cancellation is proven;
- escape tests pass;
- unsupported hosts fail closed;
- request/import fallback works;
- live mode is opt-in;
- forensic evidence is complete;
- controlled pilot passes;
- CI is green;
- all commits/tags exist;
- final tree is clean.

---

## 10. Closure Report

Include entry-gate evidence, platform decision, threat model, capabilities, filesystem/network/environment policies, process control, limits, escape-test evidence, pilot scenarios, unsupported-host behavior, fallback, residual risks, and confirmation that automatic merge remains disabled.
