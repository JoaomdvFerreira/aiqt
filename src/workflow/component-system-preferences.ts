import type { ProjectModel } from "../schema/project.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import {
  detectUiHeavyForProject,
  buildUiHeavyDetectionText,
  containsPhrase,
} from "./design/ui-heavy-detection.js";
import { isWorkUnitUiRelated } from "./design/design-guidance-rules.js";

/**
 * M14 §9: component-system preference enforcement (F053). Reuses the
 * existing M13 UI-heavy detector's shadcn-ui technology-concept signal
 * rather than creating a second detector; only adds the "explicit
 * custom-primitives-only override" and "no preference declared" cases on
 * top of it.
 */
export type ComponentSystemPreference = "shadcn-ui" | "custom-primitives" | "none";

export interface ComponentSystemPreferenceResult {
  preference: ComponentSystemPreference;
  evidence: string[];
}

/** §9.1: explicit opt-out phrasing that overrides any shadcn/ui signal, even if shadcn/ui is otherwise mentioned. */
const CUSTOM_PRIMITIVES_OVERRIDE_PHRASES: readonly string[] = [
  "custom primitives only",
  "custom tailwind primitives",
  "no shadcn",
  "without shadcn",
  "not using shadcn",
];

/**
 * §9.1: detect the project's declared component-system preference from
 * project.context.technologyPreferences/architectureNotes, requirements,
 * decisions, and existing repository evidence (components.json etc, via the
 * shared M13 detector). An explicit custom-primitives-only declaration
 * always wins over an incidental shadcn/ui mention.
 */
export function detectComponentSystemPreference(input: {
  project?: ProjectModel | null;
  idea?: string | null;
  repoRoot?: string | null;
}): ComponentSystemPreferenceResult {
  const text = buildUiHeavyDetectionText(input);

  const prefersCustomOnly = CUSTOM_PRIMITIVES_OVERRIDE_PHRASES.some((phrase) =>
    containsPhrase(text, phrase),
  );
  if (prefersCustomOnly) {
    return {
      preference: "custom-primitives",
      evidence: ["Project context explicitly prefers custom primitives only (no shadcn/ui)."],
    };
  }

  const uiHeavy = detectUiHeavyForProject(input);
  if (uiHeavy.matchedTechnologySignals.includes("shadcn-ui")) {
    return {
      preference: "shadcn-ui",
      evidence: ["Project declares a shadcn/ui component-system preference."],
    };
  }

  return { preference: "none", evidence: [] };
}

/** §9.2: true only when the project declares shadcn/ui and no custom-primitives-only override is present. */
export function requiresShadcnEnforcement(result: ComponentSystemPreferenceResult): boolean {
  return result.preference === "shadcn-ui";
}

/** §9.3: acceptance-criteria template for UI work units in a shadcn/ui project. */
export const SHADCN_UI_ACCEPTANCE_CRITERIA: readonly string[] = [
  "components.json or equivalent shadcn/ui configuration exists.",
  "Core controls use shadcn/ui-based primitives or project wrappers around them.",
  "No duplicate hand-rolled Button/Input/Card primitives exist unless justified.",
  "Tailwind tokens and shadcn/ui CSS variables are aligned.",
  "Keyboard focus states and disabled/loading states are preserved.",
];

/** §9.2: planning guidance requiring a shadcn/ui setup/integration work unit. Only call when requiresShadcnEnforcement is true. */
export function renderShadcnPlanningGuidance(): string {
  const lines: string[] = [];
  lines.push("Component-system enforcement (shadcn/ui):");
  lines.push("This project declares a shadcn/ui component-system preference. The plan must:");
  lines.push("- Include a shadcn/ui setup or integration work unit.");
  lines.push(
    "- Distinguish design tokens from component-library implementation in the design-system foundation work.",
  );
  lines.push(
    "- Require UI work units to use shadcn/ui primitives or wrappers, not duplicate hand-rolled Button/Input/Card primitives.",
  );
  lines.push("- Allow custom primitives only when explicitly justified in checkpoint notes.");
  lines.push("");
  lines.push("For UI-related work units, add acceptance criteria similar to:");
  lines.push(...SHADCN_UI_ACCEPTANCE_CRITERIA.map((c) => `- ${c}`));
  return lines.join("\n");
}

/** §9.2/§11.1: packet-level component-system guidance section. Only call when shouldIncludeComponentSystemGuidance is true. */
export function renderComponentSystemGuidanceSection(): string {
  const lines: string[] = [];
  lines.push("## Component System Guidance");
  lines.push("");
  lines.push("This project declares a shadcn/ui component-system preference:");
  lines.push("- Use shadcn/ui primitives or project wrappers around them for this work unit's UI.");
  lines.push("- Do not duplicate hand-rolled Button/Input/Card primitives.");
  lines.push("- Custom primitives are allowed only when explicitly justified in checkpoint notes.");
  lines.push("- Keep Tailwind tokens and shadcn/ui CSS variables aligned.");
  lines.push("- Preserve keyboard focus states and disabled/loading states.");
  return lines.join("\n");
}

/** §12: a packet includes Component System Guidance only when shadcn/ui is declared AND the selected work unit is UI-related. */
export function shouldIncludeComponentSystemGuidance(
  preference: ComponentSystemPreference,
  workUnit: WorkUnit,
): boolean {
  return preference === "shadcn-ui" && isWorkUnitUiRelated(workUnit);
}
