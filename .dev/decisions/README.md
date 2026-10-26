# Decision records

A decision record settles one design question with measured data. It states the question and the rule that decides it, then the data, the choice and what the choice changes. Write one when a design choice depends on measurements, such as a default or a pick between two designs.

## Find a record

`bun run decisions` lists every record in number order: its title and file, then its status and summary. The command reads them from the records in this folder at each run: the title from the first line, then the `Status:` and `Summary:` paragraphs. No file keeps a copy of the list. Search that list for a topic, or search this folder. Each file name starts with the record's number, such as `D-07-job-workers.md`. Some numbers have no record yet.

## Write a record

1. Take the next free number, and check that no remote branch uses it: `git fetch`, then `git grep -l 'D-<number>' $(git for-each-ref --format='%(refname)' refs/remotes/origin) -- .dev/decisions`. Two branches can still take one number, and the docs check then refuses the second when it merges main.
2. Copy [TEMPLATE.md](TEMPLATE.md) to `D-<number>-<short-name>.md`, with the short name in lowercase words joined by hyphens.
3. Start with the line `# D-<number>: <title>`. Under it, write a `Status:` paragraph and a `Summary:` paragraph. The status says what is decided and what is pending, with dates. The summary gives the choice and its main figures in one to three sentences.
4. Where the options differ in how the result looks, the `## Look` section says which looks better, and the decision takes that one ([hard rule 40](../../AGENTS.md#hard-rules)). Effort and schedule are no reason to take the worse look. Another hard rule may limit a cost, such as frame time. A quality preset or a cheaper technique of the same look then meets it, and the section says how. A record whose options look the same says so in one line.
5. When the record changes, keep its status and summary current.
6. Quote each figure as its own log or report gives it, and name its run: the command, the threads,
   the load, the method and the commit. Say what else ran beside it. Never compare two figures that
   two methods measured. On 26 October 2026, readers refused four revisions of one record for
   figures that claimed more than their runs showed.

No file lists the records by hand, so a pull request that adds a record changes no file that other pull requests change. [D-84](D-84-generated-decision-list.md) gives the reasons. `bun run docs:check` and the commit hook refuse a record without its title, status or summary, and two records with one number.
