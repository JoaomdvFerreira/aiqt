# AIQT Milestone 39 Build Specification

## Agent Execution Efficiency and Context Control

**Product:** AIQT CLI  
**Milestone:** M39  
**Type:** Delta Build Specification  
**Status:** Build-ready after internal review  
**Risk classification:** Medium  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 5  
**Primary objective:** Make each AIQT Work Unit cheaper and more predictable to execute by generating deterministic, bounded guidance for context, model/reasoning effort, validation depth, output verbosity, and subagent use—without reducing quality gates or turning AIQT into a provider/billing router.

---

## 1. Source Alignment and Entry Gate

M39 builds on the existing bounded packet engine, checkpoint evidence, test-rationalization policy, autonomous-runner controls, and M38 sandboxed live execution.

The product flow becomes:

```text
state → Work Unit → execution guidance → bounded agent execution
      → checkpoint/evidence → compact continuation → next Work Unit
```

M39 must preserve:

- one bounded Work Unit per packet;
- structured canonical state, not markdown/session-history as source of truth;
- M37 request/import as a lower-risk fallback;
- M38 sandbox/command/network/resource controls for live execution;
- M33-compatible result/output behavior;
- no automatic merge/deployment;
- no test-quality reduction merely to improve speed or token use.

This specification governs AIQT **product behavior for projects using AIQT**. The AIQT repository itself must continue to follow `AGENTS.md`, `CLAUDE.md`, Git, CI, and `docs/governance/`; do not create product `.aiqt/` state to self-manage M39.

### Entry gate

Before product changes, verify from the live repository:

- clean `main`;
- governance/hygiene commits `0a2fa9b` and `d1661a2`, or verified descendants;
- `AGENTS.md`, `CLAUDE.md`, and current `docs/governance/`;
- M38 formally closed under `docs/milestones/completed/m38/`, with tag and request/import fallback intact;
- current HEAD, package/schema versions, Node/pnpm, and latest authoritative CI;
- product `.aiqt/` absent;
- no unfinished implementation of this new M39;
- live owners for packet, preview, checkpoint, autonomous config/budgets, result, validation, and versioning verified against code.

If local `main` is ahead of `origin/main` only by the reviewed hygiene commits, push and require green CI before branching. Stop on unexpected divergence.

Implementation branch:

```text
milestone/m39-agent-execution-efficiency
```

---

## 2. Problem and Required Outcome

AI-assisted development cost is not only provider token count:

```text
repeated/broad context
+ repo re-investigation
+ stronger reasoning than required
+ unnecessary subagents
+ verbose successful logs
+ full suite after every WU
= less useful work per session and slower feedback
```

AIQT already bounds a packet, but it does not coherently answer:

- what the agent should inspect first;
- what can be omitted/deferred;
- the appropriate context budget;
- the appropriate reasoning/agent class;
- a concrete configured model recommendation when available;
- which validation runs now versus at milestone/release closure;
- whether subagents are justified;
- what execution evidence should survive into the next session/WU.

M39 must produce one deterministic **Execution Guidance** decision for the current Work Unit and reuse it across preview, handoff, and supported autonomous execution surfaces.

Primary outcome:

> Reduce repeated/irrelevant execution context and unnecessary validation/model effort without increasing missed regressions, failed Work Units, or unsafe execution.

---

## 3. Scope and Non-Goals

### In scope

- deterministic Work Unit complexity classification;
- provider-neutral reasoning effort and agent-class recommendation;
- operator-configured mapping to concrete labels such as `Claude Code / Sonnet 5 / medium`;
- bounded context manifest and estimated footprint;
- compact continuation capsule from canonical evidence;
- progressive validation tiers;
- compact-success/full-failure output policy;
- default-zero, targeted-only subagent policy;
- optional recommendation-vs-actual execution evidence;
- preview/packet/prompt/autonomous integration where the existing surface has a bounded Work Unit/task;
- controlled non-AIQT dogfood and efficiency measurement.

### Out of scope

