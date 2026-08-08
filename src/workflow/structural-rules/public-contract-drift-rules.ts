import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { readRepoFileText } from "../structural-review-evidence.js";

const PACKAGE_JSON_PATH = "package.json";
const CI_WORKFLOW_PATH = ".github/workflows/validate.yml";

/**
 * Section 4.5: a deterministic cross-check between two independently
 * maintained, live declarations of the same fact (supported Node
 * runtime) -- package.json's `engines.node` versus every `node-version:`
 * declared in the CI workflow. A mismatch is `proven` (both are read as
 * plain text/JSON, not inferred).
 */
export function runNodeVersionConsistencyRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const packageText = readRepoFileText(repoRoot, PACKAGE_JSON_PATH);
  const workflowText = readRepoFileText(repoRoot, CI_WORKFLOW_PATH);
  if (packageText === null || workflowText === null) return [];

  let engineMajor: number | null = null;
  try {
    const pkg = JSON.parse(packageText) as { engines?: { node?: string } };
    const match = /(\d+)/.exec(pkg.engines?.node ?? "");
    engineMajor = match ? Number.parseInt(match[1], 10) : null;
  } catch {
    return [];
  }
  if (engineMajor === null) return [];

  const ciVersions = [...workflowText.matchAll(/node-version:\s*["']?(\d+)["']?/g)].map((m) => Number.parseInt(m[1], 10));
  const uniqueCiVersions = [...new Set(ciVersions)];
  if (uniqueCiVersions.length === 0) return [];

  const mismatched = uniqueCiVersions.filter((v) => v < engineMajor);
  if (mismatched.length === 0) return [];

  return [
    buildStructuralFinding({
      domain: "public_contract_drift",
      ruleId: "node-version-declaration-mismatch",
      title: "CI declares a Node version older than package.json's engines.node minimum",
      explanation: `package.json requires Node >=${engineMajor}, but ${CI_WORKFLOW_PATH} declares node-version ${mismatched.join(", ")}, which would fail the engines constraint.`,
      reviewCommit,
      affectedPaths: [PACKAGE_JSON_PATH, CI_WORKFLOW_PATH],
      evidence: [
        { evidenceId: "PACKAGE-ENGINES", description: `package.json engines.node requires >=${engineMajor}.`, locator: PACKAGE_JSON_PATH },
        { evidenceId: "CI-NODE-VERSION", description: `CI declares node-version: ${mismatched.join(", ")}.`, locator: CI_WORKFLOW_PATH },
      ],
      confidence: "proven",
      significance: "high",
      reasonCodes: ["NODE_VERSION_CONTRACT_MISMATCH"],
      disposition: "actionable",
      eligibleForIntake: true,
      recommendedNextAction: "Align package.json's engines.node with the CI workflow's actual node-version, or vice versa.",
      evidenceSignature: `${engineMajor}::${mismatched.sort().join(",")}`,
    }),
  ];
}
