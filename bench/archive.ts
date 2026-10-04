// Keeps a small record of each benchmark run in the repository, so its figures outlive the machine
// that ran it. A run folder holds every page's full result, with frames and images; its record in
// bench/results/<run>.json keeps the plan's pages, each runner's device and browser, each page's
// medians, each run's figures and the commit that ran them. Then it prints the run's rows for the
// results page in .dev/benchmark-results.md. From the repository root:
//   bun run bench:archive target/runs/20261004-125547-bench   one run folder, or several
//   bun run bench:archive 20261004-125547-bench               a run's name, in this checkout's target folder
//   bun run bench:archive --rows                              every record's rows, by table
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../tests/lib/server.ts';
import {
	ARCHIVE_DIR,
	type ArchiveRecord,
	archiveFolder,
	type Host,
	NoResultsError,
	RESULT_COLUMNS,
	type ResultRow,
	resultRows,
	rowLine,
} from './lib/archive';

const USAGE = 'usage: bun run bench:archive <run folder or run name>... | --rows [<run name>...]';

/** The folders of this checkout where the tools write their runs. */
const RUN_FOLDERS = ['target/runs', 'target/bench', 'target/gate'];

/** A run folder from a path, or from a run's name in this checkout's folders of runs. */
function findFolder(arg: string): string {
	if (existsSync(arg)) return resolve(arg);
	for (const folder of RUN_FOLDERS) {
		const path = join(REPO_ROOT, folder, arg);
		if (existsSync(path)) return path;
	}
	throw new Error(`${arg}: no such run folder here, or in ${RUN_FOLDERS.join(', ')}`);
}

/** This machine, for the runs that a tool ran here in Playwright. */
function thisHost(): Host {
	const cores = cpus();
	const memoryGB = Math.round(totalmem() / 2 ** 30);
	return { name: `${cores[0]?.model ?? 'unknown'}, ${cores.length} cores, ${memoryGB} GB` };
}

/** The rows of records as Markdown tables, one table for each scene, oldest row first. */
function rowTables(rows: readonly ResultRow[]): string {
	const tables = new Map<string, ResultRow[]>();
	for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date)))
		tables.set(row.table, [...(tables.get(row.table) ?? []), row]);
	const header = [rowLine([...RESULT_COLUMNS]), rowLine(RESULT_COLUMNS.map(() => '---'))];
	return [...tables]
		.map(([table, list]) =>
			[`${table}:`, ...header, ...list.map((row) => rowLine(row.cells))].join('\n'),
		)
		.join('\n\n');
}

function readRecord(path: string): ArchiveRecord {
	return JSON.parse(readFileSync(path, 'utf8')) as ArchiveRecord;
}

function main(): void {
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		options: { rows: { type: 'boolean', default: false } },
		allowPositionals: true,
	});
	if (values.rows) {
		const names =
			positionals.length > 0
				? positionals.map((name) => `${name}.json`)
				: existsSync(ARCHIVE_DIR)
					? readdirSync(ARCHIVE_DIR).filter((name) => name.endsWith('.json'))
					: [];
		console.log(
			rowTables(names.flatMap((name) => resultRows(readRecord(join(ARCHIVE_DIR, name))))),
		);
		return;
	}
	if (positionals.length === 0) throw new Error(USAGE);
	const host = thisHost();
	mkdirSync(ARCHIVE_DIR, { recursive: true });
	for (const arg of positionals) {
		let record: ArchiveRecord;
		try {
			record = archiveFolder(findFolder(arg), host);
		} catch (e) {
			// One folder that cannot be read stops no other; the command fails at the end.
			if (e instanceof NoResultsError) console.log(`skip  ${e.message}`);
			else {
				console.error(`error ${arg}: ${(e as Error).message}`);
				process.exitCode = 1;
			}
			continue;
		}
		const file = join(ARCHIVE_DIR, `${record.run}.json`);
		const text = `${JSON.stringify(record)}\n`;
		writeFileSync(file, text);
		console.log(`saved ${relative(REPO_ROOT, file)}: ${(text.length / 1024).toFixed(1)} KB`);
		const rows = resultRows(record);
		if (rows.length > 0) console.log(`\n${rowTables(rows)}\n`);
	}
}

if (import.meta.main) {
	try {
		main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