- provider billing/quota APIs or account scraping;
- automatic provider/model switching;
- hardcoded current model inventories;
- embeddings/vector DB or LLM calls to select files;
- recursive repository ingestion;
- recursive agent swarms;
- automatic impacted-test discovery or test dependency/coverage analysis (**M41**);
- removing/skipping tests for speed;
- raw chat/session-history persistence;
- new canonical markdown files;
- AIQT self-management of its own repository;
- automatic merge/deployment.

Boundary with M41:

```text
M39 → decides validation depth and classifies explicit validation work
M41 → determines the exact impacted tests automatically
```

---

## 4. Shared Execution Guidance Contract

One internal owner/service must compute the guidance. Packet, preview, prompt, and autonomous modules must not implement independent recommendation logic.

Logical contract (names may follow live repository conventions):

```ts
type WorkComplexity =
  | "mechanical" | "simple" | "standard" | "complex" | "architectural";
type ReasoningEffort = "low" | "medium" | "high";
type AgentClass = "economy" | "balanced" | "strong";
type ContextProfile = "minimal" | "focused" | "expanded";
type ContextPriority = "must_read" | "should_read" | "reference_only";
type ValidationTier =
  | "static" | "focused" | "impacted" | "milestone" | "full" | "unclassified";
type Confidence = "low" | "medium" | "high";

interface ExecutionGuidance {
  version: "execution-guidance@1";
  workUnitId: string;
  complexity: { value: WorkComplexity; confidence: Confidence; reasons: string[] };
  agent: {
    recommendedClass: AgentClass;
    reasoningEffort: ReasoningEffort;
    concreteRecommendation: { agent: string; model: string | null; effort: string | null } | null;
    advisory: true;
    reasons: string[];
  };
  context: {
    profile: ContextProfile;
    targetEstimatedTokens: number | null;
    estimatedTokens: number | null;
    items: ContextItem[];
    warnings: string[];
  };
  continuation: ContinuationCapsule | null;
  validation: {
    requiredNow: ValidationStep[];
    deferred: ValidationStep[];
    fullSuiteRequiredAt: "work_unit" | "milestone_closure" | "release";
    reasons: string[];
  };
  output: { passingCommandDetail: "summary"; failureDetail: "full" };
  subagents: { mode: "none" | "targeted"; maxParallel: number; reason: string };
}
```

Persist only durable configuration/user intent or evidence that cannot be safely recomputed. Do not create a new canonical file for derived guidance.

---

## 5. Agent and Reasoning Recommendation

AIQT recommends execution characteristics; it does not claim one provider is universally best.

Default provider-neutral mapping:

| Work class | Typical shape | Reasoning | Agent class |
|---|---|---|---|
| mechanical | repetitive/localized | low | economy |
| simple | localized, explicit AC | low | economy/balanced |
| standard | normal bounded feature/bug | medium | balanced |
| complex | cross-module/ambiguous/concurrent/integration | high | strong |
| architectural | canonical/security/migration/architecture | high | strong |

Use bounded deterministic signals already available in Work Unit/candidate/repository metadata: scope breadth, suggested-file breadth, dependency count, explicit risk/security/schema/migration/concurrency signals, and autonomous safety classification where relevant.

Recommendation confidence and reasons are mandatory. Low-confidence heuristics must not be presented as certainty.

### Concrete profiles

Concrete provider/model names are configuration, not product constants. Reuse the existing operator/project configuration architecture.

A configured mapping may produce:

```text
balanced + medium → Claude Code / Sonnet 5 / medium
```

Requirements:

- no hardcoded Sonnet/Codex model inventory;
- no provider API/model-list or billing call;
- generic recommendation still works without a configured profile;
- mapping changes do not change underlying complexity classification;
- recommendations are advisory;
- M39 must not silently alter the model already configured for M37/M38 execution.

---

## 6. Context Selection and Continuation

### Context manifest

Use priorities:

```text
must_read → should_read → reference_only
```

Deterministic selection should favor:

1. current WU objective/scope/out-of-scope/AC/constraints;
2. explicit `agentContextRefs`;
3. exact `suggestedFiles`/scoped paths;
4. latest checkpoint summary + changed files from direct prerequisite/blocking WUs;
5. directly relevant unresolved issues/risks;
6. compact project/business/technology constraints when relevant.

