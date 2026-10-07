# Decision records

A decision record settles one design question with measured data. It states the question and the rule that decides it, then the data, the choice and what the choice changes. Write one when a design choice depends on measurements, such as a default or a pick between two designs.

## Find a record

`bun run decisions` lists every record in number order: its title and file, then its status and summary. The command reads them from the records in this folder at each run: the title from the first line, then the `Status:` and `Summary:` paragraphs. No file keeps a copy of the list. Search that list for a topic, or search this folder. Each file name starts with the record's number, such as `D-07-job-workers.md`. Some numbers have no record yet.

## Write a record

1. Take the next free number, and check that no open pull request uses it.
2. Copy [TEMPLATE.md](TEMPLATE.md) to `D-<number>-<short-name>.md`, with the short name in lowercase words joined by hyphens.
3. Start with the line `# D-<number>: <title>`. Under it, write a `Status:` paragraph and a `Summary:` paragraph. The status says what is decided and what is pending, with dates. The summary gives the choice and its main figures in one to three sentences.
4. When the record changes, keep its status and summary current.

No file lists the records by hand, so a pull request that adds a record changes no file that other pull requests change. [D-84](D-84-generated-decision-list.md) gives the reasons. `bun run docs:check` and the commit hook refuse a record without its title, status or summary, and two records with one number.
