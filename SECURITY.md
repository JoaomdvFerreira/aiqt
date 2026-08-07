# Security Policy

## Supported versions

AIQT is currently pre-1.0 (`0.x`) with a single actively maintained line:
the latest published version on `main`. There is no long-term-support or
backport policy for older `0.x` releases -- security fixes land as a new
patch/minor release on the current line, per
[the versioning policy](docs/governance/versioning.md).

| Version | Supported |
|---|---|
| Latest `0.x` (see `package.json`) | Yes |
| Any earlier `0.x` release | No -- upgrade to latest |

## Reporting a vulnerability

**No working private *reporting* channel currently exists for external
researchers.** GitHub's private vulnerability reporting feature is
unavailable on this private repository's current GitHub plan -- verified
via the GitHub API (re-checked 2026-07-20): `GET`/`PUT
.../private-vulnerability-reporting` both return `404`, the same
plan/visibility gate documented for branch protection in `GOVERNANCE.md`.
This is a genuine, currently-unresolved gap, not an oversight.

This is distinct from automated *detection*, which does work: GitHub's
Dependency Graph, Dependabot alerts, and Dependabot security updates are
all confirmed enabled on this repository (verified 2026-07-20) and are
actively finding real issues in dependencies. If your concern is already
covered by an automated dependency alert, it is already being tracked --
this section is specifically about vulnerabilities a human needs to
report that automated scanning would not catch (e.g. in AIQT's own code).

Until private reporting is available, do **not** open a public GitHub
issue for a suspected vulnerability, and do not include exploit details,
credentials, tokens, or other secrets in any public issue, pull request,
or discussion. If you believe you have found a vulnerability, please wait
for the maintainer to enable a working private channel rather than
reporting through a public or insecure one.

**Owner action required:** upgrade the GitHub plan or make the repository
public (either unlocks private vulnerability reporting), then enable it
from the repository's "Security" tab. Once enabled, this section must be
updated to point at it -- this document does not update itself.

## What to expect

This project has a single maintainer and no dedicated security team or
on-call rotation. A realistic, honest response expectation:

- an initial acknowledgment within a best-effort window, typically days
  rather than hours -- there is no guaranteed SLA;
- investigation and, where the report is confirmed, a fix released as a
  new patch or minor version;
- credit to the reporter in the release notes, if desired.

This statement intentionally does not promise capacity this project does
not have (e.g. 24-hour response, a dedicated security contact, or a
published PGP key). If your report is time-sensitive or safety-critical
beyond what a solo-maintained open-source-style tool can reasonably
handle, please say so explicitly in the report.

## Coordinated disclosure

Please give the maintainer a reasonable opportunity to investigate and
release a fix before any public disclosure. There is no bug-bounty
program associated with this project.

## Repository visibility

This repository is currently private, which is the reason private
vulnerability reporting is unavailable (see above). Do not substitute a
direct message or email in the meantime -- wait for a working channel
rather than reporting through an unverified one.

## Dependency supply-chain monitoring

Dependency Graph, Dependabot alerts, and Dependabot security updates are
enabled (verified 2026-07-20). Automated update-PR creation for the npm
ecosystem (which covers pnpm) is currently limited by an external
`dependabot-core` parser limitation with this repository's pnpm lockfile
format -- alert *detection* is unaffected. See `GOVERNANCE.md`'s
"Lockfile-parsing limitation" record for full evidence.

## Scope

AIQT is a local CLI workflow-state tool. It does not execute
arbitrary shell commands, does not spawn external agents or providers,
and does not make network calls during normal workflow operation (see
`GOVERNANCE.md` and the M21 build specification for the current execution
boundary). Reports about the tool's own code, its dependency supply
chain, or its CI/release tooling are all in scope; reports about
third-party services a user chooses to run alongside AIQT are not.
