import { describe, it, expect } from "vitest";
import { detectsFullStackSignals } from "../../src/workflow/full-stack-detection.js";

describe("detectsFullStackSignals", () => {
  it("returns false for plain text with no signal keywords", () => {
    expect(detectsFullStackSignals("A simple CLI tool for renaming files.")).toBe(false);
  });

  it("returns true when a signal keyword is present", () => {
    expect(detectsFullStackSignals("Build me a marketplace for handmade goods.")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(detectsFullStackSignals("Uses NEXT.JS and SUPABASE")).toBe(true);
    expect(detectsFullStackSignals("uses next.js and supabase")).toBe(true);
  });

  it("matches each documented signal keyword individually", () => {
    const signals = [
      "next.js",
      "nextjs",
      "react",
      "typescript",
      "supabase",
      "prisma",
      "clerk",
      "shadcn",
      "vercel",
      "web app",
      "marketplace",
      "booking",
      "dashboard",
      "admin",
    ];
    for (const signal of signals) {
      expect(detectsFullStackSignals(`Some text mentioning ${signal} in context.`)).toBe(true);
    }
  });

  it("returns false for empty text", () => {
    expect(detectsFullStackSignals("")).toBe(false);
  });
});
