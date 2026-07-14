import type { SkillsPlan } from "./skills-detection-service.js";

function bulletList(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

/**
 * Deterministic, human-readable aiqt skills plan report (§11). Printed
 * directly in human mode, mirroring aiqt manage/next/prompt's raw-text
 * bypass pattern.
 */
export function renderSkillsPlanText(plan: SkillsPlan): string {
  const lines: string[] = [];

  lines.push("# AIQT Skills Plan", "");

  lines.push("## Detected Integrations", "");
  if (plan.detectedIntegrations.length === 0) {
    lines.push("- None.", "");
  } else {
    for (const integration of plan.detectedIntegrations) {
      lines.push(`### ${integration.displayName} (${integration.id})`);
      lines.push(`- Confidence: ${integration.confidence}`);
      lines.push("- Evidence:");
      lines.push(bulletList(integration.evidence.map((e) => `  ${e}`.trimStart())));
      lines.push(`- Recommended skill: ${integration.recommendedSkill.id}`);
      lines.push(`- Install command: ${integration.recommendedSkill.installCommand}`);
      lines.push("- Installed automatically: no", "");
    }
  }

  lines.push("## Not Detected", "");
  lines.push(bulletList(plan.notDetectedIntegrations), "");

  // M13 §13: advisory design aids, clearly marked as non-installed.
  lines.push("## Design Aids (Advisory, Not Installed)", "");
  if (plan.designAids.length === 0) {
    lines.push("- None recommended for this project.", "");
  } else {
    for (const aid of plan.designAids) {
      lines.push(`### ${aid.id}`);
      lines.push(`- Phase: ${aid.phase}`);
      lines.push(`- Recommended use: ${aid.recommendedUse}`);
      lines.push("- Installed automatically: no", "");
    }
  }

  lines.push("## Safety Notes", "");
  lines.push(bulletList(plan.safetyNotes));

  return lines.join("\n");
}
