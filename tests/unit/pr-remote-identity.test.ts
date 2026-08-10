import { describe, it, expect } from "vitest";
import { parseGitHubRemoteUrl, isSameRepositoryIdentity } from "../../src/workflow/pr-remote-identity.js";

describe("M47-WU02 remote identity: accepts every form Git writes for GitHub", () => {
  const accepted: { url: string; identity: string }[] = [
    { url: "https://github.com/acme/widget.git", identity: "acme/widget" },
    { url: "https://github.com/acme/widget", identity: "acme/widget" },
    { url: "https://www.github.com/acme/widget", identity: "acme/widget" },
    { url: "ssh://git@github.com/acme/widget.git", identity: "acme/widget" },
    { url: "git@github.com:acme/widget.git", identity: "acme/widget" },
    { url: "git@github.com:acme/widget", identity: "acme/widget" },
    { url: "  https://github.com/acme/widget.git  ", identity: "acme/widget" },
    { url: "https://github.com/acme/my.dotted-repo_name.git", identity: "acme/my.dotted-repo_name" },
  ];

  for (const { url, identity } of accepted) {
    it(`parses ${url.trim()}`, () => {
      expect(parseGitHubRemoteUrl(url)?.identity).toBe(identity);
    });
  }
});

describe("M47-WU02 remote identity: a credential embedded in the URL never survives the parse", () => {
  it("parses a token-bearing URL to owner/repo and returns no field that could carry the token", () => {
    const parsed = parseGitHubRemoteUrl("https://x-access-token:ghp_SECRETVALUE@github.com/acme/widget.git");
    expect(parsed?.identity).toBe("acme/widget");
    // The result shape is exactly {owner, repo, identity} -- there is no URL
    // field, so a caller cannot accidentally place the credential into a
    // CommandResult, a persisted plan, or an error message.
    expect(Object.keys(parsed!).sort()).toEqual(["identity", "owner", "repo"]);
    expect(JSON.stringify(parsed)).not.toContain("ghp_SECRETVALUE");
  });
});

describe("M47-WU02 remote identity: anything that is not a GitHub repository is null, never a guess", () => {
  const rejected = [
    "",
    "   ",
    "https://gitlab.com/acme/widget.git",
    "git@bitbucket.org:acme/widget.git",
    "https://github.example.com/acme/widget.git",
    "https://github.com/acme",
    "https://github.com/acme/widget/extra",
    "https://github.com/",
    "not a url at all",
    "file:///tmp/repo",
    "https://github.com/acme/..",
    "https://github.com/-bad/widget",
  ];

  for (const url of rejected) {
    it(`rejects ${JSON.stringify(url)}`, () => {
      expect(parseGitHubRemoteUrl(url)).toBeNull();
    });
  }
});

describe("M47-WU02 remote identity: comparison", () => {
  it("is case-insensitive, matching GitHub's own semantics", () => {
    expect(isSameRepositoryIdentity("acme/widget", "ACME/Widget")).toBe(true);
    expect(isSameRepositoryIdentity("acme/widget", "acme/other")).toBe(false);
  });
});
