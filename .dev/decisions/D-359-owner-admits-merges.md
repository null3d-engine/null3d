# D-359: The owner admits the vegetation integration merges and a typed merge subject

Status: decided by the owner; both rules are built. Task: none.

Summary: The owner ruled, in their words: "1. widen. 2. they're in." The commit-message check now
skips a subject that starts `merge(`, as it already skipped one that starts `Merge `. A real merge
whose lower-case subject names its type passes. The merge guard's known list names the forty-three
vegetation integration merges beside the nine D-259 named. The guard refuses no merge in the landing
range.

## Question

A two-parent merge on the branch carries the subject `merge(vegetation): ...`. The check ignored a
subject starting `Merge ` only, so this merge failed on a type the conventional list does not name.
Separately, the merge guard refused forty-three merges that bring vegetation branches into the
landing range, each holding work its resolutions settled. May the merge's subject pass, and may those
forty-three merges stay?

## Rule

The owner settles both, in their words: "1. widen. 2. they're in."

The widening is a pattern change only: a subject that starts `merge(` is treated as a merge subject
for the type rule. A merge is still judged by what it merges, by the merge guard, which reads each
merge's own changes. The forty-three are named one by one in `KNOWN_MERGES`, as the nine are, and the
guard's rule holds for every merge made from then on.

## Data

| Measure | Figure |
| --- | --- |
| Merges the request named | 43, carrying 16,720 words of new work |
| The nine D-259 already named | 2,625 words |
| The ledger's count of refused merges | 52, being 43 + 9, at 19,345 words |
| The guard after the ruling | `merges OK in 584ac4606d304e0e281fb4361fc83f11ac219f02..HEAD`, exit 0 |
| The merge that prompted the widening | `7f7908988`, a two-parent merge, 105 commits back |

How the data was produced: `bun tools/hooks/check-merges.ts
584ac4606d304e0e281fb4361fc83f11ac219f02..HEAD`, run at `7b656bc31`. The commit-message check ran
against `7f7908988`'s own message. The counts come from the request prepared before the ruling. Its
arithmetic closes at 43 + 9 = 52 and 16,720 + 2,625 = 19,345.

## Look

The options do not change how anything looks.

## Decision

The owner's two rulings stand as given. Rewriting the range was rejected: it would risk more than
the rule protects, and the merge guard already reads each merge's own changes. The ruling was given
on <!-- outside date -->15 November 2026.

## Consequences

`commitlint.config.mjs` ignores a subject that starts `merge(`. `tools/hooks/check-merges.ts` names
the forty-three in `KNOWN_MERGES` with each merge's comment, and its set test counts 52. The
decision records the rulings so the code's comments point here rather than carrying a date.
