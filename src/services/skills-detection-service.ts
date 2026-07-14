import { join } from "node:path";
import { readFileSync } from "node:fs";
import { isFile, isDirectory } from "../core/filesystem/file-exists.js";
import type { ProjectModel } from "../schema/project.schema.js";

export type IntegrationId = "supabase" | "clerk" | "shadcn-ui";
export type SkillConfidence = "high" | "medium" | "low";

export interface RecommendedSkill {
  id: string;
  installCommand: string;
  installAutomatically: false;
}

export interface DetectedIntegration {
  id: IntegrationId;
  displayName: string;
  confidence: SkillConfidence;
  evidence: string[];
  recommendedSkill: RecommendedSkill;
}

export interface SkillsPlan {
  detectedIntegrations: DetectedIntegration[];
  notDetectedIntegrations: IntegrationId[];
  safetyNotes: string[];
}

/** M10 §11: fixed, deterministic order -- future integrations sort alphabetically by id after these three. */
const INTEGRATION_ORDER: readonly IntegrationId[] = ["supabase", "clerk", "shadcn-ui"];

export const SAFETY_NOTES: readonly string[] = [
  "AIQT does not install external skills automatically.",
  "Review public skill contents before relying on them.",
  "AIQT packet scope and project constraints override generic skill guidance.",
];

/** Read merged dependencies + devDependencies from package.json, tolerating a missing/malformed file. */
function readPackageDependencies(root: string): Record<string, string> | null {
  const path = join(root, "package.json");
  if (!isFile(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(raw.dependencies ?? {}), ...(raw.devDependencies ?? {}) };
  } catch {
    return null;
  }
}

function matchDependencies(
  deps: Record<string, string> | null,
  predicate: (name: string) => boolean,
): string[] {
  if (!deps) return [];
  return Object.keys(deps).filter(predicate).sort();
}

/** Weak (any context field) vs. strong (technologyPreferences specifically) textual mention. */
function projectContextMentions(
  project: ProjectModel,
  test: (text: string) => boolean,
): { strong: boolean; weak: boolean } {
  const strong = project.context.technologyPreferences.some((t) => test(t.toLowerCase()));
  if (strong) return { strong: true, weak: false };

  const weakText = [
    project.project.objective,
    ...project.context.constraints,
    ...project.context.architectureNotes,
    ...project.context.businessRules,
    ...project.requirements.map((r) => `${r.title} ${r.description}`),
  ]
    .join(" ")
    .toLowerCase();
  return { strong: false, weak: test(weakText) };
}

/**
 * M10 §11.3: high requires 2+ independent direct repository evidence signals
 * (dependency match, config file, directory, file-content match -- each
 * counted once regardless of how many individual matches it represents);
 * medium requires exactly 1 direct signal, or strong project-context
 * evidence with no direct signal; low is a weak textual mention only.
 */
function computeConfidence(
  directSignalCount: number,
  context: { strong: boolean; weak: boolean },
): SkillConfidence | null {
  if (directSignalCount >= 2) return "high";
  if (directSignalCount === 1) return "medium";
  if (context.strong) return "medium";
  if (context.weak) return "low";
  return null;
}

function detectSupabase(root: string, deps: Record<string, string> | null, project: ProjectModel): DetectedIntegration | null {
  const matchedDeps = matchDependencies(deps, (name) => name === "supabase" || name.startsWith("@supabase/"));
  const hasDependency = matchedDeps.length > 0;

  const hasMigrationsDir = isDirectory(join(root, "supabase", "migrations"));
  const hasSupabaseDir = !hasMigrationsDir && isDirectory(join(root, "supabase"));
  const hasDirectory = hasMigrationsDir || hasSupabaseDir;

  const context = projectContextMentions(project, (t) => t.includes("supabase"));
  const directSignalCount = (hasDependency ? 1 : 0) + (hasDirectory ? 1 : 0);
  const confidence = computeConfidence(directSignalCount, context);
  if (!confidence) return null;

  const evidence: string[] = [];
  for (const dep of matchedDeps) evidence.push(`package.json dependency ${dep}`);
  if (hasMigrationsDir) evidence.push("supabase/migrations directory");
  else if (hasSupabaseDir) evidence.push("supabase/ directory");
  if (context.strong) evidence.push("project technology preferences mention Supabase");
  else if (context.weak) evidence.push("project context mentions Supabase");

  return {
    id: "supabase",
    displayName: "Supabase",
    confidence,
    evidence,
    recommendedSkill: {
      id: "supabase-agent-skills",
      installCommand: "npx skills add supabase/agent-skills",
      installAutomatically: false,
    },
  };
}

