import type { WorkUnit } from "../../schema/work-unit.schema.js";
import { containsPhrase, isUiHeavy, type UiHeavyConfidence } from "./ui-heavy-detection.js";

/** §8.3 strong UI terms used to decide whether a specific selected work unit is UI-related. */
const UI_RELATED_TERMS: readonly string[] = [
  "page",
  "route",
  "screen",
  "form",
  "component",
  "layout",
  "responsive",
  "accessibility",
  "shadcn",
  "tailwind",
  "dashboard",
  "profile",
  "onboarding",
  "booking",
  "search",
  "public ui",
  "admin ui",
];

/** §8.3 repository path conventions that also mark a work unit UI-related via its suggestedFiles. */
const UI_RELATED_PATH_PREFIXES: readonly string[] = [
  "app/",
  "pages/",
  "components/",
  "src/components/",
];

/**
 * §8.3: a selected work unit is UI-related when its title, objective, scope,
 * acceptance criteria, suggested files, or agentContextRefs include a strong
 * UI term, or when a suggested file falls under a UI repository convention
 * (app/, pages/, components/, src/components/). Shared by aiqt next packet
 * rendering; must not be reimplemented elsewhere.
 */
export function isWorkUnitUiRelated(workUnit: WorkUnit): boolean {
  const text = [
    workUnit.title,
    workUnit.objective,
    ...workUnit.scope,
    ...workUnit.acceptanceCriteria,
    ...workUnit.suggestedFiles,
    ...workUnit.agentContextRefs,
  ].join(" ");

  if (UI_RELATED_TERMS.some((term) => containsPhrase(text, term))) return true;

  return workUnit.suggestedFiles.some((file) => {
    const lower = file.toLowerCase();
    return UI_RELATED_PATH_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower.includes(`/${prefix}`));
  });
}

/**
 * §12: a packet's Design Guidance section is included only when the project
 * is UI-heavy with high/medium confidence AND the selected work unit is
 * itself UI-related. Never expands the work unit's scope; packet scope and
 * out-of-scope always win over this guidance.
 */
export function shouldIncludeDesignGuidance(
  confidence: UiHeavyConfidence,
  workUnit: WorkUnit,
): boolean {
  return isUiHeavy(confidence) && isWorkUnitUiRelated(workUnit);
}

/** §12: the exact, bounded Design Guidance packet section. */
export function renderDesignGuidanceSection(): string {
  const lines: string[] = [];
  lines.push("## Design Guidance");
  lines.push("");
  lines.push("Design-system priority:");
  lines.push("- Follow the project design-system foundation and existing tokens/components.");
  lines.push("- Do not introduce a second visual system.");
  lines.push("- Keep this work unit bounded to the selected packet scope.");
  lines.push("");
  lines.push("UI quality constraints:");
  lines.push("- Use product-specific visual direction rather than generic default SaaS styling.");
  lines.push("- Cover responsive behavior and keyboard-accessible interaction.");
  lines.push("- Include loading, empty, error, and success states where applicable.");
  lines.push("- Preserve usability and accessibility over decoration.");
  lines.push("");
  lines.push("Priority:");
  lines.push("1. AIQT packet scope and out-of-scope");
  lines.push("2. Current repository code and established design tokens");
  lines.push("3. Project constraints and non-goals");
  lines.push("4. Recommended design aids/skills");
  lines.push("5. Generic model knowledge");
  return lines.join("\n");
}
