// The ledger of the plant review: the species by row table and its total, read from a folder of
// verdict files and from nothing else. Every count that a report quotes comes from here, so a count
// can always be rebuilt from the files it names. A verdict that is unsound, a species named twice
// or a verdict whose run folder disagrees with it stops the count rather than entering it.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
	ROW_NAMES,
	type RowVerdict,
	VERDICT_FILE,
	type Verdict,
	type VerdictRow,
	verdictFaults,
} from './verdict.ts';

/** One verdict file and what it holds. */
export interface LedgerEntry {
	readonly path: string;
	readonly verdict: Verdict;
}

/** The ledger of a set of verdict files. */
export interface Ledger {
	/** One line per species, in name order: its twelve row verdicts in order. */
	readonly species: readonly {
		readonly species: string;
		readonly run: string;
		readonly commit: string;
		readonly path: string;
		readonly coverage: boolean;
		readonly rows: readonly RowVerdict[];
		readonly passes: number;
	}[];
	/** The rows of every species together, by verdict. */
	readonly totals: Readonly<Record<RowVerdict, number>>;
	/** How many rows the species have between them. */
	readonly rows: number;
	/** What stops the count, one line each; none when the ledger is sound. */
	readonly faults: readonly string[];
}

/**
 * The verdict files a path names: the file itself, the verdict of a run folder, or every verdict
 * file and run folder directly inside a folder. A path that names none is a fault of the caller's.
 */
export function verdictPaths(path: string): string[] {
	if (!existsSync(path)) throw new Error(`${path} does not exist.`);
	if (statSync(path).isFile()) return [path];
	const own = join(path, VERDICT_FILE);
	if (existsSync(own)) return [own];
	const found: string[] = [];
	for (const name of readdirSync(path).sort()) {
		const entry = join(path, name);
		if (statSync(entry).isDirectory()) {
			const inside = join(entry, VERDICT_FILE);
			if (existsSync(inside)) found.push(inside);
		} else if (name.endsWith('.json')) found.push(entry);
	}
	return found;
}

/**
 * What a verdict's own run folder says against it: a manifest of another run, commit or species,
 * a folder of another name, or a picture the verdict names that the folder does not hold. Only a
 * verdict kept in its run folder is read this way, since a copy elsewhere has no pictures beside it.
 */
function folderFaults(path: string, verdict: Verdict): string[] {
	if (basename(path) !== VERDICT_FILE) return [];
	const folder = dirname(path);
	const faults: string[] = [];
	const manifestPath = join(folder, 'manifest.json');
	if (existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
			run?: string;
			commit?: string;
			species?: string;
		};
		for (const field of ['run', 'commit', 'species'] as const)
			if (manifest[field] !== verdict[field])
				faults.push(
					`it names the ${field} ${verdict[field]}, and the manifest beside it names ${String(manifest[field])}`,
				);
	} else if (basename(folder) !== verdict.run)
		faults.push(`it names the run ${verdict.run} and sits in the folder ${basename(folder)}`);
	for (const row of verdict.rows)
		for (const picture of row.evidence)
			if (!existsSync(join(folder, picture)))
				faults.push(`row ${row.row} names the picture ${picture}, which its run folder lacks`);
	return faults;
}

/**
 * The ledger of the verdict files that some paths name. With `expected`, a species of that list
 * with no verdict, and a verdict for a species outside it, are faults too.
 */
export function ledgerOf(paths: readonly string[], expected?: readonly string[]): Ledger {
	const faults: string[] = [];
	const entries: LedgerEntry[] = [];
	const files = paths.flatMap((path) => verdictPaths(path));
	if (files.length === 0) faults.push('no verdict file was found');
	for (const path of files) {
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(path, 'utf8'));
		} catch (error) {
			faults.push(`${path}: it is not JSON: ${(error as Error).message}`);
			continue;
		}
		const own = verdictFaults(value);
		if (own.length > 0) {
			faults.push(...own.map((fault) => `${path}: ${fault}`));
			continue;
		}
		const verdict = value as Verdict;
		faults.push(...folderFaults(path, verdict).map((fault) => `${path}: ${fault}`));
		entries.push({ path, verdict });
	}
	const bySpecies = new Map<string, LedgerEntry[]>();
	for (const entry of entries) {
		const list = bySpecies.get(entry.verdict.species) ?? [];
		list.push(entry);
		bySpecies.set(entry.verdict.species, list);
	}
	for (const [species, list] of bySpecies)
		if (list.length > 1)
			faults.push(
				`${species} has ${list.length} verdict files, so its rows would count more than once: ${list.map((entry) => entry.path).join(', ')}`,
			);
	if (expected) {
		for (const species of expected)
			if (!bySpecies.has(species)) faults.push(`${species} has no verdict file`);
		for (const species of bySpecies.keys())
			if (!expected.includes(species))
				faults.push(`${species} is not one of the species asked for`);
	}
	const totals: Record<RowVerdict, number> = { pass: 0, fail: 0, void: 0, unjudged: 0 };
	const species = [...bySpecies.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, list]) => {
			const { path, verdict } = list[0] as LedgerEntry;
			const rows = ROW_NAMES.map(
				(_, index) => (verdict.rows.find((row) => row.row === index + 1) as VerdictRow).verdict,
			);
			for (const row of rows) totals[row]++;
			return {
				species: name,
				run: verdict.run,
				commit: verdict.commit,
				path,
				coverage: verdict.coverage.complete,
				rows,
				passes: rows.filter((row) => row === 'pass').length,
			};
		});
	return { species, totals, rows: species.length * ROW_NAMES.length, faults };
}

/** The letter a row's verdict takes in the table. */
const LETTER: Readonly<Record<RowVerdict, string>> = {
	pass: 'P',
	fail: 'F',
	void: 'V',
	unjudged: '-',
};

/**
 * The ledger as text: a line per species with its twelve rows, its passes, whether its run
 * compared every reference, and the run and commit the rows were read at; then the total. A ledger
 * with faults prints them and no total.
 */
export function ledgerText(ledger: Ledger): string {
	if (ledger.faults.length > 0)
		return [
			`The ledger cannot be counted: ${ledger.faults.length} fault${ledger.faults.length === 1 ? '' : 's'}.`,
			...ledger.faults.map((fault) => `- ${fault}`),
			'',
		].join('\n');
	const wide = ledger.species.reduce((most, line) => Math.max(most, line.species.length), 7);
	const numbers = ROW_NAMES.map((_, index) => String(index + 1).padStart(2)).join(' ');
	const lines = [
		`${'species'.padEnd(wide)}  ${numbers}  pass  coverage  run at commit`,
		...ledger.species.map(
			(line) =>
				`${line.species.padEnd(wide)}  ${line.rows.map((row) => LETTER[row].padStart(2)).join(' ')}  ${String(line.passes).padStart(4)}  ${(line.coverage ? 'complete' : 'short').padEnd(8)}  ${line.run} at ${line.commit.slice(0, 9)}`,
		),
		'',
		`P pass, F fail, V void (a picture with no subject: a tool fault, not a judgement), - unjudged.`,
		`Total: ${ledger.totals.pass} of ${ledger.rows} rows pass over ${ledger.species.length} species; ${ledger.totals.fail} fail, ${ledger.totals.void} void, ${ledger.totals.unjudged} unjudged.`,
		'',
	];
	return lines.join('\n');
}
