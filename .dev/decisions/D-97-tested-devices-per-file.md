# D-97: The record of tested devices, one file per run

Status: decided and built. The owner asked for the split and chose option C.

Summary: Each device and browser has a folder in `.dev/tested-devices/`, with a README for its facts and known issues and one file per run. The page `.dev/tested-devices.md` holds a table of the facts and issues that `bun run docs` makes from the READMEs, and `bun run devices:record` prints every run's results. A single shared table took an edit from 29 of 143 commits on main in five days, and from 4 of 6 open pull requests.

## Question

Take a record kept as one Markdown table, with one line for each device and browser. Each run adds its plan and result to the cells of that line. The lines grow to 8,544 characters. Two branches that record runs on one device edit the same line, and the second to land clashes. Branches that record runs on different devices edit lines next to each other, and they clash too. How does the record keep every run without a line that every such branch edits?

## Rule

Recording a run adds a file and edits no line that another branch edits. Every fact, result and issue of the single table survives, word for word. The page that people read stays current with no step after the merge, and the docs check fails when it is stale.

## Data

| Measure | Count |
| --- | --- |
| Commits on main from 2026-10-03 to 2026-10-07 | 143 |
| Of those, commits that edited the table | 29 |
| Open pull requests on 2026-10-07 | 6 |
| Of those, pull requests that edit the table | 4 (#346, #373, #384, #387) |
| Rows of the table | 40 |
| The longest line | 8,544 characters, the Galaxy S25 in Chrome |

How the data was produced: `git log --oneline --since=2026-10-03 origin/main -- .dev/tested-devices.md` against the same count without the path, and `gh pr list` with each pull request's files.

## Options

| Option | Edits a shared line per run | The page shows each run's results | Cost |
| --- | --- | --- | --- |
| A. A file per device and browser, with each run appended at its end, and a generated page with every result | Yes: two runs on one device append at the same place of its file, and both change the same cell of the page | Yes | The same clashes, moved into smaller files |
| B. As A, with git's `union` merge driver on the files | No, on a local merge | Yes | The generated page still clashes, and GitHub's merges do not run merge drivers ([D-84](D-84-generated-decision-list.md)) |
| C. A file per run in a folder per device and browser. The generated page holds the facts and the known issues, and a command prints every result | No: a run is a new file, and the page changes only for a new device, a new fact or a new issue | No: each row links to its folder of runs, and `bun run devices:record` prints the full table | A reader opens the folder, or runs the command, to see the results |

Option A's generated page would hold each row's results. So two branches that record runs on the iPad would still edit one line of it. Any page that each run changes clashes in the same way, for example a page with the date of the latest run.

## Decision

Option C, the only option that meets the rule. The owner chose it for two reasons. [D-84](D-84-generated-decision-list.md) takes the list of decision records out of git for the same kind of clash. Run files that are only ever added cannot clash. The page keeps every fact and known issue of the single table. It has a table for each kind of place: the owner's devices, the device clouds and CI's machines. Each row links to its folder. There GitHub shows the run files by date, with the README below them.

Each folder's first run file, `<first date>-earlier-runs.md`, holds the plans and results that its row of the single table held. No rule can split those cells into runs. `bun tools/tested-devices.ts --from-table` writes these files from a table. A check printed the full record from the files and compared it with the table. All 40 rows and all 360 cells matched, 62,633 characters.

GitHub shows nothing after a table row's last cell. One row, Safari on the Mac with the 3440 x 1440 screen, held its results there (#366). Its run file keeps that text in the plans and the result, in order, with no character lost.

## Consequences

- A run is a file, `<run name>.md`, in its folder. It has a `Plans:` paragraph, then the `Result:`, which runs to the end of the file. The device runner prints it, with the folder where it goes, or with a new folder's README when none fits. The runner also prints an OS, a browser or GPU paths that the folder's README lacks, such as a new browser version.
- A folder's README holds a title, the six facts as a list, and a "Known issues" section with one paragraph per issue. Links in these files are relative to the file, and the page's tables move them to the page's folder.
- `bun run docs` writes the tables between markers on the page. The commit hook and `bun run docs:check` fail when the page is stale. They also refuse a folder without a README or a run, and a README without its facts or its issues section. They refuse a run file without its date, plans or result too.
- The writing check covers the files as maintainer guides. Long sentences in the runs from the single table show as warnings, which do not block.
- The README and the user docs will need a list of tested devices. They can build it from the same files: `readRecord()` in `tools/lib/tested-devices.ts` reads each folder's facts, known issues and runs. A generator for those pages can pick what it shows from there, so it needs no copy of the record.
- [Tested devices](../tested-devices.md), [Device sessions](../devices.md), [Releases](../releases.md) and [AGENTS.md](../../AGENTS.md) say to add a run file.
