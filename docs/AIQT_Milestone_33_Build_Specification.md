# AIQT Milestone 33 Build Specification

## Unified CLI Result, Error, and Rendering Contract

**Product:** AIQT CLI  
**Milestone:** M33  
**Status:** Ready for implementation review  
**Risk classification:** High-risk  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 5  
**Primary objective:** Establish one enforceable command-result, exit-code, stream, and rendering contract across the AIQT CLI so humans and coding agents receive consistent, parseable, and actionable outcomes from every command.

---

## 1. Source Alignment

M33 follows the formal closure of M32.

### M32 closure baseline

- Branch: `main`
- Ending commit: `84f872ce70544533acc3d92df8ec7d75b64bb800`
- Ending tag: `m32-wu05-workflow-parity-regression-suite`
- Package version: `0.18.0`
- Canonical schema version: `0.5.0`
- Working tree at closure: clean
- Product `.aiqt/` state in the AIQT repository: absent

M32 established:

- `assessWorkflow()` as the authoritative workflow-assessment owner;
- centralized recommendation precedence;
- centralized project-status derivation;
- shared mutation-side recommendation updates;
- actionable `needs_review` recovery;
- exact planning-readiness guidance;
- dangling-pointer repair;
- workflow parity and architecture guards.

M33 addresses the next corrective cluster:

- fragmented `CommandResult` construction;
- inconsistent exit-code/body semantics;
- parser-level errors that bypass JSON mode;
- raw-text command renderers that omit warnings or recommendations;
- hidden review findings in human mode;
- inconsistent stdout/stderr behavior;
- inconsistent uninitialized-project and missing-input results;
- undocumented machine-facing CLI contract.

The governing M33 flow is:

```text
command execution or parser failure
        ↓
canonical result factory
        ↓
canonical CommandResult
        ↓
JSON renderer or human renderer
        ↓
documented stream and exit-code policy
```

This is development of AIQT itself. Do not use AIQT commands or create `.aiqt/` self-management state inside the AIQT repository.

---

## 2. Milestone Objective

M33 creates one authoritative result and rendering contract for the full CLI surface.

The milestone must establish that:

1. Every command returns or is adapted into the same substantive `CommandResult` model.
2. Exit codes and body fields cannot contradict each other.
3. `--json` produces valid JSON for all command outcomes, including parser-level errors.
4. JSON output uses a documented and predictable stream policy.
5. Human and JSON modes expose the same substantive findings, blockers, warnings, workflow pointers, and next action.
6. Specialized human renderers may preserve domain-specific presentation without bypassing shared status and issue channels.
7. Missing project, missing input, invalid arguments, blocked workflow, review failure, and human-input-required states are represented consistently.
8. Result construction has one authoritative factory or builder contract.
9. The machine-facing CLI contract is documented and protected by cross-command tests.

M33 does not fix the systemic Vitest timeout baseline.

---

## 3. Accepted Findings in Scope

### High priority

- **HIGH-006:** `aiqt review` human output reports findings exist but renders none.
- **HIGH-007:** `--json` is lost on parser-level errors; non-zero JSON stream behavior is inconsistent and undocumented.
- **HIGH-008:** Raw-text command paths omit warnings, blocking issues, and next-command guidance.
- **HIGH-009:** Exit code `10` is emitted with contradictory body values such as `status = failed` and `requiresHumanInput = false`.

### Supporting findings

- **MED-003:** Equivalent missing-input or missing-mode failures use inconsistent exit codes.
- **MED-004:** Some later command families return null workflow pointers in error results even when a valid project is loaded.
- **MED-005:** `status --parallel` behaves differently in text and JSON modes.
- **MED-008:** `--example --json` combinations behave inconsistently across sibling commands.
- **MED-009:** Findings are split across `data.findings`, `blockingIssues`, `warnings`, and command-specific fields.
- **MED-011:** Uninitialized-project results differ across sibling commands.
- **LOW-007:** No documented machine-facing CLI contract exists.
- **LOW-008:** Result payload verbosity and token efficiency should be assessed after correctness is unified.
- **LOW-011:** Typed errors and hand-built per-command `failure()` helpers form incompatible conventions.

---

## 4. Out of Scope

M33 must not implement:

- Workflow recommendation redesign completed by M32.
- Canonical schema compatibility or persistence changes completed by M31.
- Autonomous execution, background scheduling, model invocation, or code modification.
- Full test-timeout infrastructure correction.
- Broad CLI command-surface redesign.
- New canonical files.
- Hosted services or network dependencies.
- Payload compaction before correctness is established.
- Major help-text rewrite unrelated to result contracts.
- AIQT self-dogfood for the AIQT repository.

---

## 5. Governing Decisions

### 5.1 Canonical `CommandResult`

All command outcomes must be representable through one canonical result shape.

The exact type may evolve from the current repository contract, but it must preserve at least:

```ts
interface CommandResult<TData = unknown> {
  status:
    | "passed"
    | "failed"
    | "blocked"
    | "warning"
    | "needs_input";

  action: WorkflowAction | string;

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

  data?: TData;
  exitCode: number;
}
```

