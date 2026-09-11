import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * M35-WU01 (build spec Sec 7, WU35-01): pure, read-only static
 * classification of every test file under tests/ -- workload class,
 * feature domain, criticality, subprocess/filesystem/Git/built-binary
 * usage, and inline timeout-override presence. Never runs the suite,
 * never writes anything, never modifies a test file. Kept separate from
 * test-inventory-cli.ts (which owns argv parsing and file output) so this
 * module can be imported by tests/unit/m35-test-inventory-classification.test.ts
 * with no import-time side effect.
 */

export function walkTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkTestFiles(full, out);
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function relPath(repoRoot: string, full: string): string {
  return relative(repoRoot, full).split("\\").join("/");
}

function hasGitSpawn(text: string): boolean {
  // M36-WU02: initGitFixtureRepo (tests/helpers.ts, M35-WU03) wraps a
  // real `git init`/config/commit sequence -- a file that calls only
  // this shared helper, with no direct execFileSync("git", ...) literal
  // of its own, still spawns git transitively and must classify as
  // such, not silently fall through as non-spawning.
  return /(?:execFileSync|spawnSync|execFile|spawn)\(\s*["']git["']/.test(text) || /\binitGitFixtureRepo\(/.test(text);
}
function hasCliSpawn(text: string): boolean {
  // M36-WU03: runAutonomousCommand/executeAutonomousRun (src/workspaces/
  // autonomous-command-runner.ts, src/services/autonomous-run-execution-
  // service.ts) wrap real execFileSync calls -- a test file calling only
  // these, with no direct spawnSync/tsxCli/dist reference of its own,
  // still spawns a real process transitively.
  return (
    /spawnSync\(\s*process\.execPath/.test(text) ||
    /tsxCli/.test(text) ||
    /dist[\\/]index\.js/.test(text) ||
    /\bBUILT_CLI_ENTRY\b/.test(text) ||
    /\brunAutonomousCommand\(/.test(text) ||
    /\bexecuteAutonomousRun\(/.test(text)
  );
}
function hasBuiltBinary(text: string): boolean {
  // IH-04: the real-CLI integration spine now spawns the built artifact via
  // tests/cli-runner.ts's BUILT_CLI_ENTRY rather than each file writing the
  // `dist/index.js` path literal itself. Both spellings mean the same
  // thing -- this file spawns the shipped binary -- so both classify as
  // built-binary usage, exactly as the earlier `tsxCli`/`initGitFixtureRepo`
  // shared-helper indirections were folded into the detectors above.
  return /dist[\\/]index\.js/.test(text) || /\bBUILT_CLI_ENTRY\b/.test(text);
}
function usesTempDir(text: string): boolean {
  return /makeTempDir|copyFixture|contextFor/.test(text);
}
function countTestsStatic(text: string): number {
  return (text.match(/\bit\(\s*["'`]/g) ?? []).length;
}
function hasSkippedOrConditional(text: string): boolean {
  return /\bit\.skip\(|\bdescribe\.skip\(|\bit\.todo\(|\bit\.skipIf\(|\bdescribe\.skipIf\(/.test(text);
}
function hasVitestSetConfig(text: string): boolean {
  return /vi\.setConfig\(\s*\{\s*testTimeout:/.test(text);
}
function hasInlineTimeout(text: string): boolean {
  return /\}, \d{4,7}\);/.test(text) || /\n\s*\d{4,7},\n\s*\);/.test(text);
}
function hasPlatformGuard(text: string): boolean {
  return /process\.platform\s*===|process\.platform\s*!==|\bskipIf\(process\.platform/.test(text);
}

/**
 * Feature-domain classification by filename pattern, ordered
 * most-specific-first. The build spec's explicit "critical coverage"
 * list (canonical state, schema compatibility, persistence/runlog
 * recovery, workflow assessment, corruption repair, CLI machine contract,
 * exit-code invariants, built-binary behavior, security/command
 * boundaries, Git/worktree safety, evidence binding, execution lifecycle)
 * maps directly onto these domains.
 */
const DOMAIN_RULES: { pattern: RegExp; domain: string; criticality: string }[] = [
  { pattern: /built-binary-smoke/, domain: "built-binary", criticality: "Critical" },
  { pattern: /^m33-(exit10-and-owner-inventory|cli-contract-matrix|result-contract-characterization)/, domain: "cli-machine-contract", criticality: "Critical" },
  { pattern: /^cli\.test\.ts$/, domain: "cli-machine-contract", criticality: "Critical" },
  { pattern: /version-check/, domain: "cli-machine-contract", criticality: "High-value" },
  { pattern: /boundary-scan/, domain: "security-boundary", criticality: "Critical" },
  { pattern: /repository-boundary-discipline|source-control-discipline|.*-repository-boundary|.*-source-control/, domain: "security-boundary", criticality: "Critical" },
  { pattern: /^schema\.test\.ts$|canonical-unknown-field-preservation|canonical-version-compatibility|atomic-write/, domain: "canonical-state", criticality: "Critical" },
  { pattern: /-schema\.test\.ts$|schema-compatibility/, domain: "schema-compatibility", criticality: "Critical" },
  { pattern: /historical-compatibility|root-backward-compatibility|replanned-invariants|^m22-compatibility/, domain: "schema-compatibility", criticality: "Critical" },
  { pattern: /^runlog\.test\.ts$|runlog-recovery|workspace-recovery/, domain: "persistence-runlog", criticality: "Critical" },
  { pattern: /project-mutation-guard/, domain: "persistence-runlog", criticality: "Critical" },
  { pattern: /workflow-assessment|workflow-recommendation|effective-readiness|dependency-readiness|dependency-graph|dependency-relation|work-graph-readiness/, domain: "workflow-assessment", criticality: "Critical" },
  { pattern: /graph-repair|repair-work-graph|repair-plan\.command|graph-validat/, domain: "corruption-repair", criticality: "Critical" },
  { pattern: /^git-command-runner|git-worktree|shared-repository-provider/, domain: "git-worktree-safety", criticality: "Critical" },
  { pattern: /^workspace-/, domain: "git-worktree-safety", criticality: "High-value" },
  { pattern: /^evidence-gate-|^evidence-import|^evidence-advisory|^evidence-schema|evidence-mutation-service|external-evidence|required-evidence|checkpoint-evidence|checkpoint-required-evidence|checkpoint-advisory|^stdin\.test/, domain: "evidence-binding", criticality: "High-value" },
  { pattern: /^execution-/, domain: "execution-lifecycle", criticality: "High-value" },
  { pattern: /claude-code/, domain: "execution-lifecycle", criticality: "High-value" },
  { pattern: /generic-execution|generic-ci-adapter|generic-evidence-adapter|manual-evidence-adapter/, domain: "execution-lifecycle", criticality: "Normal" },
  { pattern: /checkpoint/, domain: "checkpoint-lifecycle", criticality: "High-value" },
  { pattern: /^next|packet|agent-packet|parallel-batch|parallel-eligibility|resource-claim|^agent-handoff|^agent-operating|work-unit-cancel-transition|start-continue/, domain: "work-packet-lifecycle", criticality: "Normal" },
  { pattern: /^plan|dependency-update|^import/, domain: "plan-lifecycle", criticality: "Normal" },
  { pattern: /^issue-|finding-|^review|warning-rules|guidance-rules|project-issue-foundation/, domain: "review-and-issues", criticality: "Normal" },
  {
    pattern: /^prompt-|prompt\.command|component-system|design-system|skills-plan|skills-detection|select-relevant-skills|ui-heavy-detection|full-stack-detection/,
    domain: "prompt-generation",
    // M35-WU02: reclassified from Low-signal to Normal after direct
    // investigation (docs/engineering/m35-test-suite-inventory.md Sec 5.3
    // addendum) -- every sampled file across this domain (integration and
    // unit, small and large) tested a real, distinct positive/negative
    // behavioral branch or documented edge case, not generated-text
    // wording or a private implementation detail. One file
    // (prompt-out-path.test.ts) tests real path-traversal/prefix-confusion
    // security validation and is arguably under-classified even at
    // Normal, but this Work Unit did not individually re-classify single
    // files within the domain -- see the inventory doc for the full
    // reasoning and the files actually sampled.
    criticality: "Normal",
  },
  { pattern: /^status|^manage|^export/, domain: "read-only-views", criticality: "Normal" },
  { pattern: /^init|update|root-resolution|implementation-root/, domain: "project-bootstrap", criticality: "High-value" },
  { pattern: /package-version|semver|push-base|relevant-paths|versioning|^ids\.test/, domain: "release-tooling", criticality: "High-value" },
  // IH-05: validation-profile.test.ts joins the two inventory guards in
  // this domain -- all three are guards over the repository's own
  // validation machinery rather than over AIQT product behavior. Critical:
  // it is what keeps the CI docs-only profile's "no test reads docs/"
  // precondition from decaying silently.
  { pattern: /^m34-validation-workload-inventory|^m35-test-inventory-classification|^validation-profile/, domain: "validation-infrastructure", criticality: "Critical" },
  { pattern: /^autonomous-/, domain: "autonomous-run-safety", criticality: "Critical" },
  { pattern: /^sandbox-/, domain: "sandbox-execution-safety", criticality: "Critical" },
  // M40-WU05: release candidate/provenance/risk/readiness/CLI/draft --
  // boundary-scan files already match the earlier /boundary-scan/ rule
  // above and the dogfood suite already matches /dogfood/ below; this
  // covers the remaining release-*.test.ts unit/integration coverage.
  { pattern: /^release-/, domain: "release-governance", criticality: "Critical" },
  // M44: historical release reconstruction -- extends the release-governance
  // domain (evidence collection, reconstruction engine, and existing-release
  // verification all map a historical target into the same M40 candidate/
  // readiness/risk flow release-*.test.ts already exercises).
  { pattern: /^historical-/, domain: "release-governance", criticality: "Critical" },
  // M41: test-impact inventory/selection/escalation and its read-only
  // validation select/explain CLI surface.
  { pattern: /test-impact|-impact\.test\.ts$|^validation-select-explain/, domain: "test-impact-selection", criticality: "Critical" },
  // M42: defect discovery/triage/queue/remediation lifecycle -- schema and
  // dogfood coverage already match the earlier -schema.test.ts$/dogfood
  // rules above; this covers the remaining defect-*.test.ts unit/
  // integration coverage.
  { pattern: /^defects?-/, domain: "defect-lifecycle", criticality: "High-value" },
  // M45: background maintenance scheduling -- typed dispatch into the
  // existing defect-lifecycle/structural-review domains above, but the
  // schedule/due-engine/occurrence contract itself is its own domain.
  { pattern: /^maintenance-/, domain: "maintenance-scheduling", criticality: "Critical" },
  // M43: bounded structural review and its M42 defect-intake integration.
  { pattern: /^structural-|^m43-|^review-structural/, domain: "structural-review", criticality: "High-value" },
  // M46: multi-repository portfolio registry/snapshot/governance -- reads
  // existing member evidence (defects, maintenance schedules, canonical
  // state) without owning any of those domains itself.
  { pattern: /^portfolio-/, domain: "portfolio-governance", criticality: "High-value" },
  // M47: controlled Pull Request integration -- the repository's only
  // remote-write authority (one exact-SHA, non-force branch push and one
  // Pull Request creation). Critical for the same reason
  // autonomous-run-safety is: these files are what prove an irreversible
  // external mutation stays inside its boundary. Placed BEFORE the
  // /dogfood/ rule so pr-live-dogfood.test.ts classifies with the rest of
  // the domain it actually guards rather than as generic self-consistency.
  { pattern: /^pr-|^git-command-runner-pr-/, domain: "pull-request-integration", criticality: "Critical" },
  // M48: bounded overnight project review and GitHub Issue generation --
  // the repository's second remote-write authority (Issue creation only,
  // no PR/merge/deploy). Critical for the same reason
  // pull-request-integration is: these files prove the external-mutation
  // idempotency/dedup boundary (lookup-before-create, backlog suppression)
  // holds.
  { pattern: /^night-audit-/, domain: "night-audit-review", criticality: "Critical" },
  { pattern: /dogfood/, domain: "self-consistency", criticality: "Normal" },
];

function classifyDomain(basename: string): { domain: string; criticality: string } {
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(basename)) return { domain: rule.domain, criticality: rule.criticality };
  }
  return { domain: "uncategorized", criticality: "Normal" };
}

export interface ClassifiedTestFile {
  path: string;
  layer: "unit" | "integration";
  workloadClass: string;
  domain: string;
  criticality: string;
  testCountStatic: number;
  testCountActual: number | null;
  durationMs: number | null;
  runStatus: string | null;
  subprocessUsage: { git: boolean; cli: boolean; builtBinary: boolean };
  filesystemUsage: boolean;
  hasSkippedOrConditional: boolean;
  hasPlatformGuard: boolean;
  timeoutOverride: { vitestSetConfig: boolean; inlinePerTest: boolean };
  lineCount: number;
}

export interface RunJsonEntry {
  name: string;
  status: string;
  startTime: number;
  endTime: number;
  assertionResults: unknown[];
}
export interface RunJson {
  testResults: RunJsonEntry[];
}

export function loadRunJson(path: string | undefined): Map<string, RunJsonEntry> {
  const map = new Map<string, RunJsonEntry>();
  if (!path) return map;
  const data = JSON.parse(readFileSync(path, "utf8")) as RunJson;
  for (const r of data.testResults) {
    const rn = r.name.split("\\").join("/");
    map.set(rn, r);
  }
  return map;
}

export function classifyAllTestFiles(repoRoot: string, testsDir: string, runJson?: Map<string, RunJsonEntry>): ClassifiedTestFile[] {
  const allFiles = walkTestFiles(testsDir);
  const rj = runJson ?? new Map<string, RunJsonEntry>();

  return allFiles.map((f) => {
    const rp = relPath(repoRoot, f);
    const text = readFileSync(f, "utf8");
    const basename = rp.split("/").pop()!;
    const { domain, criticality } = classifyDomain(basename);
    const runEntry = [...rj.entries()].find(([name]) => name.endsWith(rp))?.[1];
    const gitSpawn = hasGitSpawn(text);
    const cliSpawn = hasCliSpawn(text);
    const builtBinary = hasBuiltBinary(text);
    // IH-04: keyed on the domain, not on `builtBinary`. Since the real-CLI
    // spine started spawning dist/index.js via BUILT_CLI_ENTRY, 29 files
    // reference the built binary but only one *is* the built-binary smoke
    // suite. Keying the class off the flag relabelled 28
    // evidence/execution/workspace and CLI-subprocess suites as
    // "built-binary-smoke", breaking continuity with the M34/M35 workload
    // taxonomy. `subprocessUsage.builtBinary` still reports the flag
    // truthfully for all 29.
    const workloadClass = domain === "built-binary"
      ? "built-binary-smoke"
      : gitSpawn && cliSpawn
        ? "evidence-execution-workspace-integration"
        : gitSpawn
          ? "git-worktree-integration"
          : cliSpawn
            ? "cli-subprocess-integration"
            : rp.startsWith("tests/unit/")
              ? "fast-unit"
              : "filesystem-integration";

    return {
      path: rp,
      layer: rp.startsWith("tests/unit/") ? "unit" : "integration",
      workloadClass,
      domain,
      criticality,
      testCountStatic: countTestsStatic(text),
      testCountActual: runEntry ? runEntry.assertionResults.length : null,
      durationMs: runEntry ? Math.round(runEntry.endTime - runEntry.startTime) : null,
      runStatus: runEntry ? runEntry.status : null,
      subprocessUsage: { git: gitSpawn, cli: cliSpawn, builtBinary },
      filesystemUsage: usesTempDir(text),
      hasSkippedOrConditional: hasSkippedOrConditional(text),
      hasPlatformGuard: hasPlatformGuard(text),
      timeoutOverride: {
        vitestSetConfig: hasVitestSetConfig(text),
        inlinePerTest: hasInlineTimeout(text),
      },
      lineCount: text.split("\n").length,
    };
  });
}
