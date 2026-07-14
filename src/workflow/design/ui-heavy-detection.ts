import { join } from "node:path";
import { readFileSync } from "node:fs";
import { isFile, isDirectory } from "../../core/filesystem/file-exists.js";
import type { ProjectModel } from "../../schema/project.schema.js";

/**
 * M13 §8: the single, shared, deterministic UI-heavy detector. Every M13
 * call site (prompt plan, prompt driver, prompt interview, packet rendering,
 * skills plan) must go through this module rather than reimplementing
 * detection logic.
 */
export type UiHeavyConfidence = "high" | "medium" | "low" | "none";

interface SignalConcept {
  id: string;
  /** Word-boundary-matched phrases; any one matching marks this concept present. */
  patterns: readonly string[];
}

/** §8.1 strong technology signals, grouped into canonical concepts so repeated evidence for the same technology never double-counts. */
const TECHNOLOGY_TEXT_CONCEPTS: readonly SignalConcept[] = [
  { id: "next-js", patterns: ["next.js", "nextjs"] },
  { id: "react", patterns: ["react"] },
  { id: "shadcn-ui", patterns: ["shadcn"] },
  { id: "tailwind", patterns: ["tailwind"] },
  { id: "radix-ui", patterns: ["radix"] },
  { id: "class-variance-authority", patterns: ["class-variance-authority"] },
];

/** §8.1 strong product signals, grouped into canonical concepts. */
const PRODUCT_TEXT_CONCEPTS: readonly SignalConcept[] = [
  { id: "public-website", patterns: ["public website"] },
  { id: "marketplace", patterns: ["marketplace"] },
  { id: "saas", patterns: ["saas"] },
  { id: "dashboard", patterns: ["dashboard"] },
  { id: "booking-flow", patterns: ["booking flow", "booking"] },
  { id: "onboarding-flow", patterns: ["onboarding flow", "onboarding"] },
  { id: "user-roles", patterns: ["client role", "admin role", "professional role", "user roles"] },
  { id: "authenticated-journey", patterns: ["authenticated user", "authenticated journey"] },
  { id: "profile-pages", patterns: ["profile page"] },
  { id: "search-browse", patterns: ["search flow", "browse flow"] },
  { id: "forms", patterns: ["form"] },
];