No command family may define a separate semantic result contract.

### 5.2 Exit code `10` invariant

```text
exitCode = 10
⇔
status = needs_input
and
requiresHumanInput = true
```

Equivalent semantic outcomes must use equivalent exit codes and body fields.

### 5.3 Exit-code table

| Exit code | Meaning |
| --- | --- |
| `0` | Successful command or non-blocking report |
| `1` | Validation, review, or quality failure |
| `2` | Workflow blocked by current state |
| `3` | Invalid command, argument, input, or canonical state |
| `4` | Required local dependency missing |
| `5` | External integration failure |
| `10` | Human input required |

### 5.4 JSON guarantee

When `--json` is requested, every outcome must produce valid JSON, including:

- unknown command;
- unknown option;
- missing required argument;
- invalid option combination;
- invalid file path;
- malformed JSON;
- invalid canonical state;
- blocked workflow;
- validation failure;
- review failure;
- human input required;
- missing project.

Parser-level errors must be adapted into the canonical result pipeline.

### 5.5 Stream policy

Preferred policy:

```text
All --json payloads are written to stdout.
Process exit code carries success/failure semantics.
Human-readable diagnostics may use stderr only when JSON mode is not active.
```

If implementation constraints require another policy, it must be deterministic, documented, and tested.

### 5.6 Human/JSON substantive parity

Human and JSON output may differ in formatting, but must expose the same substantive:

- summary;
- findings;
- blocking issues;
- warnings;
- workflow pointers;
- human-input requirement;
- next recommended command;
- mutation outcome;
- relevant domain-specific data.

A human renderer must not hide a finding that exists in JSON.

### 5.7 Issue-channel normalization

Preferred rule:

- blocking conditions belong in `blockingIssues`;
- non-blocking concerns belong in `warnings`;
- domain-specific structured findings may remain in `data`, but shared rendering must surface them;
- command-specific arrays must be adapted into canonical issue channels or shared finding renderers.

No command may rely on undocumented `data.*` fields as the only way to discover an actionable finding.

### 5.8 Specialized renderer policy

Commands with packet, report, skills, issue-list, parallel-status, or repair-plan output may preserve specialized bodies.

They must still expose:

- status;
- warnings;
- blocking issues;
- human-input requirement;
- next recommended command.

### 5.9 Result factory and error adaptation

M33 must establish one authoritative result factory or builder layer supporting:

- passed;
- warning;
- blocked;
- failed;
- needs-input;
- parser error;
- missing project;
- invalid canonical state;
- command-specific data.

Typed errors and local `failure()` helpers must converge on this model.

### 5.10 Missing-project contract

Commands requiring an AIQT project must return a consistent missing-project result:

- same semantic issue category;
- same exit code;
- null workflow pointers;
- actionable recommendation, normally `aiqt init`;
- equivalent human and JSON substance.

Commands that legitimately work without initialization must be explicit exceptions.

### 5.11 Example-mode policy

`--example --json` behavior must be consistent across sibling commands.

Choose one policy:

- allow structured JSON example output; or
- reject the combination with exit code `3`.

Apply the selected policy consistently.

---

## 6. Work Units

## WU33-01 — Command Result and Stream Contract Inventory

**Risk:** 30/100  
**Objective:** Inventory result construction, exit semantics, rendering paths, parser behavior, and stream routing; define the authoritative M33 contract before broad migration.

### Scope

- Inventory result factories, local `failure()` helpers, typed errors, renderers, and raw-output bypasses.
- Map command families to result builder, exit behavior, stream, renderer, issue channels, and missing-project behavior.
- Reproduce audit contradictions with characterization tests.
- Define the canonical result, exit-code, stream, issue-channel, and specialized-renderer contracts.
- Add architecture ownership documentation.
- Do not migrate every command yet.

### Acceptance criteria

- One complete owner inventory exists.
- Every known result-construction path is identified.
- Parser-level JSON bypass is reproduced.
- Exit-code `10` contradictions are reproduced.
- Review human-output omission is reproduced.
- Raw-text bypasses are identified.
- Canonical contract and stream policy are documented.
- No schema-version change.
- No runtime dependency added.

### Required validation

- Characterization tests for parser errors, exit `10`, human review findings, specialized output warnings, missing project, workflow pointers, `status --parallel`, and `--example --json`.
- Typecheck, lint, build, version check, diff check.
- Official full test command with timeout baseline disclosed.

### Commit and tag

- Tag: `m33-wu01-result-contract-inventory`

---

## WU33-02 — Central Result Factory and Exit-Code Semantics

**Risk:** 50/100  
**Objective:** Introduce the shared result factory and normalize body semantics across command families.

### Scope

- Implement builders for passed, warning, blocked, failed, and needs-input.
- Adapt typed errors and local failure helpers.
- Normalize exit `10`, missing input, missing project, invalid state, and workflow pointer population.
- Migrate representative core, evidence, execution, and workspace families.

### Acceptance criteria

- Exit-code/body invariants are enforced centrally.
- Exit `10` always yields `needs_input` and `requiresHumanInput = true`.
- Equivalent missing-input cases are equivalent.
- Valid project pointers are retained where available.
- Missing-project results are consistent.
- Architecture tests prevent new local result factories.

