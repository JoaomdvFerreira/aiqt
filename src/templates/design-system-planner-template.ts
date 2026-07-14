import {
  DESIGN_SYSTEM_PLANNER_NAME,
  DESIGN_SYSTEM_DIMENSIONS,
  DESIGN_SYSTEM_ANTI_PATTERNS,
  DESIGN_SYSTEM_PROCESS_GUIDANCE,
  UI_WORK_UNIT_ACCEPTANCE_CRITERIA,
  DESIGN_SYSTEM_FOUNDATION_WORK_UNIT_EXAMPLE,
} from "../workflow/design/design-system-planner.js";

function bulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * M13 §9/§10: render the built-in design-system planner guidance block for
 * injection into aiqt prompt plan. Only called for "high" or "medium"
 * UI-heavy confidence -- callers must gate on isUiHeavy() before invoking
 * this. High confidence additionally requests Design System Foundation work
 * (§10.1); medium uses recommendation language instead of a requirement.
 */
export function renderDesignSystemPlannerBlock(confidence: "high" | "medium"): string {
  const lines: string[] = [];

  lines.push(`Design-system planning guidance (${DESIGN_SYSTEM_PLANNER_NAME}):`);
  lines.push(
    confidence === "high"
      ? "This project is UI-heavy. The plan must establish a design-system foundation before major UI implementation."
      : "This project shows UI-heavy signals. Consider establishing a design-system foundation before broad UI implementation.",
  );
  lines.push("");

  lines.push("Cover these design-system dimensions during planning:");
  lines.push(bulletList(DESIGN_SYSTEM_DIMENSIONS));
  lines.push("");

  lines.push("Anti-patterns to avoid unless explicitly justified:");
  lines.push(bulletList(DESIGN_SYSTEM_ANTI_PATTERNS));
  lines.push("");

  lines.push(DESIGN_SYSTEM_PROCESS_GUIDANCE);
  lines.push("");

  if (confidence === "high") {
    lines.push("Design System Foundation work:");
    lines.push(
      "The resulting plan should include design-system foundation work before major UI implementation -- a milestone or one or more early work units. If a milestone is used, its title should be equivalent to \"Design System Foundation\". Example work unit shape to request from the planning agent:",
    );
    lines.push(JSON.stringify(DESIGN_SYSTEM_FOUNDATION_WORK_UNIT_EXAMPLE, null, 2));
    lines.push("");
  }

  lines.push("For UI-related work units, add acceptance criteria similar to:");
  lines.push(bulletList(UI_WORK_UNIT_ACCEPTANCE_CRITERIA));

  return lines.join("\n");
}
