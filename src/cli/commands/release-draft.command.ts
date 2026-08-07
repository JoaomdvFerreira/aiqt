import type { CommandContext } from "../command-context.js";
import { makeResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import type { StdinLike } from "../../core/filesystem/stdin.js";
import { assessReleaseDecision } from "../../services/release-governance-service.js";
import { loadReleaseRequestBody, toReleaseIntentRequest, releaseFailure, mapReadinessIntegrity } from "./release-shared.js";
import { checkDraftPrerequisites, parseOwnerRepo, missingGithubTokenActions } from "../../workflow/release-draft-policy.js";
import { renderReleaseNotesMarkdown, type ReadyReleaseDecision } from "../../workflow/release-notes.js";
import { realGithubReleaseClient, type GithubReleaseClient } from "../../services/github-release-client.js";
import type { ReleaseDraftState } from "../../schema/release-governance.schema.js";

/**
 * `aiqt release draft` (build spec Sec 10, 11): the one bounded GitHub
 * side effect M40 performs -- creates a DRAFT release for an already
 * integrity-checked candidate. Requires explicit command intent (this is
 * its own subcommand, never invoked implicitly). Never publishes: the
 * underlying client (github-release-client.ts) hardcodes `draft: true`
 * with no publish operation anywhere in the codebase.
 */
export interface ReleaseDraftOptions {
  fromFile?: string;
  stdin?: boolean;
  /** Name of the environment variable holding the GitHub token. Defaults to GITHUB_TOKEN. Never a token value itself. */
  tokenEnv?: string;
}

export interface ReleaseDraftDeps {
  stdin?: StdinLike;
  githubClient?: GithubReleaseClient;
  env?: NodeJS.ProcessEnv;
}

export async function runReleaseDraft(ctx: CommandContext, options: ReleaseDraftOptions, deps: ReleaseDraftDeps = {}): Promise<CommandResult> {
  const loaded = await loadReleaseRequestBody(options, deps);
  if (!loaded.ok) return loaded.result;

  const request = toReleaseIntentRequest(ctx.cwd, loaded.body);
  const outcome = assessReleaseDecision(request);
  if (!outcome.ok) {
    return releaseFailure(
      `Release candidate could not be established: ${outcome.blockingFindings.map((f) => f.message).join("; ")}`,
      ExitCode.InvalidInput,
      "RELEASE-DRAFT-CANDIDATE-INVALID",
    );
  }
  const { decision } = outcome;

  const prereq = checkDraftPrerequisites(decision);
  if (!prereq.ok) {
    return releaseFailure(
      `Release draft creation is blocked: ${prereq.blockingReasons.join(" ")}`,
      ExitCode.WorkflowBlocked,
      "RELEASE-DRAFT-PREREQUISITE-BLOCKED",
      { suggestedAction: prereq.blockingReasons.join(" ") },
    );
  }

  const ownerRepo = parseOwnerRepo(decision.candidate.identity.repositoryIdentity);
  if (ownerRepo === null) {
    // Unreachable given checkDraftPrerequisites already validated this shape; guards against a future refactor drift.
    return releaseFailure("repositoryIdentity is not an owner/repo GitHub identity.", ExitCode.WorkflowBlocked, "RELEASE-DRAFT-PREREQUISITE-BLOCKED");
  }

  const tokenEnvName = options.tokenEnv ?? "GITHUB_TOKEN";
  const env = deps.env ?? process.env;
  const token = env[tokenEnvName];
  if (!token) {
    return releaseFailure(
      `GitHub credentials are not available (environment variable "${tokenEnvName}" is unset).`,
      ExitCode.MissingDependency,
      "RELEASE-DRAFT-MISSING-CREDENTIALS",
      { suggestedAction: missingGithubTokenActions(tokenEnvName).join(" ") },
    );
  }

  const client = deps.githubClient ?? realGithubReleaseClient;

  const repoCheck = await client.getRepository(ownerRepo.owner, ownerRepo.repo, token);
  if (!repoCheck.ok) {
    return releaseFailure(`Unable to verify the GitHub repository identity: ${repoCheck.message}`, ExitCode.ExternalIntegrationError, "RELEASE-DRAFT-REPOSITORY-LOOKUP-FAILED");
  }
  if (repoCheck.value.fullName.toLowerCase() !== decision.candidate.identity.repositoryIdentity.toLowerCase()) {
    return releaseFailure(
      `GitHub repository identity "${repoCheck.value.fullName}" does not match candidate identity "${decision.candidate.identity.repositoryIdentity}".`,
      ExitCode.WorkflowBlocked,
      "RELEASE-DRAFT-REPOSITORY-IDENTITY-MISMATCH",
    );
  }

  const existing = await client.getReleaseByTag(ownerRepo.owner, ownerRepo.repo, decision.candidate.identity.intendedReleaseTag, token);
  if (!existing.ok) {
    return releaseFailure(`Unable to check for an existing release: ${existing.message}`, ExitCode.ExternalIntegrationError, "RELEASE-DRAFT-EXISTING-LOOKUP-FAILED");
  }

  const mapping = mapReadinessIntegrity(decision.readiness.integrity);

  if (existing.value !== null) {
    const draft: ReleaseDraftState = { status: "exists", url: existing.value.htmlUrl, id: String(existing.value.id), createdAt: null };
    return makeResult({
      status: mapping.status,
      action: "release",
      summary: `A release already exists for tag "${decision.candidate.identity.intendedReleaseTag}" (${draft.url}) -- no duplicate draft created. Publication remains a separate, explicit step outside aiqt.`,
      exitCode: mapping.exitCode,
      data: { decision: { ...decision, draft } },
    });
  }

  const ready: ReadyReleaseDecision = { ...decision, risk: decision.risk!, approval: decision.approval! };
  const created = await client.createReleaseDraft(
    ownerRepo.owner,
    ownerRepo.repo,
    {
      tagName: decision.candidate.identity.intendedReleaseTag,
      targetCommitish: decision.candidate.identity.candidateCommit,
      name: decision.candidate.identity.intendedReleaseTag,
      body: renderReleaseNotesMarkdown(ready),
    },
    token,
  );
  if (!created.ok) {
    return releaseFailure(`GitHub release draft creation failed: ${created.message}`, ExitCode.ExternalIntegrationError, "RELEASE-DRAFT-CREATE-FAILED");
  }

  const draft: ReleaseDraftState = { status: "created", url: created.value.htmlUrl, id: String(created.value.id), createdAt: new Date().toISOString() };
  return makeResult({
    status: mapping.status,
    action: "release",
    summary: `Created a GitHub release draft for candidate ${decision.candidate.candidateId}: ${draft.url}. Approval authority: "${decision.approval?.authority}". NOT published -- publication remains a separate, explicit step outside aiqt.`,
    exitCode: mapping.exitCode,
    data: { decision: { ...decision, draft } },
  });
}
