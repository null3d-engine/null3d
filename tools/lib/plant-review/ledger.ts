// The ledger of the plant review: the species by row table and its total, read from verdict files
// in their run folders and from nothing else. Every count that a report quotes comes from here, so
// a count can always be rebuilt from the files it names. The total's base never moves: the twenty
// species of the standard times its twelve rows, and a species with no verdict counts as none of
// twelve. A pass is counted only with what makes it a reviewer's reading of a sound run: a clean
// and complete run, its manifest, the pictures it names, and a review file that names the row.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
	type Balance,
	ROW_NAMES,
	type RowVerdict,
	VERDICT_FILE,
	type Verdict,
	type VerdictRow,
	verdictFaults,
} from './verdict.ts';

/** The twenty species the standard judges, which fix the total's base. */
export const REVIEW_SPECIES = [
	'bamboo',
	'bracken',
	'common-alder',
	'common-ash',
	'date-palm',
	'european-beech',
	'giant-sequoia',
	'hawthorn-shrub',
	'holm-oak',
	'hosta',
	'italian-cypress',
	'meadow-grass',
	'olive',
	'pedunculate-oak',
	'saguaro',
	'scots-pine',
	'sedge',
	'silver-birch',
	'tree-fern',
	'weeping-willow',
] as const;

/** One species' line of the ledger. */
export interface LedgerLine {
	readonly species: string;
	/** The run and commit its rows were read at, or null for a species with no verdict. */
	readonly run: string | null;
	readonly commit: string | null;
	readonly path: string | null;
	readonly coverage: boolean;
	/** The pictures drawn and not measured, which the eye judges and which pass no row alone. */
	readonly drawn: readonly string[];
	readonly balance: RowVerdict;
	readonly rows: readonly RowVerdict[];
	readonly passes: number;
	/** Whether the species is done: twelve passes, the balance passed and every reference compared. */
	readonly complete: boolean;
	/** The pictures out of each row: not compared, void, set aside, lacking their part, or not checked. */
	readonly taken: readonly {
		readonly row: number;
		readonly notCompared: number;
		readonly voided: number;
		readonly setAside: number;
		readonly lacking: number;
		readonly unchecked: number;
	}[];
}

/** The ledger of a set of verdict files. */
export interface Ledger {
	readonly species: readonly LedgerLine[];
	/** The rows of every species together, by verdict. */
	readonly totals: Readonly<Record<RowVerdict, number>>;
	/** The total's base: the standard's species times its rows. */
	readonly rows: number;
	/** How many species are done. */
	readonly complete: number;
	/** What stops the count, one line each; none when the ledger is sound. */
	readonly faults: readonly string[];
}

/**
 * The verdict files a path names: the verdict of a run folder, or of every run folder directly
 * inside a folder. A verdict lives in its run folder beside the manifest and the pictures it is
 * checked against, so a file anywhere else is named as a fault and not read.
 */
export function verdictPaths(path: string): { readonly found: string[]; readonly stray: string[] } {
	if (!existsSync(path)) throw new Error(`${path} does not exist.`);
	if (statSync(path).isFile())
		return basename(path) === VERDICT_FILE
			? { found: [path], stray: [] }
			: { found: [], stray: [path] };
	const own = join(path, VERDICT_FILE);
	if (existsSync(own)) return { found: [own], stray: [] };
	const found: string[] = [];
	const stray: string[] = [];
	for (const name of readdirSync(path).sort()) {
		const entry = join(path, name);
		if (statSync(entry).isDirectory()) {
			const inside = join(entry, VERDICT_FILE);
			if (existsSync(inside)) found.push(inside);
		} else if (name.endsWith('.json')) stray.push(entry);
	}
	return { found, stray };
}

/** A commit's full name: forty hexadecimal digits, and not all zero. */
function realCommit(commit: string): boolean {
	return /^[0-9a-f]{40}$/.test(commit) && !/^0+$/.test(commit);
}

/**
 * What a verdict's run folder says against it: no manifest, a manifest of another run, commit or
 * species, a commit that is no commit, or a picture the verdict names that the folder lacks.
 */
