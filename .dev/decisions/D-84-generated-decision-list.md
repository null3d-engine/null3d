# D-84: The list of decision records, made from the records

Status: decided. Date: 2026-10-06.

Summary: Each record holds its own status and summary, and `bun run decisions` prints the list from them, so no committed file lists the records. Before, 53 of main's 120 commits since 2026-10-03 edited the shared list, and 4 of 8 open pull requests on 2026-10-06 did. The docs check and the commit hook refuse a record without a title, status or summary, and two records with one number.

## Question

The README in this folder held a table with one row for each record: its title, status and summary. Each pull request that added a record, or changed a record's status, edited that table. Pull requests that edit the same lines conflict, and the merge queue removes a pull request that conflicts with main. How does the list stay available without a file that every such pull request edits?

## Rule

A pull request that adds a record or changes its status edits no file that other pull requests edit. The list stays complete and current with no step after the merge. The change adds no work to the merge queue.

## Data

| Measure | Count |
| --- | --- |
| Commits on main from 2026-10-03 to 2026-10-06 | 120 |
| Of those, commits that edited the table | 53 |
| Open pull requests on 2026-10-06 | 8 |
| Of those, pull requests that edit the table | 4 (#340, #343, #344, #346) |

How the data was produced: `git log --oneline --since=2026-10-03 origin/main -- .dev/decisions/README.md` against the same count without the path, and `gh pr list` with each pull request's files, on 2026-10-06.

## Options

| Option | Edits a shared file | Current after each merge | Cost |
| --- | --- | --- | --- |
| A. Keep the table, and make a script write it. The docs check fails when the table is stale | Yes: each new record still adds a row in the same place | Yes | The same conflicts, with a generator to resolve them |
| B. Keep the table, and let a CI job on main write it after each merge | No | No: the table lags until the job's commit lands | The job needs a token that may push to main past the merge queue. Each of its commits changes main, so the queue tests its waiting pull requests again. Each commit adds a line to the changelog |
| C. Take the table out. Each record holds a `Summary:` paragraph beside its `Status:` paragraph, and a command prints the list from the records | No | Yes: the list is read from the files at each run | GitHub's view of the folder shows file names, not summaries |

A merge driver that keeps both sides, such as git's `union`, was not chosen. GitHub's merges do not run merge drivers, and two pull requests that change one row would keep both versions.

## Decision

Option C, the only option that meets all three parts of the rule. A reader on GitHub sees the records by file name, and each record opens with its status and summary.

The table's statuses were short forms of each record's `Status:` paragraph. The list now prints the paragraph itself. Four tables said more than their record: D-10's build date, D-13's addenda, D-30's input checks and D-33's vignette ruling. Those four records' status paragraphs now say it.

## Consequences

- Each record has a `Summary:` paragraph under its status, which holds what the table's summary column held. [TEMPLATE.md](TEMPLATE.md) has it too.
- `bun run decisions` prints the list. `bun tools/decisions.ts --check` runs in `bun run docs:check` and in the commit hook. It refuses a file name without a number, and a title line whose number differs from the file name. It also refuses a record without a status or a summary, and two records with one number.
- A pull request that adds a record changes no shared file. Two pull requests that take one number still merge without a conflict, so the check catches the clash on the queue's combined tree.
- [The README](README.md) and [Pull requests and parallel work](../pull-requests.md#merge-main-into-a-branch) say how to write a record and how to find one.