### Commit and tag

- Tag: `m33-wu02-central-result-factory`

---

## WU33-03 — Parser-Level JSON and Stream Normalization

**Risk:** 55/100  
**Objective:** Ensure `--json` remains valid and predictable through parser-level and command-level failures.

### Scope

- Intercept parser errors.
- Convert parse failures into canonical results.
- Apply the documented JSON stream policy.
- Normalize invalid option combinations.
- Standardize `--example --json`.
- Preserve human parser ergonomics.

### Acceptance criteria

- Unknown command with `--json` emits valid JSON.
- Unknown option with `--json` emits valid JSON.
- Missing required argument with `--json` emits valid JSON.
- All JSON payloads use the documented stream.
- Exit codes remain correct.
- No duplicate parser text contaminates JSON.
- Example-mode behavior is consistent.

### Commit and tag

- Tag: `m33-wu03-json-parser-and-stream-contract`

---

## WU33-04 — Unified Human Rendering and Specialized Output Adapters

**Risk:** 50/100  
**Objective:** Ensure human output exposes the same substantive state as JSON while preserving useful specialized formatting.

### Scope

- Render review findings in human mode.
- Render graph-validation findings.
- Add shared warnings/blockers/recommendation footer to raw-text commands.
- Normalize `status --parallel`.
- Add adapters for packet, prompt, manage, skills, issue-list, repair-plan, and similar specialized paths.

### Acceptance criteria

- Human review output lists active findings and stable keys where actionable.
- Human graph-validation output lists blocking errors and warnings.
- Specialized renderers expose status, warnings, blockers, and next action.
- Human and JSON modes agree substantively.
- `status --parallel` semantics align.
- Actionable findings are not hidden in `data` only.

### Commit and tag

- Tag: `m33-wu04-unified-human-rendering`

---

## WU33-05 — Suite-Wide Result Contract and Architecture Enforcement

**Risk:** 35/100  
**Objective:** Lock the unified contract across the public command surface and remove obsolete result-construction paths.

### Scope

- Add cross-command contract matrix.
- Add stream-routing tests.
- Add parser-error JSON tests.
- Add human/JSON parity tests.
- Remove or deprecate obsolete local failure helpers.
- Add architecture guards.
- Document the machine-facing CLI contract.
- Assess payload verbosity without weakening correctness.

### Acceptance criteria

- Cross-command matrix covers all registered command families.
- Exit/body invariants are suite-enforced.
- `--json` parseability is tested for success and error classes.
- Stream policy is suite-enforced.
- Human/JSON parity is tested for representative specialized commands.
- Machine-facing contract is documented.
- No undocumented local result owner remains.
- Findings are closed or explicitly reduced.

### Commit and tag

- Tag: `m33-wu05-result-contract-regression-suite`

---

## 7. Cross-Work-Unit Invariants

Every Work Unit must preserve:

1. No AIQT self-management state in the AIQT repository.
2. Default branch remains `main`.
3. One detailed commit and tag per Work Unit.
4. Commit body includes scope, validation, residual risks, and a `0–100` risk score.
5. No unrelated cleanup.
6. No hidden baseline failures.
7. No schema-version bump unless unavoidable and approved.
8. No runtime dependency unless justified.
9. No change to M32 workflow precedence except to preserve result fidelity.
10. Final report includes files, tests, commands, commit SHA, tag, and clean working-tree evidence.

---

## 8. Milestone Verification Gate

M33 is complete only when:

- one authoritative result factory exists;
- exit/body invariants are centralized;
- typed and local errors converge;
- parser and command failures produce valid JSON under `--json`;
- JSON stream policy is documented and consistent;
- no parser text contaminates JSON;
- human and JSON modes expose the same substantive findings;
- review findings are visible in human mode;
- specialized outputs include warnings, blockers, and next action;
- missing input and missing project are consistent;
- workflow pointers are retained where available;
- example-mode policy is consistent;
- focused suites, typecheck, lint, build, version check, and diff check pass;
- the full-suite result is reported honestly;
- all five Work Unit commits and tags exist;
- final working tree is clean.

---

## 9. Milestone Closure Report Requirements

The closure report must include:

- starting and ending commits;
- package and schema versions;
- Work Unit commit/tag table;
- canonical `CommandResult` decision;
- exit-code table;
- JSON stream policy;
- parser-error adaptation;
- human/JSON parity behavior;
- specialized renderer policy;
- missing-project and missing-input behavior;
- example-mode policy;
- migrated command families;
- findings closed or reduced;
- validation results;
- remaining result-contract risks;
- recommendation on whether the timeout corrective milestone may begin;
- explicit statement that autonomous execution remains deferred.

---

## 10. Residual Risks After M33

Separate corrective work remains for:

- deterministic full-suite timeout policy;
- packaged-binary validation;
- dependency-audit governance;
- documentation corrections outside the machine contract;
- autonomous maintenance runner isolation, budgets, review, and safety controls.

M33 establishes the machine and human interaction contract required before autonomous execution can be trusted.