Exclude by default: unrelated WUs/milestones, raw runlog/checkpoint history, generated exports, archive, unrelated directories/tests, and large lockfiles unless dependency work requires them.

A directory suggestion is an area reference, not permission to recursively ingest it.

### Budgeting

A provider-neutral deterministic estimate is sufficient; exact provider token counts are not required.

- label token counts as estimates;
- file metadata/size may be used where content is not needed;
- never inspect secret/environment values for sizing;
- never include paths outside approved roots;
- if a soft target is exceeded, remove/demote lower priorities first;
- never remove the current WU contract or mandatory constraints to hit a target;
- if configured hard limits cannot contain all `must_read` context, fail closed/require review rather than silently truncate.

Profiles: `minimal`, `focused`, `expanded`. Numeric targets may be configured per agent profile and must be described as heuristics, not provider limits.

### Continuation capsule

Generate compact continuation from canonical evidence, not chat history:

```text
relevant previous checkpoint summary
files materially changed
validation/acceptance outcome
unresolved issues
direct dependency outcome
carry-forward refs
```

Prefer latest direct dependencies, omit unrelated history, and reuse existing checkpoint fields (`summary`, files changed, validation, AC results, issues) rather than creating a second source of truth. Add an optional checkpoint field only if live-code review proves a required carry-forward reference cannot otherwise be represented.

---

## 7. Progressive Validation Policy

This is a load-bearing M39 requirement.

```text
T0 static     → typecheck/lint/build or equivalent structural checks
T1 focused    → tests directly covering the changed behavior
T2 impacted   → known dependent behavior/tests
T3 milestone  → broader affected-domain regression
T4 full       → authoritative repository validation suite
```

Default lifecycle:

```text
implementation iteration → relevant T0/T1
WU closure               → T0 + T1 (+ T2 when justified)
milestone closure        → T3 + T4
release                   → current release/CI policy
```

**Ordinary WUs must not default to T4/full-suite validation.**

A WU-level T4 exception requires recorded blast-radius justification, e.g. canonical schema/versioning, shared workflow/result contract, persistence/recovery, test/CI infrastructure, dependency/runtime/toolchain, core filesystem/Git/worktree, security/sandbox boundary, broad architecture, or an unknown-cause defect that focused validation cannot bound.

### Existing validation commands

Preserve compatibility with `validationCommands: string[]`.

M39 may add optional structured validation metadata if live schema review justifies it, but:

- existing plans stay valid;
- obvious repository-wide commands may be classified conservatively as `full`;
- unknown scope is `unclassified`, not guessed safe;
- planning/prompt output should encourage explicit focused commands;
- no test is removed/skipped;
- M39 must not implement M41's impacted-test selection engine.

---

## 8. Output, Subagents, and Efficiency Evidence

### Output

Default guidance:

```text
successful command → concise result/count/duration summary
failed command     → detailed diagnostic evidence
```

Do not hide warnings/failures or weaken M33/M38 forensic evidence. Do not preserve large passing logs as canonical context merely because they were emitted.

### Subagents

Default: `none`.

Targeted use may be recommended only for a concrete reason such as independent security/architecture review, genuinely ambiguous ownership, or one useful parallel read-only investigation. Mechanical/simple/standard WUs default to zero. Recursive swarms remain prohibited.

### Evidence

Record/derive where existing contracts permit:

- guidance version and recommendation;
- concrete configured/actual profile when voluntarily available;
- estimated context footprint and item counts;
- repeated recommended-context ratio across sequential WUs;
- recommended/actual validation tiers and whether full suite ran at WU closure;
- validation duration when already available;
- subagents recommended/used when available;
- final WU outcome/review findings.

Missing provider telemetry stays `unknown`; do not call billing APIs or invent actual token spend.

Quality guardrails override efficiency metrics: acceptance criteria, required tests, final milestone validation, security evidence, and critical-regression coverage must remain intact.

---

## 9. Public Integration

Minimize CLI-surface growth.

### `aiqt next --preview`

Include the shared execution guidance for the selected WU. Preview stays read-only and mutation/runlog-free.

### `aiqt next`

