/**
 * Keyword signals that indicate a full-stack/web application (§10, §7).
 * Matching is case-insensitive substring matching against combined free-text
 * (rough idea plus existing project context). This is prompt-guidance
 * detection only -- it does not affect canonical schema or validation.
 */
const FULL_STACK_SIGNALS: readonly string[] = [
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

/** True if any full-stack/web-app signal keyword appears in the given text. */
export function detectsFullStackSignals(text: string): boolean {
  const lower = text.toLowerCase();
  return FULL_STACK_SIGNALS.some((signal) => lower.includes(signal));
}
