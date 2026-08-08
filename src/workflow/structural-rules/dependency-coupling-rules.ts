import { dirname, join, normalize, extname } from "node:path";
import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { listSourceFiles, readRepoFileText } from "../structural-review-evidence.js";

const IMPORT_PATTERN = /(?:import|export)(?:[^'"]*?)from\s+["'](\.[^"']+)["']/g;

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/** Resolves a relative import specifier to a repo-relative source file, trying .ts and /index.ts. */
function resolveImport(fromFile: string, specifier: string, knownFiles: ReadonlySet<string>): string | null {
  const base = toPosix(normalize(join(dirname(fromFile), specifier)));
  const candidates = [
    `${base}.ts`,
    base.endsWith(".js") ? `${base.slice(0, -3)}.ts` : null,
    `${base}/index.ts`,
  ].filter((c): c is string => c !== null);
  for (const c of candidates) {
    if (knownFiles.has(c)) return c;
  }
  return null;
}

function extractImports(fromFile: string, text: string, knownFiles: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_PATTERN.lastIndex = 0;
  while ((match = IMPORT_PATTERN.exec(text)) !== null) {
    const resolved = resolveImport(fromFile, match[1], knownFiles);
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * Section 4.2: a deterministic, bounded (relative-import-only, no type
 * resolution, no node_modules traversal) directed-cycle detector over
 * `src/**\/*.ts`. A real cycle is `proven` evidence -- this is a
 * structural fact, not a heuristic. Deliberately conservative: only
 * statically resolvable relative imports are followed; a dynamic
 * import() or a bare-specifier import is not evidence either way.
 */
export function runDependencyCycleRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const files = listSourceFiles(repoRoot).filter((f) => extname(f) === ".ts");
  const knownFiles = new Set(files);
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const text = readRepoFileText(repoRoot, file);
    if (text === null) continue;
    graph.set(file, extractImports(file, text, knownFiles));
  }

  const findings: StructuralFinding[] = [];
  const reportedCycles = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (visiting.has(next)) {
        const cycleStart = stack.indexOf(next);
        const cycle = stack.slice(cycleStart).concat(next);
        const key = [...new Set(cycle)].sort().join(">");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          findings.push(
            buildStructuralFinding({
              domain: "dependency_coupling",
              ruleId: "dependency-cycle",
              title: `Dependency cycle detected among ${new Set(cycle).size} module(s)`,
              explanation: `A cycle of relative imports was found: ${cycle.join(" -> ")}.`,
              reviewCommit,
              affectedPaths: [...new Set(cycle)],
              evidence: [{ evidenceId: "CYCLE-PATH", description: "Import chain forming the cycle.", locator: cycle.join(" -> ") }],
              confidence: "proven",
              significance: "medium",
              reasonCodes: ["DEPENDENCY_CYCLE"],
              disposition: "actionable",
              eligibleForIntake: true,
              recommendedNextAction: "Break the cycle by introducing a shared lower-level module or inverting one dependency direction.",
              evidenceSignature: key,
            }),
          );
        }
      } else if (!visited.has(next)) {
        dfs(next);
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const file of files) {
    if (!visited.has(file)) dfs(file);
  }

  return findings;
}
