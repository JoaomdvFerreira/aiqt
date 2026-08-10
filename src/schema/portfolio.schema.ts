import { z } from "zod";

/**
 * M46-WU01: the portfolio manifest contract. A portfolio is a local-first
 * registry of explicitly registered AIQT-managed repositories -- it stores
 * only membership and portfolio-specific metadata, never a member's
 * mutable milestone/Work Unit/defect/maintenance/execution/review/release
 * state (build spec Sec 2.1). This is a separate schema/version domain from
 * the canonical project-state schema (AIQT_SCHEMA_VERSION,
 * src/core/constants/schema-version.ts) -- introducing or changing this
 * schema never bumps that one, and vice versa.
 */

export const PORTFOLIO_SCHEMA_VERSION = "1.0.0" as const;

/** Bounds the number of members a single portfolio may register. */
export const MAX_PORTFOLIO_MEMBERS = 200;

/** Bounds the number of portfolios a single local registry may hold. */
export const MAX_PORTFOLIOS = 100;

export const PortfolioMemberSchema = z
  .object({
    id: z.string().min(1),
    /** Canonicalized (resolved) absolute filesystem path to the member repository root. */
    root: z.string().min(1),
    alias: z.string().min(1).optional(),
    addedAt: z.string(),
  })
  .strict();
export type PortfolioMember = z.infer<typeof PortfolioMemberSchema>;

export const PortfolioManifestSchema = z
  .object({
    schemaVersion: z.string(),
    id: z.string().min(1),
    name: z.string().min(1),
    members: z.array(PortfolioMemberSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type PortfolioManifest = z.infer<typeof PortfolioManifestSchema>;