Render the same guidance in a concise packet section, e.g.:

```text
Execution Guidance
Complexity: standard
Reasoning: medium
Agent class: balanced
Configured: Claude Code / Sonnet 5 / medium
Context: MUST READ / SHOULD READ / REFERENCE ONLY
Validation now: focused + static
Deferred: full suite → milestone closure
Subagents: none
Output: summarize success; retain detailed failures
```

Do not embed source files or historical logs just to make this section richer.

### Prompt/autonomous integration

Prompt-driver guidance should tell agents to follow the generated plan and expand context only when evidence shows it is insufficient.

Where M37/M38 already expose an equivalent bounded task, reuse the same decision service without weakening sandbox, approval, command, network, or resource policy. Recommendations stay advisory unless a separate explicit operator configuration says otherwise.

---

## 10. Canonical State and Versioning

No new canonical file.

Preferred order:

1. derive/recompute guidance;
2. reuse existing operator/project config for model mappings;
3. persist only durable intent/evidence that requires it.

Any schema change must follow the live compatibility/versioning implementation, preserve unknown fields, remain additive where possible, and keep package/schema versions distinct. Do not assume historical schema-version behavior from old specs.

---

## 11. Work Units

### WU39-01 — Execution Guidance Contract and Decision Owner

**Risk:** 35/100  
Define one shared contract/owner, deterministic complexity/reasoning/agent-class mapping, profile configuration mapping, context/validation/output/subagent subcontracts, and pure tests. No automatic model switching or provider APIs.

**Acceptance:** deterministic output; confidence/reasons visible; concrete recommendation only when configured; `balanced + medium` can map to a configured `Claude Code / Sonnet 5 / medium`; one decision owner; M38 boundaries untouched.

**Tag:** `m39-wu01-execution-guidance-contract`

### WU39-02 — Context Selection and Continuation Capsules

**Risk:** 45/100  
Implement prioritized context manifest, footprint estimate, soft/hard budget behavior, direct-dependency continuation, changed-file/issue carry-forward, and secret/path safety. No recursive repo ingestion or chat-history persistence.

**Acceptance:** current WU contract never dropped; unrelated history omitted; exact paths preferred; must-read overflow not silently truncated; capsule bounded/deterministic; source contents not embedded by default.

**Tag:** `m39-wu02-context-selection-continuation`

### WU39-03 — Agent Profiles, Output Policy, and Subagent Controls

**Risk:** 40/100  
Wire provider-neutral recommendations to configurable concrete profiles; implement compact-success/full-failure guidance and default-zero targeted-only subagent policy; update relevant prompt/human/JSON surfaces.

**Acceptance:** generic mode works without provider config; concrete mapping is configurable; low/simple work does not default to strongest reasoning; standard work can recommend balanced/medium; architectural signals strengthen reasoning; zero subagents is default.

**Tag:** `m39-wu03-agent-profile-efficiency-controls`

### WU39-04 — Progressive Validation Policy and Packet Integration

**Risk:** 50/100  
Implement validation tiers, conservative classification of explicit commands, backward compatibility, preview/packet parity, WU-level T4 reason requirement, and planning/prompt guidance. No adaptive test-impact engine.

**Acceptance:** ordinary localized WU does not recommend full suite; focused/static explicit; impacted when justified; full deferred to milestone closure by default; exceptional full-suite reason visible; unknown command scope not guessed; existing plans remain valid; no tests removed/skipped.

**Tag:** `m39-wu04-progressive-validation-policy`

### WU39-05 — Efficiency Dogfood, Integration, and Closure

**Risk:** 45/100  
Complete shared-guidance integration, capture/derive efficiency evidence, dogfood on non-AIQT targets, run final authoritative validation, close docs, and prepare the milestone PR.

Required dogfood: at least two representative non-AIQT flows and one multi-WU sequence; where practical exercise a Claude Code-style configured profile and another profile such as Codex without billing APIs.

Measure: context footprint/item counts, repeated-context ratio, model/reasoning recommendation, full-suite frequency, validation duration where available, subagent use, WU outcome, and regression/review findings.

Target (not a quality override):