function folderFaults(path: string, verdict: Verdict): string[] {
	const folder = dirname(path);
	const faults: string[] = [];
	const manifestPath = join(folder, 'manifest.json');
	if (!existsSync(manifestPath)) faults.push('its run folder holds no manifest');
	else {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
			run?: string;
			commit?: string;
			species?: string;
			dirty?: boolean;
		};
		for (const field of ['run', 'commit', 'species'] as const)
			if (manifest[field] !== verdict[field])
				faults.push(
					`it names the ${field} ${verdict[field]}, and the manifest beside it names ${String(manifest[field])}`,
				);
		if (manifest.dirty !== verdict.dirty)
			faults.push('it and the manifest beside it disagree about whether the run drew a clean tree');
	}
	if (!realCommit(verdict.commit))
		faults.push(`its commit ${verdict.commit} is no commit's full name`);
	const pictures = new Set([
		...verdict.rows.flatMap((row) => row.evidence),
		...verdict.balance.evidence,
	]);
	for (const picture of pictures)
		if (!existsSync(join(folder, picture)))
			faults.push(`it names the picture ${picture}, which its run folder lacks`);
	return faults;
}

/**
 * What a pass lacks of a sound run and a reviewer's reading: a clean tree, every reference
 * compared, and a review file that exists and names the row.
 */
function passFaults(
	path: string,
	verdict: Verdict,
	entry: VerdictRow | Balance,
	at: string,
	names: readonly RegExp[],
): string[] {
	if (entry.verdict !== 'pass') return [];
	const faults: string[] = [];
	if (verdict.dirty) faults.push(`${at} passes on a run drawn from a tree with changes`);
	if (!verdict.coverage.complete)
		faults.push(
			`${at} passes though the run compared ${verdict.coverage.compared} of ${verdict.coverage.inUse} reference files`,
		);
	const file = entry.review?.file;
	if (file) {
		const review = isAbsolute(file) ? file : join(dirname(path), file);
		if (!existsSync(review))
			faults.push(`${at} names the review file ${file}, which does not exist`);
		else {
			const text = readFileSync(review, 'utf8');
			if (!names.some((name) => name.test(text)))
				faults.push(`${at} names the review file ${file}, which does not name it`);
		}
	}
	return faults;
}

/** The ledger of the verdict files that some paths name, over the standard's twenty species. */
export function ledgerOf(paths: readonly string[]): Ledger {
	const faults: string[] = [];
	const bySpecies = new Map<string, { readonly path: string; readonly verdict: Verdict }[]>();
	for (const given of paths) {
		const { found, stray } = verdictPaths(given);
		for (const path of stray)
			faults.push(
				`${path}: a verdict is read only as ${VERDICT_FILE} in its run folder, where its manifest and pictures check it`,
			);
		for (const path of found) {
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
			const run = [
				...folderFaults(path, verdict),
				...verdict.rows.flatMap((row) =>
					passFaults(path, verdict, row, `row ${row.row}`, [
						new RegExp(`\\brow ${row.row}\\b`, 'i'),
					]),
				),
				...passFaults(path, verdict, verdict.balance, 'the balance', [/\bbalance\b/i]),
			];
			faults.push(...run.map((fault) => `${path}: ${fault}`));
			const list = bySpecies.get(verdict.species) ?? [];
			list.push({ path, verdict });
			bySpecies.set(verdict.species, list);
		}
	}
	for (const [species, list] of bySpecies) {
		if (list.length > 1)
			faults.push(
				`${species} has ${list.length} verdict files, so its rows would count more than once: ${list.map((entry) => entry.path).join(', ')}`,
			);
		if (!(REVIEW_SPECIES as readonly string[]).includes(species))
			faults.push(`${species} is not one of the standard's twenty species`);
	}
	const totals: Record<RowVerdict, number> = { pass: 0, fail: 0, void: 0, unjudged: 0 };
	const species = REVIEW_SPECIES.map((name): LedgerLine => {
		const entry = bySpecies.get(name)?.[0];
		if (!entry) {
			totals.unjudged += ROW_NAMES.length;
			return {
				species: name,
				run: null,
				commit: null,
				path: null,
				coverage: false,
				drawn: [],
				balance: 'unjudged',
				rows: ROW_NAMES.map(() => 'unjudged'),
				passes: 0,
				complete: false,
				taken: [],
			};
		}
		const { path, verdict } = entry;
		const ordered = ROW_NAMES.map(
			(_, index) => verdict.rows.find((row) => row.row === index + 1) as VerdictRow,
		);
		const rows = ordered.map((row) => row.verdict);
		for (const row of rows) totals[row]++;
		const passes = rows.filter((row) => row === 'pass').length;
		return {
			species: name,
			run: verdict.run,
			commit: verdict.commit,
			path,
			coverage: verdict.coverage.complete,
			drawn: verdict.coverage.drawn ?? [],
			balance: verdict.balance.verdict,
			rows,
			passes,
			complete:
				passes === ROW_NAMES.length &&
				verdict.balance.verdict === 'pass' &&
				verdict.coverage.complete,
			taken: ordered
				.map((row) => ({
					row: row.row,
					notCompared: row.notCompared?.length ?? 0,
					voided: row.voids?.length ?? 0,
					setAside: row.setAside?.length ?? 0,
					lacking: row.lacking?.length ?? 0,
					unchecked: row.unchecked?.length ?? 0,
				}))
				.filter(
					(row) => row.notCompared + row.voided + row.setAside + row.lacking + row.unchecked > 0,
				),
		};
	});
	return {
		species,
		totals,
		rows: REVIEW_SPECIES.length * ROW_NAMES.length,
		complete: species.filter((line) => line.complete).length,
		faults,
	};
}

