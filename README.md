# AIQT

Workflow and governance for AI coding agents: local-first, provider-neutral, and resumable.

> **Public Preview / Active Dogfood.** AIQT's functional baseline is complete, but the CLI is pre-1.0 and is being dogfooded on real external projects. Contracts may evolve as that evidence reveals gaps; do not treat this as production/stable or 1.0 software.

## What it is

AIQT is a local CLI workflow and governance engine for AI-assisted software development. It owns structured workflow state, bounded Work Units, execution guidance, validation evidence, review, and governed GitHub integration around the agent or human doing the implementation.

## Quick start

Requirements: Node.js 24+, pnpm 7.33.5, and Git. Docker is required only for the optional sandboxed live-execution path.

```bash
pnpm install --frozen-lockfile
pnpm build
node dist/index.js --help
```

The built binary is not installed globally by `pnpm build`. You may use `node dist/index.js` directly from a clone. AIQT is not currently published to npm.

## Current capabilities

- Canonical, versioned `.aiqt/` project state; bounded graph-based Work Units and resumable guidance.
- Evidence and validation recording, structural review, defect discovery/triage, release-readiness assessment, and bounded GitHub PR integration.
- Intermediate checkpoints: a `progress` checkpoint persists evidence while the active Work Unit remains `in_progress`; it does not unblock dependencies or complete the Work Unit. Terminal checkpoints remain `done` or `needs_review`.
- M48 Night Audit: a bounded `run`/`submit` review session with durable coverage/session state and quality-gated GitHub Issue publication. It is not a background daemon and does not modify source, create PRs, or merge.

## Intentional boundaries

- One Work Unit is active at a time; parallel active Work Units and parallel orchestration are not supported.
- Remote PR/Issue integration is currently GitHub-specific.
- PR merge and Release publication are human-governed.
- Autonomous issue remediation is not implemented.

## Current phase

Functional baseline complete → Public Preview / Active Dogfood → real-world evidence → future development based on observed gaps.

Potential future work is exploratory rather than a committed numbered roadmap. Issue #25 tracks design exploration of concurrent active Work Units.

## Support and security

Use [GitHub Issues](https://github.com/JoaomdvFerreira/aiqt/issues) for non-security bugs, product gaps, and ideas. Do **not** report vulnerabilities there; follow [SECURITY.md](SECURITY.md).

## Documentation

- [Product specification](docs/product/AIQT_Product_Specification_v0.9.md)
- [Technical architecture specification](docs/product/AIQT_Technical_Architecture_Specification_v0.6.md)
- [Governance](GOVERNANCE.md)
- [CLI machine contract](docs/governance/cli-machine-contract.md)

## License

Licensed under the [Apache License 2.0](LICENSE). The repository is open source; `package.json` remains `private: true` to prevent accidental npm publication.
