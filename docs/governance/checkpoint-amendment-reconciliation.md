# Checkpoint unfinished-work reconciliation

`aiqt checkpoint amend` keeps each checkpoint immutable. When external review
finishes work recorded in that checkpoint's `notCompleted` list, record one
append-only reconciliation amendment instead of editing the checkpoint:

```powershell
aiqt checkpoint amend --checkpoint C010 --resolve-not-completed "exact original item" --reason "External review confirmed completion." --resolution-evidence "review:reference"
```

The item must match an original `notCompleted` value exactly. The reason is
required; the evidence/reference is optional. A repeated resolution is a
successful no-op, while an unknown item is rejected. Completion still requires
the latest checkpoint, passed effective acceptance and validation, no remaining
effective unfinished work, no open high/critical issue, no active work unit,
and all existing evidence and stale-checkpoint gates.
