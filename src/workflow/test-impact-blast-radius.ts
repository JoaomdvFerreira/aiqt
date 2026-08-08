/**
 * M41-WU02 (build spec Sec 7.3): the same "foundational, widely-depended-
 * on behavior" list milestone-protocol.md Sec 4 already uses to justify
 * running the full suite early, expressed as a bounded, deterministic
 * path-pattern check. Reused, not redefined, by the selector -- a hit
 * here always escalates to `full_required`, matching M39's own T4
 * exception policy (build spec Sec 7.3: "M41 must not independently
 * weaken or override M39's T4 exception rules").
 */
export interface BlastRadiusPattern {
  pattern: RegExp;
  label: string;
}

export const BROAD_BLAST_RADIUS_PATTERNS: readonly BlastRadiusPattern[] = [
  { pattern: /^src\/schema\/.*\.schema\.ts$/, label: "canonical schema" },
  { pattern: /^src\/core\/filesystem\/atomic-write\.ts$/, label: "atomic write" },
  { pattern: /^src\/core\/output\/exit-codes\.ts$/, label: "exit-code mapping" },
  { pattern: /^src\/schema\/external-evidence\/canonical-json\.ts$/, label: "canonicalization" },
  { pattern: /^src\/core\/output\/result\.ts$/, label: "core result contract" },
  { pattern: /^src\/workflow\/(sandbox|autonomous-run)-.*\.ts$/, label: "sandbox/autonomous security boundary" },
  { pattern: /^src\/workspaces\/sandbox-.*\.ts$/, label: "sandbox execution boundary" },
  { pattern: /^(package\.json|pnpm-lock\.yaml|vitest\.config\.ts|tsconfig.*\.json)$/, label: "runtime/toolchain/dependency infrastructure" },
  { pattern: /^tests\/(workload-timeout-policy|helpers)\.ts$/, label: "test infrastructure" },
];

export interface BlastRadiusDetection {
  escalate: boolean;
  reasons: string[];
}

export function detectBroadBlastRadius(paths: readonly string[]): BlastRadiusDetection {
  const reasons: string[] = [];
  for (const p of paths) {
    for (const { pattern, label } of BROAD_BLAST_RADIUS_PATTERNS) {
      if (pattern.test(p)) {
        reasons.push(`"${p}" touches ${label}, a broad-blast-radius surface (milestone-protocol.md Sec 4).`);
      }
    }
  }
  return { escalate: reasons.length > 0, reasons };
}