```text
>= 30% reduction in repeated recommended context footprint
on at least one representative multi-WU flow
```

Also demonstrate ordinary WU focused/impacted validation with T4 reserved for milestone closure. If 30% is not met, report honestly; do not manipulate validation/context merely to hit the metric.

Required quality gate: final authoritative validation passes and no critical/high regression is attributable to omitted context/validation.

**Tags:**

```text
m39-wu05-efficiency-dogfood-and-closure
m39-agent-execution-efficiency
```

---

## 12. Cross-WU Invariants

1. No AIQT self-management of this repository.
2. One shared guidance owner; identical input/config gives identical decisions.
3. Provider/model mapping configurable and advisory; no billing API or automatic switching.
4. Current WU objective/scope/out-of-scope/AC/mandatory constraints survive budgeting.
5. No raw chat/session history or broad recursive repository ingestion.
6. Full suite is not the ordinary WU default; final milestone/release confidence remains mandatory.
7. No tests removed/skipped for efficiency.
8. Successful logs compact; failures detailed.
9. Subagents default to none; no recursive swarms.
10. M37/M38 safety/fallback and M33 results remain intact.
11. No automatic merge/deployment.
12. One detailed commit + WU tag per completed WU.

---

## 13. M39 Development Validation

Apply the policy manually while building M39:

### Per WU

- focused new/changed tests;
- directly impacted tests identified from live ownership/evidence;
- cheap repository gates required by governance (`typecheck`, `lint`, `build`, `version:check`, `git diff --check` where applicable);
- **no full repository suite after every WU by default**;
- if full suite runs, record the blast-radius reason;
- do not rerun a passing command without a concrete reason.

### Closure

WU39-05 runs the authoritative full Node 24 validation/CI gate required by current governance, including built-binary/security/architecture coverage where applicable. M39's efficiency goal must not weaken closure confidence.

---

## 14. Source Control, PR, and Release

Follow current `docs/governance/versioning.md` and milestone protocol:

```text
clean green main
→ milestone/m39-agent-execution-efficiency
→ WU commits + WU tags
→ WU39-05 closure + milestone tag
→ milestone closure validation
→ PR to main
→ review/merge
→ post-merge main CI green
→ release tag
→ GitHub Release
```

WU commit body: implemented scope, validation, whether full suite was deferred/run and why, residual risk, 0–100 implementation risk score, no unrelated changes.

The implementation agent may push the milestone branch/tags and create the PR if instructed/authenticated. Do not auto-merge without current governance or explicit operator authorization.

GitHub Release only after merge + green post-merge `main` CI. Required release risk governance:

```text
0–24   green
25–75  orange
76–100 red

risk < 50  → agent approval permitted
risk >= 50 → human review/approval required before publication
```

Release notes include main risks, mitigations, residual risks, and operational recommendation.

---

## 15. Definition of Done

M39 closes when:

- one shared deterministic Execution Guidance owner exists;
- preview and packet reuse the same guidance;
- provider-neutral complexity/reasoning/agent recommendations work;
- configured concrete profiles work without hardcoded model inventory;
- context manifest is prioritized/bounded and excludes unrelated history;
- continuation capsule is compact and canonical-evidence-derived;
- progressive validation is implemented and ordinary WUs do not default to full suite;
- broad/full validation remains required at milestone/release boundaries and documented exceptions;
- compact-success/full-failure and default-zero subagent policies work;
- supported M37/M38 surfaces reuse guidance where appropriate without weakening safety;
- efficiency evidence/dogfood completes without billing APIs;
- final quality guard passes;
- all WU commits/tags exist and branch is clean;
- closure report exists and M39 docs move from `docs/milestones/active/m39/` to `docs/milestones/completed/m39/`;
- milestone PR is prepared under governance;
- M40 Release Governance, Risk Assessment, and Provenance may begin only after M39 is merged/closed.

Closure report:

```text
docs/milestones/completed/m39/closure-report.md
```

Keep it concise: baseline/final commits, WU tags, contract outcomes, dogfood metrics, full validation/CI, defects, residual/release risk, PR/release status, and M40 entry decision. Do not retain routine WU prompts or raw command logs as permanent documentation.