/** §8.1 weak textual mentions: generic UI words with no supporting technology or product signal. */
const WEAK_TEXTUAL_SIGNALS: readonly string[] = [
  "ui",
  "frontend",
  "page",
  "screen",
  "style",
  "component",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary, case-insensitive phrase match -- avoids false positives like "form" inside "platform". */
export function containsPhrase(text: string, phrase: string): boolean {
  const pattern = phrase
    .split(" ")
    .map((word) => escapeRegExp(word))
    .join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i").test(text);
}

function matchConceptIds(text: string, concepts: readonly SignalConcept[]): string[] {
  return concepts
    .filter((concept) => concept.patterns.some((phrase) => containsPhrase(text, phrase)))
    .map((concept) => concept.id);
}

function readPackageDependencyNames(repoRoot: string): string[] {
  const path = join(repoRoot, "package.json");
  if (!isFile(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.keys({ ...(raw.dependencies ?? {}), ...(raw.devDependencies ?? {}) });
  } catch {
    return [];
  }
}

/**
 * Best-effort repository-derived technology concepts (package.json
 * dependencies, components.json, app/pages route structure,
 * src/components/ui). Never throws: detector errors degrade to no repo
 * evidence rather than blocking detection (§17).
 */
function detectRepoTechnologyConceptIds(repoRoot: string | null | undefined): string[] {
  if (!repoRoot) return [];
  try {
    const ids = new Set<string>();
    const depNames = readPackageDependencyNames(repoRoot);
    if (depNames.includes("next")) ids.add("next-js");
    if (depNames.includes("react")) ids.add("react");
    if (depNames.includes("tailwindcss")) ids.add("tailwind");
    if (depNames.includes("class-variance-authority")) ids.add("class-variance-authority");
    if (depNames.some((name) => name.startsWith("@radix-ui/"))) ids.add("radix-ui");

    if (isFile(join(repoRoot, "components.json"))) ids.add("shadcn-ui");
    if (
      isDirectory(join(repoRoot, "src", "components", "ui")) ||
      isDirectory(join(repoRoot, "components", "ui"))
    ) {
      ids.add("shadcn-ui");
    }
    if (
      isDirectory(join(repoRoot, "app")) ||
      isDirectory(join(repoRoot, "pages")) ||
      isDirectory(join(repoRoot, "src", "app")) ||
      isDirectory(join(repoRoot, "src", "pages"))
    ) {
      ids.add("next-js");
    }
    return [...ids];
  } catch {
    return [];
  }
}

export interface UiHeavyDetectionInput {
  /** Free text to scan: project objective, technology preferences, constraints, rough idea, etc. */
  text: string;
  /** Repository root for best-effort package.json/directory evidence. Optional -- detection degrades gracefully without it. */
  repoRoot?: string | null;
}

export interface UiHeavyDetectionResult {
  confidence: UiHeavyConfidence;
  matchedTechnologySignals: string[];
  matchedProductSignals: string[];
  hasWeakTextualSignal: boolean;
}

/**
 * §8.2 deterministic confidence scoring:
 * high = >=2 strong technology signals AND >=1 strong product signal.
 * medium = >=1 strong technology signal OR >=2 strong product signals.
 * low = only weak textual UI mentions.
 * none = no meaningful UI/product signals.
 */
export function detectUiHeavy(input: UiHeavyDetectionInput): UiHeavyDetectionResult {
  const text = input.text ?? "";
  const textTechnologyIds = matchConceptIds(text, TECHNOLOGY_TEXT_CONCEPTS);
  const repoTechnologyIds = detectRepoTechnologyConceptIds(input.repoRoot);
  const matchedTechnologySignals = [...new Set([...textTechnologyIds, ...repoTechnologyIds])];
  const matchedProductSignals = matchConceptIds(text, PRODUCT_TEXT_CONCEPTS);
  const hasWeakTextualSignal = WEAK_TEXTUAL_SIGNALS.some((word) => containsPhrase(text, word));

  const techCount = matchedTechnologySignals.length;
  const productCount = matchedProductSignals.length;

  let confidence: UiHeavyConfidence;
  if (techCount >= 2 && productCount >= 1) {
    confidence = "high";
  } else if (techCount >= 1 || productCount >= 2) {
    confidence = "medium";
  } else if (hasWeakTextualSignal) {
    confidence = "low";
  } else {
    confidence = "none";
  }

  return { confidence, matchedTechnologySignals, matchedProductSignals, hasWeakTextualSignal };
}

/** True for "high" or "medium" -- the two confidence levels that trigger design-system guidance injection. */
export function isUiHeavy(confidence: UiHeavyConfidence): boolean {
  return confidence === "high" || confidence === "medium";
}

/**
 * Build the combined free-text detection input from canonical project
 * fields plus an optional rough idea, so every prompt call site derives text
 * the same way instead of re-assembling its own field list.
 */
export function buildUiHeavyDetectionText(input: {
  project?: ProjectModel | null;
  idea?: string | null;
}): string {
  const { project, idea } = input;
  return [
    idea ?? "",
    project?.project.objective ?? "",
    (project?.project.targetUsers ?? []).join(" "),
    (project?.context.technologyPreferences ?? []).join(" "),
    (project?.context.constraints ?? []).join(" "),
    (project?.context.architectureNotes ?? []).join(" "),
    (project?.context.businessRules ?? []).join(" "),
    (project?.requirements ?? []).map((r) => `${r.title} ${r.description}`).join(" "),
  ].join(" ");
}

/** Convenience: build detection text and run the detector in one call. */
export function detectUiHeavyForProject(input: {
  project?: ProjectModel | null;
  idea?: string | null;
  repoRoot?: string | null;
}): UiHeavyDetectionResult {
  return detectUiHeavy({
    text: buildUiHeavyDetectionText(input),
    repoRoot: input.repoRoot,
  });
}
