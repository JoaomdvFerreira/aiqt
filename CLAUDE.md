# CLAUDE.md

Instructions for Claude Code in this repository.

Read and follow [`AGENTS.md`](AGENTS.md) — it is the authoritative,
provider-neutral instruction file for working on this repository, including
the AIQT self-development rule and the Work Unit discipline.

`docs/governance/` contains this repository's governance (milestone
protocol, versioning policy, owner map). Consult it directly rather than
relying on memory of prior sessions.

Additional Claude-specific reinforcement:

- Do not start each task by investigating the whole repository. Read only
  the files required by the current Work Unit.
- Do not run the full test suite at every Work Unit boundary unless
  explicitly justified (see AGENTS.md's validation rules).
- Do not spawn subagents by default.
- Keep final reports concise and evidence-focused — state what changed,
  what was validated, and any residual risk; avoid restating specifications
  or pasting long logs.
