import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * M46-WU01: portfolio persistence lives outside any single repository's
 * `.aiqt/` directory (build spec Sec 2.1/3) -- it is a user-level local
 * registry, not a second per-project store, and this repository (AIQT
 * itself) must never gain a `.aiqt/` of its own as a side effect of
 * dogfooding this feature. `AIQT_PORTFOLIO_HOME` is an explicit,
 * test/operator-controlled override; production use resolves under the
 * user's home directory. Deliberately not named after any existing
 * repository-local convention (paths.ts's AIQT_DIR_NAME) to avoid implying
 * this is project-scoped state.
 */
export function resolvePortfolioHome(): string {
  const override = process.env.AIQT_PORTFOLIO_HOME;
  if (override && override.trim().length > 0) return resolve(override);
  return join(homedir(), ".aiqt", "portfolios");
}

export function resolvePortfolioFilePath(portfolioHome: string, portfolioId: string): string {
  return join(portfolioHome, `${portfolioId}.json`);
}
