/**
 * M13 §9: the built-in design-system planner skill's content data. This is
 * internal planning guidance rendered into existing prompts -- not an
 * installed external Claude Skill, not a schema, not generated UI code.
 * Suggested implementation name: aiqt-design-system-planner.
 */
export const DESIGN_SYSTEM_PLANNER_NAME = "aiqt-design-system-planner";

/** §9.1 required design-system dimensions the planner must cover. */
export const DESIGN_SYSTEM_DIMENSIONS: readonly string[] = [
  "Product design intent and emotional tone",
  "Palette tokens and semantic color usage",
  "Typography direction",
  "Spacing scale",
  "Radius scale",
  "Shadow/elevation rules",
  "Layout grid and content width rules",
  "Component primitive usage rules",
  "Button, form, card, table/list, navigation, dialog, and feedback patterns",
  "Loading, empty, error, success, and disabled states",
  "Responsive breakpoints and mobile behavior",
  "Accessibility baseline: focus states, keyboard navigation, labels, contrast",
  "Motion principles: subtle, purposeful, no excessive animation",
];

/** §9.1 anti-patterns the planner warns against. */
export const DESIGN_SYSTEM_ANTI_PATTERNS: readonly string[] = [
  "Generic default SaaS styling with no product-specific visual direction",
  "Undifferentiated card-grid layouts used for every surface",
  "Default framework/theme gradients used without justification",
  "A second, competing component library or visual system",
];

/**
 * §9.2: guidance AIQT emits to the user-facing external coding/design agent.
 * This is not the implementation sequence for building M13 itself.
 */
export const DESIGN_SYSTEM_PROCESS_GUIDANCE =
  "Suggested process for the external coding/design agent: plan the design direction, critique it, implement bounded UI, then validate.";

/** §10.2 acceptance-criteria guidance for UI-related work units in high/medium UI-heavy projects. */
export const UI_WORK_UNIT_ACCEPTANCE_CRITERIA: readonly string[] = [
  "Uses the established design tokens and component primitives.",
  "Reuses existing UI primitives instead of inventing local one-off styles.",
  "Covers loading, empty, error, success, and disabled states where applicable.",
  "Works at mobile and desktop breakpoints.",
  "Includes visible focus states and keyboard-accessible controls.",
  "Does not introduce a second visual system.",
  "Preserves usability and accessibility over decorative styling.",
];

/** §10.1: the literal example Design System Foundation work unit shape requested from the planning agent for high-confidence projects. */
export const DESIGN_SYSTEM_FOUNDATION_WORK_UNIT_EXAMPLE = {
  clientKey: "design-system-foundation",
  milestoneClientKey: "design-system",
  title: "Design system foundation",
  objective: "Define and implement the visual and component system used by all UI work.",
  scope: [
    "Define product-specific visual direction and design intent",
    "Create Tailwind/shadcn-compatible tokens for color, typography, spacing, radius, and elevation",
    "Define reusable component usage rules for layout, forms, cards, lists, navigation, dialogs, and feedback states",
    "Implement one representative screen or shell that demonstrates the design system",
  ],
  outOfScope: [
    "Do not implement all application pages in this work unit",
    "Do not introduce a second component library or visual system",
  ],
  acceptanceCriteria: [
    "Design tokens are represented in code or configuration",
    "At least one representative UI surface uses the tokens",
    "UI avoids generic default SaaS styling unless explicitly justified",
    "Responsive and keyboard-accessible behavior is covered",
  ],
  agentContextRefs: [],
  suggestedFiles: ["tailwind.config.ts", "components.json", "src/components/ui", "src/app"],
  validationCommands: ["pnpm validate"],
} as const;

/** §11.2 design-system discovery questions asked by aiqt prompt interview for UI-heavy rough ideas. */
export const DESIGN_DISCOVERY_QUESTIONS: readonly string[] = [
  "Who are the target users and roles for this product?",
  "What are the core user journeys, and which surfaces are public vs. authenticated?",
  "Do you have brand or tone references (colors, fonts, existing product screenshots)?",
  "Do you have a design-system preference, such as shadcn/ui + Tailwind?",
  "What accessibility expectations apply (WCAG level, keyboard/screen-reader support)?",
  "What content density and layout preference do you want (compact, spacious, information-dense)?",
  "What mobile/responsive expectations apply?",
  "What is your motion/animation preference (subtle and restrained, or more expressive)?",
  "Are there any UI anti-patterns you specifically want to avoid?",
];
