# Security Policy

## Supported versions

AIQT is currently pre-1.0 (`0.x`) with a single actively maintained line:
the latest published version on `main`. There is no long-term-support or
backport policy for older `0.x` releases -- security fixes land as a new
patch/minor release on the current line, per
[the versioning policy](docs/versioning.md).

| Version | Supported |
|---|---|
| Latest `0.x` (see `package.json`) | Yes |
| Any earlier `0.x` release | No -- upgrade to latest |

## Reporting a vulnerability

Please report suspected vulnerabilities using
[GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
feature on this repository ("Security" tab -> "Report a vulnerability").
This keeps the report private between you and the maintainer until a fix
is available.

**Do not open a public GitHub issue for a suspected vulnerability**, and
do not include exploit details, credentials, tokens, or other secrets in
any public issue, pull request, or discussion.

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

This repository is currently private. Reports should still go through
GitHub's private vulnerability reporting flow above rather than a direct
message or email, so the report stays attached to the repository and
its eventual fix.

## Scope

AIQT is a local CLI workflow-state tool. It does not execute
arbitrary shell commands, does not spawn external agents or providers,
and does not make network calls during normal workflow operation (see
`GOVERNANCE.md` and the M21 build specification for the current execution
boundary). Reports about the tool's own code, its dependency supply
chain, or its CI/release tooling are all in scope; reports about
third-party services a user chooses to run alongside AIQT are not.