/** The letter a verdict takes in the table. */
const LETTER: Readonly<Record<RowVerdict, string>> = {
	pass: 'P',
	fail: 'F',
	void: 'V',
	unjudged: '-',
};

/**
 * The ledger as text: a line per species with its twelve rows, its balance, its passes, whether
 * its run compared every reference, and the run and commit the rows were read at; under it, the
 * pictures taken out of its rows; then the total over the standard's twenty species. A ledger with
 * faults prints them and no total.
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
	const lines = [`${'species'.padEnd(wide)}  ${numbers}  bal  pass  coverage  run at commit`];
	for (const line of ledger.species) {
		lines.push(
			`${line.species.padEnd(wide)}  ${line.rows.map((row) => LETTER[row].padStart(2)).join(' ')}  ${LETTER[line.balance].padStart(3)}  ${String(line.passes).padStart(4)}  ${(line.run === null ? '-' : line.coverage ? 'complete' : 'short').padEnd(8)}  ${line.run === null ? 'no verdict' : `${line.run} at ${(line.commit ?? '').slice(0, 9)}`}`,
		);
		const taken = line.taken.map((row) => {
			const parts = [
				row.notCompared > 0 ? `${row.notCompared} not compared` : '',
				row.voided > 0 ? `${row.voided} void` : '',
				row.lacking > 0 ? `${row.lacking} of a part the plant lacks` : '',
				row.setAside > 0 ? `${row.setAside} set aside` : '',
				row.unchecked > 0 ? `${row.unchecked} with no subject check` : '',
			].filter(Boolean);
			return `row ${row.row}: ${parts.join(', ')}`;
		});
		if (taken.length > 0)
			lines.push(`${''.padEnd(wide)}  pictures out of the rows: ${taken.join('; ')}`);
		if (line.drawn.length > 0)
			lines.push(
				`${''.padEnd(wide)}  ${line.drawn.length} drawn and not measured, for the eye: ${line.drawn.join(', ')}`,
			);
	}
	lines.push(
		'',
		'P pass, F fail, V void (the camera did not frame a part the plant has), - unjudged. bal is the balance through eight angles.',
		`Total: ${ledger.totals.pass} of ${ledger.rows} rows pass; ${ledger.totals.fail} fail, ${ledger.totals.void} void, ${ledger.totals.unjudged} unjudged. ${ledger.complete} of ${ledger.species.length} species are done.`,
		'',
	);
	return lines.join('\n');
}
