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
  return /(?:execFileSync|spawnSync|execFile|spawn)\(\s*["']git["']/.test(text);
}
function hasCliSpawn(text: string): boolean {
  return /spawnSync\(\s*process\.execPath/.test(text) || /tsxCli/.test(text) || /dist[\\/]index\.js/.test(text);
}
function hasBuiltBinary(text: string): boolean {
  return /dist[\\/]index\.js/.test(text);
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
  { pattern: /^m34-validation-workload-inventory|^m35-test-inventory-classification/, domain: "validation-infrastructure", criticality: "Critical" },
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
    const workloadClass = builtBinary
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
