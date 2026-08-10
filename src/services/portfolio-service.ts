import { resolve } from "node:path";
import { nextId } from "../state/ids.js";
import { PORTFOLIO_SCHEMA_VERSION, MAX_PORTFOLIO_MEMBERS, MAX_PORTFOLIOS } from "../schema/portfolio.schema.js";
import type { PortfolioManifest, PortfolioMember } from "../schema/portfolio.schema.js";

/**
 * M46-WU01: pure portfolio-domain logic -- no I/O. Mirrors
 * maintenance-schedule-service.ts's split: the CLI command layer performs
 * the actual read/write, these functions only decide the resulting shape.
 */

/** Path.resolve() canonicalizes `.`/`..` segments and relative roots to an absolute path. Case is preserved; case-insensitive comparison is a separate concern (see isSameRoot) since Windows paths are case-insensitive but case-preserving. */
export function canonicalizeRepositoryRoot(root: string): string {
  return resolve(root);
}

/** Build spec Sec 8 dogfood scenario 15: Windows path/case behavior -- two roots that differ only in case are the same repository on win32, but distinct on a case-sensitive filesystem. */
export function isSameRoot(a: string, b: string): boolean {
  if (process.platform === "win32" || process.platform === "darwin") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "portfolio";
}

/** Stable portfolio ID (build spec Sec 3): slugified name, disambiguated deterministically against already-registered ids. */
export function generatePortfolioId(name: string, existingIds: readonly string[]): string {
  const base = slugify(name);
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Stable member ID (build spec Sec 3), scoped to one portfolio's own member list. */
export function generateMemberId(existingMemberIds: readonly string[]): string {
  return nextId("M", existingMemberIds);
}

export interface CreatePortfolioInput {
  name: string;
  existingIds: readonly string[];
  now: string;
}

export type CreatePortfolioOutcome =
  | { ok: true; manifest: PortfolioManifest }
  | { ok: false; reason: string };

export function createPortfolioManifest(input: CreatePortfolioInput): CreatePortfolioOutcome {
  if (input.existingIds.length >= MAX_PORTFOLIOS) {
    return { ok: false, reason: `Cannot create another portfolio: the maximum of ${MAX_PORTFOLIOS} portfolios has been reached.` };
  }
  const id = generatePortfolioId(input.name, input.existingIds);
  return {
    ok: true,
    manifest: {
      schemaVersion: PORTFOLIO_SCHEMA_VERSION,
      id,
      name: input.name,
      members: [],
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

export interface AddMemberInput {
  root: string;
  alias?: string;
  now: string;
}

export type AddMemberOutcome =
  | { ok: true; manifest: PortfolioManifest; member: PortfolioMember }
  | { ok: false; reason: string };

/** Build spec Sec 4 "add": explicit registration only, duplicate path prevention (Sec 3). */
export function addPortfolioMember(manifest: PortfolioManifest, input: AddMemberInput): AddMemberOutcome {
  if (manifest.members.length >= MAX_PORTFOLIO_MEMBERS) {
    return { ok: false, reason: `Cannot add another member: portfolio "${manifest.id}" already has the maximum of ${MAX_PORTFOLIO_MEMBERS} members.` };
  }
  const root = canonicalizeRepositoryRoot(input.root);
  const duplicate = manifest.members.find((m) => isSameRoot(m.root, root));
  if (duplicate) {
    return { ok: false, reason: `Repository "${root}" is already registered in portfolio "${manifest.id}" as member "${duplicate.id}".` };
  }

  const member: PortfolioMember = {
    id: generateMemberId(manifest.members.map((m) => m.id)),
    root,
    ...(input.alias !== undefined ? { alias: input.alias } : {}),
    addedAt: input.now,
  };

  return {
    ok: true,
    member,
    manifest: {
      ...manifest,
      members: [...manifest.members, member],
      updatedAt: input.now,
    },
  };
}

export type RemoveMemberOutcome =
  | { ok: true; manifest: PortfolioManifest }
  | { ok: false; reason: string };

/** Build spec Sec 4 "remove": portfolio membership only -- never touches the member repository itself. */
export function removePortfolioMember(manifest: PortfolioManifest, memberId: string, now: string): RemoveMemberOutcome {
  const exists = manifest.members.some((m) => m.id === memberId);
  if (!exists) {
    return { ok: false, reason: `Member "${memberId}" does not exist in portfolio "${manifest.id}".` };
  }
  return {
    ok: true,
    manifest: {
      ...manifest,
      members: manifest.members.filter((m) => m.id !== memberId),
      updatedAt: now,
    },
  };
}
