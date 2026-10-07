// The record of tested devices. Run from the repository root:
//   bun tools/tested-devices.ts                     print every row with all its runs' plans and
//                                                   results, as one table
//   bun tools/tested-devices.ts --branch <commit>   write the record's files for what a branch
//                                                   added to the old single table: its rows'
//                                                   new runs, new rows, new facts and issues.
//                                                   <commit> is the branch's last commit before
//                                                   it merged the change that split the table.
//                                                   --base <commit> names where it started, by
//                                                   default its merge base with origin/main
//   bun tools/tested-devices.ts --from-table <file> write a folder for each row of a page in
//                                                   the old single table's format
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	branchEntries,
	factsOf,
	folderName,
	fullRecord,
	RECORD_PAGE,
	readRecord,
	recordFiles,
	rowFiles,
	tableRows,
} from './lib/tested-devices';

const root = process.cwd();
const args = process.argv.slice(2);
const option = (name: string) => {
	const at = args.indexOf(name);
	return at === -1 ? undefined : args[at + 1];
};
const git = (...gitArgs: string[]) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' });

function write(files: ReadonlyMap<string, string>): void {
	for (const [path, text] of files) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
		console.log(`wrote ${path}`);
	}
}

const branch = option('--branch');
const table = option('--from-table');
if (branch) {
	const base = option('--base') ?? git('merge-base', branch, 'origin/main').trim();
	const before = git('show', `${base}:${RECORD_PAGE}`);
	const after = git('show', `${branch}:${RECORD_PAGE}`);
	if (tableRows(before).length === 0 || tableRows(after).length === 0) {
		console.error(`error: ${RECORD_PAGE} at ${base} or ${branch} holds no table in the old format`);
		process.exit(1);
	}
	const { writes, notes } = branchEntries(before, after, recordFiles(root));
	write(writes);
	for (const note of notes) console.log(`note: ${note}`);
	console.log(`${writes.size} file(s) written. Run bun run docs, then read the new files.`);
} else if (table) {
	const rows = tableRows(readFileSync(table, 'utf8'));
	// Rows that would share a folder name each take their browser's major version.
	const names = rows.map((cells) => folderName(factsOf(cells), new Set()));
	const taken = new Set(names.filter((name, i) => names.indexOf(name) !== i));
	const split = new Date().toISOString().slice(0, 10).replaceAll('-', '');
	for (const cells of rows) {
		const dates = (cells[6] ?? '').match(/\d{4}-\d{2}-\d{2}/g)?.sort() ?? [];
		const first = dates[0]?.replaceAll('-', '') ?? split;
		const files = rowFiles(cells, `${first}-earlier-runs`, taken);
		taken.add(
			dirname([...files.keys()][0] as string)
				.split('/')
				.pop() as string,
		);
		write(files);
	}
} else {
	const { rows, problems } = readRecord(recordFiles(root));
	console.log(fullRecord(rows));
	for (const p of problems) console.error(`error: ${p}`);
	if (problems.length) process.exit(1);
}
