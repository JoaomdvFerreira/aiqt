# AIQT CLI Machine-Facing Contract

**Last verified against:** `main` at `be126ce` (post-M42, 2026-08-08).

The authoritative, user/agent-facing description of what `aiqt <command>
--json` guarantees. Established by Milestone 33 (Unified CLI Result, Error,
and Rendering Contract); see [`../archive/legacy-milestones/m33-wu01-command-result-contract.md`](../archive/legacy-milestones/m33-wu01-command-result-contract.md)
for the full engineering inventory, characterized defects, and per-Work-Unit
implementation record this contract was built from. This contract applies
uniformly to every command family added since M33 (evidence-gate,
workspace, execution, autonomous, sandbox, release, validation, defects,
and any future family) without per-family restatement here — a new
command family conforming to `CommandResult`/exit codes/stream policy/
human-JSON parity needs no update to this document; only a genuine
contract change does.

## `CommandResult`

Every command outcome — success, failure, a blocked workflow state, a
parser-level error — is representable as this shape. `--json` always prints
exactly this object; human mode renders a formatted view of the same
substance (see "Human/JSON parity" below).

```ts
interface CommandResult<TData = unknown> {
  status: "passed" | "failed" | "blocked" | "warning" | "needs_input";
  action: string;                       // usually a WorkflowAction; "cli" for parser-level errors
  projectStatus: ProjectStatus | null;
  currentMilestoneId: string | null;
  currentWorkUnitId: string | null;
  summary: string;
  completedActions: string[];
  changedFiles: string[];
  affectedItems: string[];
  blockingIssues: Issue[];
  warnings: Issue[];
  requiresHumanInput: boolean;
  nextRecommendedCommand: string | null;
  data?: TData;                         // command-specific detail; see "Issue-channel policy"
  exitCode: number;
}

interface Issue {
  id: string;             // stable, often actionable elsewhere (e.g. `aiqt review acknowledge <id>`)
  severity: "low" | "medium" | "high" | "critical";
  area: string;
  message: string;
  affectedItems?: string[];
  suggestedAction?: string;
  agentCanFix?: boolean;
}
```

Owner: `src/core/output/result.ts` (`makeResult`, `familyFailureResult`,
`missingProjectResult`, `parserErrorToResult`, `errorToResult`).

## Exit-code table

| Exit code | Meaning |
| --- | --- |
| `0` | Successful command or non-blocking report (`status` is `passed` or `warning`) |
| `1` | Validation, review, or quality failure |
| `2` | Workflow blocked by current state |
| `3` | Invalid command, argument, input, or canonical state |
| `4` | Required local dependency missing |
| `5` | External integration failure |
| `10` | Human input required |

Owner: `src/core/output/exit-codes.ts` (`ExitCode`).

### The exit-10 invariant

```text
exitCode === 10  ⇔  status === "needs_input"  ∧  requiresHumanInput === true
```

Holds for every command in the current CLI surface. Enforced centrally by
`familyFailureResult()` (not by convention at each of the ~230 call sites
that construct a failure result).

## Stream policy

```text
Every --json payload is written to stdout, regardless of exit code.
The process exit code carries success/failure semantics.
Human-readable diagnostics use stderr only when --json was NOT requested,
following the pre-existing convention (stdout on success, stderr otherwise).
```

A script piping `aiqt <command> --json` can always read the result from
stdout, whether the command succeeded, failed, or was blocked — it never
needs to also inspect stderr to get the JSON body. This includes
parser-level failures (unknown command, unknown option, missing required
argument): with `--json` present anywhere in argv, these also produce valid
`CommandResult` JSON on stdout instead of raw commander error text.

Owner: `emit()` in `src/cli/register-commands.ts`; the parser-error path is
`src/index.ts`'s top-level catch block plus `register-commands.ts`'s root
`.configureOutput()`/`.exitOverride()`.

## Human/JSON substantive parity

Human and JSON output may differ in formatting, but expose the same
underlying facts: status, blocking issues, warnings, workflow pointers,
human-input requirement, and the next recommended command. Commands with a
specialized human-mode body (an agent packet, a copy-paste prompt, the
`manage`/`skills plan`/`issue list`/`repair plan` reports, the
`status --parallel` advisory report) keep that body as the primary content,
but trail it with a shared footer carrying the same status/warnings/
blockers/next-command substance the JSON `CommandResult` carries.

Owner: `renderHuman()` and `renderResultFooter()` in
`src/core/output/human-output.ts`.

## Issue-channel policy

- A blocking condition belongs in `blockingIssues`.
- A non-blocking concern belongs in `warnings`.
- Domain-specific structured findings (e.g. `aiqt review`'s full finding
  objects, with category/relatedIds/severity beyond what an `Issue` carries)
  may additionally live under `data`, but every actionable finding is *also*
  represented as an `Issue` in `blockingIssues`/`warnings` — no command
  relies on an undocumented `data.*` field as the only way to discover an
  actionable finding.
- An `Issue.id` is a stable key: where a companion command accepts one
  (`aiqt review acknowledge <findingKey>`, `aiqt issue update <issueKey>`),
  the `id` shown is that exact string, in both human and JSON output.

## Missing-project policy

A command that requires an initialized project (`.aiqt/`) and doesn't find
one returns a `failed` result, exit code `3`, and `nextRecommendedCommand:
"aiqt init"`. The specific `Issue.id` and `area` are command-family-specific
(e.g. `REVIEW-NO-PROJECT`/`workflow`, `EVIDENCE-GATE-POLICY-SHOW-NO-PROJECT`/
`evidence-gate`) — the M33 contract requires the same semantic *category*
across families, not byte-identical ids. Commands that legitimately work
without initialization (`aiqt init` itself, the `--example` sample-printing
commands) are explicit exceptions.

Owner: `missingProjectResult()` in `src/core/output/result.ts`, and
`familyFailureResult()`'s automatic `NO-PROJECT`/`DIR-MISSING` detection.

## Example-mode policy

Two equivalent shapes exist for printing a sample payload and exiting:
a `--example` flag on the command itself (`plan`, `checkpoint`,
`execution import`), and a dedicated `example` subcommand (`execution
external example`, `execution adapter claude-code example`). Either
combined with `--json` rejects with exit code `3` and a dedicated
`*-EXAMPLE-JSON-CONFLICT` issue id. Used alone (no `--json`), both shapes
print the raw sample payload and exit `0`.

## What this contract does not (yet) guarantee

- **Workflow pointers on failure.** `projectStatus`/`currentMilestoneId`/
  `currentWorkUnitId` are populated on success and on failures that occur
  after a project was loaded and could be threaded through, but several
  failure paths (input-validation-before-load branches, and every local
  `familyFailureResult()` call site that wasn't given the loaded state)
  still report these as `null` even when a real project exists on disk. Do
  not treat a `null` pointer in an error result as proof no project exists —
  check the specific missing-project `Issue.id` instead.
- **Payload compactness.** `--json` always emits the full `CommandResult`
  shape (13 top-level fields, several usually empty) via
  `JSON.stringify(result, null, 2)` — there is no compact/terse output mode.
  Assessed as a real but secondary concern (M33 spec LOW-008): correctness
  and consistency were prioritized first; verbosity reduction is explicitly
  deferred, not forgotten.
