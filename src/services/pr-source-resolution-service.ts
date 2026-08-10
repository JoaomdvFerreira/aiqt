import { resolvePortfolioHome } from "../state/portfolio-home.js";
import { readPortfolioManifest } from "../state/portfolio-store.js";
import { loadAutonomousRunRecord } from "../services/autonomous-run-store.js";
import { buildAutonomousPrDraft } from "../workflow/autonomous-run-pr-draft.js";

/**
 * M47-WU05 (build spec Sec 12 and the M37 handoff-reuse requirement):
 * the two optional, explicit ways a plan's inputs may come from an
 * existing AIQT owner instead of raw flags. Both are strictly additive
 * conveniences -- neither grants authority the operator did not already
 * have.
 */

export type MemberResolution = { ok: true; root: string } | { ok: false; reason: string };

/**
 * Build spec Sec 12: an M46 portfolio member may SELECT the one repository
 * a plan targets. It selects, and nothing more.
 *
 * There is deliberately no way to name a portfolio without also naming
 * exactly one member, no way to resolve "all members", and no batching
 * anywhere in this milestone: one plan is always one repository, one
 * source, one base, one Pull Request. Portfolio membership is a directory,
 * never write authority -- every gate a `--repository` plan passes through
 * (self-management guard, clean tree, identity verification, exact SHA)
 * applies identically to a plan whose root came from here.
 */
export function resolvePortfolioMemberRoot(portfolioId: string, memberId: string): MemberResolution {
  const home = resolvePortfolioHome();
  const manifest = readPortfolioManifest(home, portfolioId);
  if (!manifest.ok) {
    return { ok: false, reason: manifest.reason };
  }
  const member = manifest.manifest.members.find((m) => m.id === memberId);
  if (member === undefined) {
    return { ok: false, reason: `Member "${memberId}" does not exist in portfolio "${portfolioId}".` };
  }
  return { ok: true, root: member.root };
}

export type HandoffResolution = { ok: true; title: string; body: string } | { ok: false; reason: string };

/**
 * M37 handoff reuse: an autonomous run's already-generated PR draft
 * (buildAutonomousPrDraft, M37-WU04) becomes this plan's title and body,
 * verbatim. The draft generator is reused rather than re-implemented, so
 * the text an operator would have pasted by hand is exactly the text the
 * Pull Request gets.
 *
 * A run without an evidence packet is refused: the draft's whole value is
 * that it summarises real validation and self-review findings, and a
 * fabricated one would misrepresent an unfinished run.
 */
export function resolveAutonomousRunHandoff(runId: string, evidenceDir: string): HandoffResolution {
  const loaded = loadAutonomousRunRecord(runId, evidenceDir);
  if (!loaded.ok) {
    return { ok: false, reason: loaded.reason };
  }
  const record = loaded.record;
  if (record.evidencePacket === null) {
    return {
      ok: false,
      reason: `Autonomous run "${runId}" has no evidence packet yet (status "${record.status}"), so it has no Pull Request draft to hand off. Complete the run first.`,
    };
  }
  const draft = buildAutonomousPrDraft(record.candidate, record.evidencePacket);
  return { ok: true, title: draft.title, body: draft.body };
}
