import { describe, it, expect, afterEach } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolvePortfolioHome, resolvePortfolioFilePath } from "../../src/state/portfolio-home.js";

const ORIGINAL_ENV = process.env.AIQT_PORTFOLIO_HOME;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.AIQT_PORTFOLIO_HOME;
  else process.env.AIQT_PORTFOLIO_HOME = ORIGINAL_ENV;
});

describe("resolvePortfolioHome (M46-WU01, build spec Sec 3)", () => {
  it("defaults to a user-home-scoped directory outside any repository's .aiqt/", () => {
    delete process.env.AIQT_PORTFOLIO_HOME;
    expect(resolvePortfolioHome()).toBe(join(homedir(), ".aiqt", "portfolios"));
  });

  it("honors an explicit override for tests/operators", () => {
    process.env.AIQT_PORTFOLIO_HOME = "/tmp/aiqt-portfolios-override";
    expect(resolvePortfolioHome()).toBe(resolve("/tmp/aiqt-portfolios-override"));
  });

  it("ignores a blank override", () => {
    process.env.AIQT_PORTFOLIO_HOME = "   ";
    expect(resolvePortfolioHome()).toBe(join(homedir(), ".aiqt", "portfolios"));
  });
});

describe("resolvePortfolioFilePath (M46-WU01)", () => {
  it("builds one JSON file path per portfolio id", () => {
    expect(resolvePortfolioFilePath("/home/x/.aiqt/portfolios", "acme")).toBe(join("/home/x/.aiqt/portfolios", "acme.json"));
  });
});
