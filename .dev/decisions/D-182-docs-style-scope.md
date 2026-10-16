# D-182: The style check skips the dated records

Status: decided. The owner ruled on 16 October 2026, in answer to the question "run a repair pass over the text, or narrow the check to the pages people actually read?". The code and this record changed the same day. Task: docs review finding DOC-37 of 15 October 2026.

Summary: `bun run docs:style` read every Markdown file under `.dev/`, so 1,183 of its 1,659 warnings (71%) came from the dated records: 924 in `.dev/decisions/` and 259 in `.dev/tested-devices/`. The check now reads only the pages a reader acts on today, which are `docs/`, `skills/`, the README, AGENTS.md, the package READMEs, the changelog and the current guides directly in `.dev/`.

## Question

Should the maintainers repair 1,659 writing warnings, most of them in the dated records, or should the check guard only the pages that a reader acts on today?

## Rule

The writing rules apply to the text a maintainer writes now. A dated record holds what was decided or measured on a day, so editing it to pass a rule added later would falsify it. The check therefore reads the files a reader acts on, and it names every file it leaves out.

## Data

`bun run docs:style` on `origin/main` at `55cf1e5af`, 16 October 2026, before any change. 1,659 warnings in all.

| Where | Warnings | Share | After the change | In scope |
| --- | ---: | ---: | ---: | --- |
| `.dev/decisions/` | 924 | 56% | 0 | no, a dated decision record |
| `.dev/`, the current guides | 306 | 18% | 306 | yes |
| `.dev/tested-devices/` | 259 | 16% | 0 | no, a dated run record |
| `docs/` | 135 | 8% | 135 | yes |
| `skills/` | 20 | 1% | 20 | yes |
| README, AGENTS.md and the changelog | 13 | 1% | 13 | yes |
| `packages/*/README.md` | 2 | 0% | 2 | yes |
| All | 1,659 | | 476 | |

By rule, those 1,659 warnings were 1,574 long sentences, 81 British spellings and 4 title-case headings. The dated records held 59 of the British spellings. On 15 October the guard of DOC-37 demoted them to warnings, because a record of a past day cannot be edited to pass a check.

After the change the same command reports 476 warnings, none of them in a dated record. The current guides in `.dev/` hold 306 of the 476, which makes them the largest group left. The owner keeps them in scope, because a maintainer edits them today.

How the data was produced: `bun run docs:style` before and after the change, with its output grouped by directory and by rule. No text was rewritten.

## Decision

Narrow the check. It reads the pages under `docs/` and `skills/`, the README, AGENTS.md, the package READMEs, the changelog and the current guides directly in `.dev/`. It reads no file under `.dev/decisions/` or `.dev/tested-devices/`. The findings stay warnings: they print and never block, as DOC-37 decided.

## Consequences

- The list of files the check reads over the whole tree (`styleCheckedFiles`) and its test for one path (`isStyleChecked`) share one named predicate, `isCurrentGuide`. It accepts Markdown directly in `.dev/` and nothing below it, so a new folder under `.dev/` stays out of scope until someone adds it on purpose.
- A new decision record and a new device run go unchecked by the machine. The writing rules still apply to them, and the maintainer's own reading and the humanizer pass are what hold them.
- The link check still reads the records, so a broken link in one is still caught. The command-table check in AGENTS.md reads them too.
- `bun run docs:check` still refuses a record without a title, a status or a summary. No other check changed.
