# M37-WU02 Design Note: Bounded Coding-Agent Adapter — Architecture Choice

## The core tension

WU37-02's acceptance criteria include "adapter cannot escape worktree" and "child-process cancellation deterministic." These two requirements pull in different directions depending on which architecture is chosen, and the build spec does not resolve it or name a concrete provider/executable.

## Option A — Live-spawned subprocess

AIQT itself spawns a real coding-agent executable (`execFile`) inside the worktree, with `cwd` set to the worktree path, an `AbortSignal` for cancellation, and captured stdout/stderr.

**The problem:** `cwd` is only a *starting* directory for a child process — it is not a filesystem jail. A spawned process can still write to any absolute path the OS file permissions allow. Node's `child_process` module provides no sandboxing primitive. So "adapter cannot escape worktree" cannot be honestly satisfied by `execFile` + `cwd` alone — it would require real OS-level confinement (a container, a restricted OS user with scoped write permissions, a chroot/jail), which is a substantial new engineering surface this build spec does not scope anywhere, in this milestone or M36.

There is a second-order issue too: once a real coding-agent process is running, it decides its own actions in real time — reading files, writing files, possibly invoking its own shell commands — for the duration of the run. Unless every one of those actions is funneled back through WU36-03's `decideCommand`/`runAutonomousCommand` (which a generic third-party CLI tool has no reason to do), AIQT is delegating real, live autonomy to code it does not control, bounded only at the process level (cwd, timeout, kill). That is a materially different trust boundary than everything built in M36.

## Option B — Request/import pattern (existing M27 precedent)

AIQT builds a bounded request package (prompt, context, budgets, permissions) to a file. The operator runs their own coding-agent CLI manually, in an environment they control and are responsible for confining. AIQT later imports the resulting output file, never having spawned anything itself.

This is exactly what `execution-adapter-claude-code-*.command.ts` already does in this codebase, and it structurally satisfies "cannot escape worktree" for free: AIQT never gives the agent live access to anything, so there is nothing for AIQT's own process boundary to fail at. The tradeoff: it is not what the build spec's "child-process cancellation deterministic" / "structured event streaming" language literally describes, and the human has to leave the loop to run the tool themselves before re-entering it to import results.

## Decision

**Option B**, adapted from the M27 pattern. Reinterpretation of the acceptance criteria that follows from this choice, recorded explicitly rather than left implicit:

- "adapter cannot escape worktree" → satisfied structurally: AIQT never gives the agent live filesystem or process access at all, so there is no escape surface to bound in the first place. The request package only ever contains the worktree path as *context* for the operator's own tool, never a live capability.
- "child-process cancellation deterministic" → reinterpreted as **request-lifecycle cancellation deterministic**: a pending request can be cancelled (fixed status transition, no partial states), which is the entire cancellable surface that exists in this architecture. There is no live child process for AIQT itself to cancel.
- "structured event streaming" → reinterpreted as **structured lifecycle events at request-creation and import time** (pending → imported/expired/cancelled), consistent with how M27's own adapter represents "streaming" as discrete, auditable state transitions rather than a live event feed.
- "safe stdout/stderr capture" → reinterpreted as **safe, bounded capture of the imported response's own content** (a `commandsProposed` list and optional `notes`, size-bounded, never raw/unbounded provider transcript persisted — mirroring M27's "identity + digest metadata only" principle).
- "wall-clock and command budgets" → the request package carries the run's real `AutonomousBudgets`; a request past `AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS` can never be imported, only expired.
- "failure classification" → import failures (malformed response, requestId/digest mismatch, expired request, oversized command list) are classified and mapped to the M33 result contract by the import service.
- Importing a response is a pure parse + validate + record operation — it never executes a proposed command. Execution (if any) happens later, through WU36-03's already-reviewed, policy-enforced `runAutonomousCommand`, wired in a future orchestration Work Unit — never directly from an imported response.

This keeps every invariant this milestone has maintained so far (fail-closed, no real autonomy delegated to code AIQT does not control, human always in the loop) without inventing new sandboxing infrastructure that is not specified anywhere.