function detectClerk(root: string, deps: Record<string, string> | null, project: ProjectModel): DetectedIntegration | null {
  const matchedDeps = matchDependencies(deps, (name) => name.startsWith("@clerk/"));
  const hasDependency = matchedDeps.length > 0;

  let middlewareEvidence: string | null = null;
  for (const relativePath of ["middleware.ts", "middleware.js", "src/middleware.ts", "src/middleware.js"]) {
    const path = join(root, ...relativePath.split("/"));
    if (!isFile(path)) continue;
    try {
      const content = readFileSync(path, "utf8");
      if (content.toLowerCase().includes("clerk")) {
        middlewareEvidence = `${relativePath} references Clerk`;
        break;
      }
    } catch {
      // unreadable file: skip, not fatal to detection
    }
  }
  const hasMiddleware = middlewareEvidence !== null;

  const context = projectContextMentions(project, (t) => t.includes("clerk"));
  const directSignalCount = (hasDependency ? 1 : 0) + (hasMiddleware ? 1 : 0);
  const confidence = computeConfidence(directSignalCount, context);
  if (!confidence) return null;

  const evidence: string[] = [];
  for (const dep of matchedDeps) evidence.push(`package.json dependency ${dep}`);
  if (middlewareEvidence) evidence.push(middlewareEvidence);
  if (context.strong) evidence.push("project technology preferences mention Clerk");
  else if (context.weak) evidence.push("project context mentions Clerk");

  return {
    id: "clerk",
    displayName: "Clerk",
    confidence,
    evidence,
    recommendedSkill: {
      id: "clerk-skills",
      installCommand: "npx skills add clerk/skills",
      installAutomatically: false,
    },
  };
}

function detectShadcnUi(root: string, deps: Record<string, string> | null, project: ProjectModel): DetectedIntegration | null {
  const matchedDeps = matchDependencies(
    deps,
    (name) =>
      name === "class-variance-authority" || name === "tailwind-merge" || name.startsWith("@radix-ui/"),
  );
  const hasDependency = matchedDeps.length > 0;

  const hasComponentsJson = isFile(join(root, "components.json"));
  let uiDirEvidence: string | null = null;
  if (isDirectory(join(root, "src", "components", "ui"))) uiDirEvidence = "src/components/ui directory";
  else if (isDirectory(join(root, "components", "ui"))) uiDirEvidence = "components/ui directory";

  const context = projectContextMentions(project, (t) => /shadcn/.test(t));
  const directSignalCount =
    (hasComponentsJson ? 1 : 0) + (uiDirEvidence ? 1 : 0) + (hasDependency ? 1 : 0);
  const confidence = computeConfidence(directSignalCount, context);
  if (!confidence) return null;

  const evidence: string[] = [];
  if (hasComponentsJson) evidence.push("components.json");
  if (uiDirEvidence) evidence.push(uiDirEvidence);
  for (const dep of matchedDeps) evidence.push(`package.json dependency ${dep}`);
  if (context.strong) evidence.push("project technology preferences mention shadcn/ui");
  else if (context.weak) evidence.push("project context mentions shadcn/ui");

  return {
    id: "shadcn-ui",
    displayName: "shadcn/ui",
    confidence,
    evidence,
    recommendedSkill: {
      id: "shadcn-ui",
      installCommand: "pnpm dlx skills add shadcn/ui",
      installAutomatically: false,
    },
  };
}

const DETECTORS: Record<
  IntegrationId,
  (root: string, deps: Record<string, string> | null, project: ProjectModel) => DetectedIntegration | null
> = {
  supabase: detectSupabase,
  clerk: detectClerk,
  "shadcn-ui": detectShadcnUi,
};

/**
 * M10 §11: read-only, deterministic integration detection. Reads
 * package.json and known repository paths/directories under `root`, plus
 * project context text -- performs no network access and mutates nothing.
 */
export function buildSkillsPlan(root: string, project: ProjectModel): SkillsPlan {
  const deps = readPackageDependencies(root);

  const detectedIntegrations: DetectedIntegration[] = [];
  const notDetectedIntegrations: IntegrationId[] = [];

  for (const id of INTEGRATION_ORDER) {
    const result = DETECTORS[id](root, deps, project);
    if (result) detectedIntegrations.push(result);
    else notDetectedIntegrations.push(id);
  }

  return {
    detectedIntegrations,
    notDetectedIntegrations,
    safetyNotes: [...SAFETY_NOTES],
  };
}
