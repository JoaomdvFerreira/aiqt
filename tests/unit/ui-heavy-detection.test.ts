import { describe, it, expect } from "vitest";
import {
  detectUiHeavy,
  buildUiHeavyDetectionText,
  isUiHeavy,
  containsPhrase,
} from "../../src/workflow/design/ui-heavy-detection.js";

describe("detectUiHeavy", () => {
  it("returns high for Next.js + React/shadcn/Tailwind plus a marketplace/dashboard/booking product signal", () => {
    const text =
      "Build a Next.js and React app using shadcn/ui and Tailwind for a marketplace with a booking flow.";
    const result = detectUiHeavy({ text });
    expect(result.confidence).toBe("high");
    expect(result.matchedTechnologySignals.length).toBeGreaterThanOrEqual(2);
    expect(result.matchedProductSignals.length).toBeGreaterThanOrEqual(1);
  });

  it("returns medium for exactly one strong technology signal and no product signal", () => {
    const result = detectUiHeavy({ text: "We are building this with React." });
    expect(result.confidence).toBe("medium");
  });

  it("returns medium for two strong product signals with no technology signal", () => {
    const result = detectUiHeavy({ text: "A dashboard with an onboarding flow for new users." });
    expect(result.confidence).toBe("medium");
  });

  it("returns low for weak textual UI mentions only", () => {
    const result = detectUiHeavy({ text: "We need a nice UI with a clean page style." });
    expect(result.confidence).toBe("low");
    expect(result.matchedTechnologySignals).toEqual([]);
    expect(result.matchedProductSignals).toEqual([]);
    expect(result.hasWeakTextualSignal).toBe(true);
  });

  it("returns none for backend/CLI-only project context", () => {
    const result = detectUiHeavy({
      text: "A command-line tool that renames files in bulk and reads configuration from a YAML file.",
    });
    expect(result.confidence).toBe("none");
  });

  it("does not double-count repeated mentions of the same technology concept", () => {
    const result = detectUiHeavy({ text: "React react REACT. Next.js nextjs. Tailwind tailwind." });
    // Same 3 concepts (react, next-js, tailwind) regardless of repeated casing/mentions.
    expect(result.matchedTechnologySignals.sort()).toEqual(["next-js", "react", "tailwind"]);
  });

  it("does not false-positive short product words inside longer words (e.g. 'form' inside 'platform')", () => {
    const result = detectUiHeavy({ text: "We are building a deployment platform for internal teams." });
    expect(result.matchedProductSignals).toEqual([]);
  });

  it("is best-effort against a repo root that does not exist, degrading rather than throwing", () => {
    expect(() =>
      detectUiHeavy({ text: "plain text", repoRoot: "/definitely/does/not/exist/anywhere" }),
    ).not.toThrow();
  });

  it("isUiHeavy is true only for high/medium", () => {
    expect(isUiHeavy("high")).toBe(true);
    expect(isUiHeavy("medium")).toBe(true);
    expect(isUiHeavy("low")).toBe(false);
    expect(isUiHeavy("none")).toBe(false);
  });
});

describe("buildUiHeavyDetectionText", () => {
  it("combines idea and project fields deterministically", () => {
    const project = {
      version: "1.0.0",
      project: {
        id: "PROJ-001",
        name: "Test",
        objective: "Build a marketplace",
        targetUsers: ["Client", "Professional"],
        preferredAgent: null,
        existingRepositoryPath: null,
        createdAt: "2026-07-14T00:00:00.000Z",
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
      context: {
        constraints: ["Must use Next.js"],
        nonGoals: [],
        technologyPreferences: ["React", "Tailwind"],
        businessRules: [],
        architectureNotes: [],
      },
      requirements: [],
      decisions: [],
      risks: [],
      assumptions: [],
      openQuestions: [],
      quality: { preferredValidationCommands: [] },
    };
    const text = buildUiHeavyDetectionText({ project, idea: "Also a booking flow" });
    expect(text).toContain("Also a booking flow");
    expect(text).toContain("Build a marketplace");
    expect(text).toContain("Next.js");
    expect(text).toContain("React");
  });

  it("handles a null project and null idea without throwing", () => {
    expect(() => buildUiHeavyDetectionText({ project: null, idea: null })).not.toThrow();
    expect(buildUiHeavyDetectionText({ project: null, idea: null }).trim()).toBe("");
  });
});

describe("containsPhrase", () => {
  it("matches whole words/phrases only, not substrings", () => {
    expect(containsPhrase("a platform for teams", "form")).toBe(false);
    expect(containsPhrase("submit the form below", "form")).toBe(true);
  });

  it("matches multi-word phrases with flexible whitespace", () => {
    expect(containsPhrase("this is a public   website", "public website")).toBe(true);
  });
});
