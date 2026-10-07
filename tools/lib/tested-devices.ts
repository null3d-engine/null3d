// The record of tested devices. Each device and browser has a folder in `.dev/tested-devices/`:
// its README holds the facts and the known issues, and each other file holds one run. A run is a
// new file, so pull requests that record runs never edit the same lines. The page
// `.dev/tested-devices.md` holds a table of the facts and the known issues, made from the folders,
// and `bun run devices:record` prints every run's plans and results as well.
import { posix } from 'node:path';
import { readIfExists, walkFiles } from './files';

export const RECORD_DIR = '.dev/tested-devices';
export const RECORD_PAGE = '.dev/tested-devices.md';
/** The name of the generated part of the page, between its markers. */
export const RECORD_TABLE = 'tested-devices';

/** The facts of a device and browser, in the order of the README's list and the table's columns. */
export const FACTS = ['Device', 'OS', 'Browser', 'GPU', 'GPU paths', 'Where'] as const;
export type Facts = Record<(typeof FACTS)[number], string>;

/** The columns of the full record: the facts, then the runs' plans and results and the issues. */
export const FULL_COLUMNS = [...FACTS, 'Plans', 'Result', 'Known issues'] as const;

const ISSUES_HEADING = '## Known issues';
/** A folder's name: lowercase words joined by hyphens. */
const FOLDER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A run file's name: the run's date as eight digits, then lowercase words joined by hyphens. */
const RUN_NAME = /^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export interface Run {
	path: string;
	/** The plans that ran, with their dates and commits. */
	plans: string;
	result: string;
}

export interface DeviceRow {
	/** The folder's repository path. */
	folder: string;
	facts: Facts;
	/** The known issues, one paragraph each. */
	issues: string[];
	/** The runs, oldest first. */
	runs: Run[];
}

/** The text of the paragraph that starts with `label:`, joined onto one line, or '' when absent. */
function labelledParagraph(text: string, label: string): string {
	const match = text.match(new RegExp(`^${label}: (.+(?:\\n.+)*)`, 'm'));
	return match ? (match[1] as string).replace(/\s*\n\s*/g, ' ').trim() : '';
}

/** A Markdown block's paragraphs, each joined onto one line. */
const paragraphs = (text: string) =>
	text
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
		.filter(Boolean);

/**
 * Rewrites the relative links in `text`, written in a file in `fromDir`, so they resolve from a
 * file in `toDir`. Full URLs and links to a heading of the same file stay as they are.
 */
export function rebaseLinks(text: string, fromDir: string, toDir: string): string {
	if (fromDir === toDir) return text;
	return text.replace(/(\]\()([^()\s]+)(\))/g, (whole, open: string, target: string, close) => {
		if (/^[a-z]+:/.test(target) || target.startsWith('#')) return whole;
		const hash = target.indexOf('#');
		const path = hash === -1 ? target : target.slice(0, hash);
		const anchor = hash === -1 ? '' : target.slice(hash);
		const slash = path.endsWith('/') ? '/' : '';
		const moved = posix.relative(toDir, posix.normalize(posix.join(fromDir, path))) || '.';
		return `${open}${moved}${slash}${anchor}${close}`;
	});
}

/**
 * Text with each sentence on a line of its own, for a file that people read and diff. A break
 * goes only where one space follows a full stop outside brackets and code, so joining the lines
 * with a space gives the text back. `atSemicolons` breaks after semicolons too, for a list of
 * plans. No line starts with a Markdown marker.
 */
export function sentenceLines(text: string, atSemicolons = false): string {
	const startsSentence = /[A-Za-z0-9`]/y;
	const startsMarker = /(?:\d+[.)]|[-*+#>|])(?:\s|$)/y;
	const at = (pattern: RegExp, index: number) => {
		pattern.lastIndex = index;
		return pattern.test(text);
	};
	let out = '';
	let depth = 0;
	let code = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i] as string;
		if (char === '`') code = !code;
		else if (!code && (char === '(' || char === '[')) depth++;
		else if (!code && (char === ')' || char === ']')) depth = Math.max(0, depth - 1);
		const breaks =
			!code &&
			depth === 0 &&
			(char === '.' || (atSemicolons && char === ';')) &&
			text[i + 1] === ' ' &&
			at(startsSentence, i + 2) &&
			!at(startsMarker, i + 2);
		out += char;
		if (breaks) {
			out += '\n';
			i++;
		}
	}
	return out;
}

/** The README of a device and browser's folder: a title, the facts, and the known issues. */
export function readmeText(title: string, facts: Facts, issues: readonly string[]): string {
	const list = FACTS.map((fact) => `- ${fact}:${facts[fact] ? ` ${facts[fact]}` : ''}`);
	const issueText = issues.length
		? issues.map((issue) => sentenceLines(issue)).join('\n\n')
		: 'None recorded.';
	return `# ${title}\n\n${list.join('\n')}\n\n${ISSUES_HEADING}\n\n${issueText}\n`;
}

/** A run file: the plans that ran, then the result. */
export const runText = (plans: string, result: string) =>
	`Plans: ${sentenceLines(plans, true)}\n\nResult: ${sentenceLines(result)}\n`;

/**
 * The device's name: its facts up to the first comma outside brackets. It keeps notes in brackets,
 * such as a model number, but not a source's name, such as "BrowserStack's device list".
 */
function deviceName(device: string): string {
	let depth = 0;
	let end = device.length;
	for (let i = 0; i < device.length; i++) {
		const char = device[i];
		if (char === '(') depth++;
		else if (char === ')') depth--;
		else if (char === ',' && depth === 0) {
			end = i;
			break;
		}
	}
	return device.slice(0, end).replace(/\s*\([^)]*'s\b[^)]*\)/g, '');
}

/** The browser's name without its version or notes, such as "Chrome on iOS" or "Samsung Internet". */
export const browserName = (browser: string) => browser.match(/^[^\d,(.]*/)?.[0]?.trim() ?? '';

/** A folder's title, such as "Pixel 9 in Chrome". */
export const rowTitle = (facts: Facts) =>
	`${deviceName(facts.Device)} in ${browserName(facts.Browser) || 'an unknown browser'}`;

/**
 * A folder name for a device and browser that `taken` lacks, from the device's name and the
 * browser's. It adds the browser's major version when the name is taken.
 */
export function folderName(facts: Facts, taken: ReadonlySet<string>): string {
	const slug = `${deviceName(facts.Device)} ${browserName(facts.Browser)}`
		.replaceAll("'s", '')
		.replaceAll('+', ' plus')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const major = facts.Browser.match(/\d+/)?.[0];
	for (const name of [slug, major ? `${slug}-${major}` : slug]) if (!taken.has(name)) return name;
	let n = 2;
	while (taken.has(`${slug}-${n}`)) n++;
	return `${slug}-${n}`;
}

/** The record's files under `root`, as repository path to text. */
export function recordFiles(root: string): Map<string, string> {
	return new Map(
		walkFiles(root, RECORD_DIR, (p) => p.endsWith('.md')).map((path) => [
			path,
			readIfExists(root, path) ?? '',
		]),
	);
}

/** One README's facts and issues, and what keeps it from being read. */
function readReadme(
	path: string,
	text: string,
): { facts: Facts; issues: string[]; problems: string[] } {
	const problems: string[] = [];
	if (!/^# \S/.test(text))
		problems.push(`${path}: start the file with a title line, "# <device> in <browser>"`);
	const facts = {} as Facts;
	for (const fact of FACTS) {
		const match = text.match(new RegExp(`^- ${fact}:(?: (.*))?$`, 'm'));
		if (!match) problems.push(`${path}: add the line "- ${fact}: <text>", empty when nobody knows`);
		facts[fact] = match?.[1]?.trim() ?? '';
	}
	const at = text.indexOf(`\n${ISSUES_HEADING}\n`);
	if (at === -1)
		problems.push(
			`${path}: add a "${ISSUES_HEADING}" section, with "None recorded." when there are none`,
		);
	const issues = at === -1 ? [] : paragraphs(text.slice(at + ISSUES_HEADING.length + 2));
	return { facts, issues: issues.join(' ') === 'None recorded.' ? [] : issues, problems };
}

/**
 * The rows of the record among `files` (repository path to text), in the page's order, and every
 * problem that keeps a file out: a folder without a README, a name that breaks the rules, and a
 * README or run that lacks one of its parts.
 */
export function readRecord(files: ReadonlyMap<string, string>): {
	rows: DeviceRow[];
	problems: string[];
} {
	const problems: string[] = [];
	const folders = new Map<string, { readme?: string; runs: [string, string][] }>();
	for (const [path, text] of files) {
		const rel = posix.relative(RECORD_DIR, path).split('/');
		if (rel.length !== 2) {
			problems.push(`${path}: put each file in the folder of its device and browser`);
			continue;
		}
		const [folder, name] = rel as [string, string];
		if (!FOLDER_NAME.test(folder)) {
			problems.push(`${path}: name the folder in lowercase words joined by hyphens`);
			continue;
		}
		const entry = folders.get(folder) ?? { runs: [] };
		folders.set(folder, entry);
		if (name === 'README.md') entry.readme = text;
		else if (RUN_NAME.test(name)) entry.runs.push([path, text]);
		else
			problems.push(
				`${path}: name a run file <date as YYYYMMDD>-<plan>.md, in lowercase, such as the run's name`,
			);
	}
	const rows: DeviceRow[] = [];
	for (const [name, { readme, runs }] of folders) {
		const folder = posix.join(RECORD_DIR, name);
		if (readme === undefined) {
			problems.push(`${folder}: add a README.md with the device's facts and known issues`);
			continue;
		}
		const read = readReadme(posix.join(folder, 'README.md'), readme);
		problems.push(...read.problems);
		const row: DeviceRow = { folder, facts: read.facts, issues: read.issues, runs: [] };
		for (const [path, text] of runs.sort(([a], [b]) => a.localeCompare(b))) {
			const plans = labelledParagraph(text, 'Plans');
			const result = labelledParagraph(text, 'Result');
			if (!plans)
				problems.push(`${path}: add a "Plans:" paragraph: the plans that ran, with their dates`);
			if (!result) problems.push(`${path}: add a "Result:" paragraph under the plans`);
			row.runs.push({ path, plans, result });
		}
		if (row.runs.length === 0) problems.push(`${folder}: add a file for each run`);
		rows.push(row);
	}
	rows.sort(
		(a, b) =>
			GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)) || a.folder.localeCompare(b.folder),
	);
	return { rows, problems };
}

/** The page's sections, each for one kind of place where devices run. */
const GROUPS = ["The owner's devices", 'Device clouds', "CI's machines"] as const;

function groupOf({ facts }: DeviceRow): (typeof GROUPS)[number] {
	if (/\bowner's\b/i.test(facts.Where)) return GROUPS[0];
	if (/\bGitHub Actions\b/.test(facts.Where)) return GROUPS[2];
	return GROUPS[1];
}

/** A table cell's text, with the pipes that would end the cell escaped. */
const cell = (text: string) => text.replaceAll('|', '\\|');

/** A Markdown table row, with an empty cell left as one space. */
const tableRow = (cells: readonly string[]) =>
	`|${cells.map((text) => (text ? ` ${cell(text)} ` : ' ')).join('|')}|`;

const tableHead = (columns: readonly string[]) =>
	[`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`].join('\n');

/** A row's text, with its links rebased from the file that holds it onto the page's folder. */
const onPage = (text: string, from: string) =>
	rebaseLinks(text, posix.dirname(from), posix.dirname(RECORD_PAGE));

const factCells = (row: DeviceRow) =>
	FACTS.map((fact) => onPage(row.facts[fact], posix.join(row.folder, 'README.md')));

const issueCell = (row: DeviceRow) =>
	onPage(row.issues.join(' '), posix.join(row.folder, 'README.md'));

/** The page's generated part: a table of each group's devices, with links to their runs. */
export function recordTables(rows: readonly DeviceRow[]): string {
	const byGroup = Map.groupBy(rows, groupOf);
	return GROUPS.filter((group) => byGroup.has(group))
		.map((group) => {
			const lines = (byGroup.get(group) ?? []).map((row) =>
				tableRow([
					...factCells(row),
					issueCell(row),
					`[Runs](${posix.relative(posix.dirname(RECORD_PAGE), row.folder)}/)`,
				]),
			);
			return `### ${group}\n\n${tableHead([...FACTS, 'Known issues', 'Runs'])}\n${lines.join('\n')}`;
		})
		.join('\n\n');
}

/** The full record as one table, as on the page before the split: each row's plans and results joined. */
export function fullRecord(rows: readonly DeviceRow[]): string {
	const lines = rows.map((row) =>
		tableRow([
			...factCells(row),
			row.runs.map((run) => onPage(run.plans, run.path)).join('; '),
			row.runs.map((run) => onPage(run.result, run.path)).join(' '),
			issueCell(row),
		]),
	);
	return `${tableHead(FULL_COLUMNS)}\n${lines.join('\n')}`;
}

/** The cells of each row of the first table in `markdown` whose header names the full columns. */
export function tableRows(markdown: string): string[][] {
	const lines = markdown.split('\n');
	const head = lines.indexOf(tableHead(FULL_COLUMNS).split('\n')[0] as string);
	if (head === -1) return [];
	const rows: string[][] = [];
	for (const line of lines.slice(head + 2)) {
		if (!line.startsWith('|')) break;
		rows.push(
			line
				.slice(1, -1)
				.split(/(?<!\\)\|/)
				.map((text) => text.trim().replaceAll('\\|', '|')),
		);
	}
	return rows;
}

/** The facts among a full row's cells. */
export const factsOf = (cells: readonly string[]): Facts =>
	Object.fromEntries(FACTS.map((fact, i) => [fact, cells[i] ?? ''])) as Facts;

/**
 * The files of a new folder for one row of the full record: its README and one run file that
 * holds the row's plans and results. Links move from the page's folder into the new files'.
 */
export function rowFiles(
	cells: readonly string[],
	runName: string,
	taken: ReadonlySet<string>,
): Map<string, string> {
	const [plans = '', result = '', issues = ''] = cells.slice(FACTS.length);
	const pageDir = posix.dirname(RECORD_PAGE);
	const facts = factsOf(cells);
	const folder = posix.join(RECORD_DIR, folderName(facts, taken));
	const move = (text: string) => rebaseLinks(text, pageDir, folder);
	const movedFacts = Object.fromEntries(FACTS.map((f) => [f, move(facts[f])])) as Facts;
	return new Map([
		[
			posix.join(folder, 'README.md'),
			readmeText(rowTitle(facts), movedFacts, issues ? [move(issues)] : []),
		],
		[posix.join(folder, `${runName}.md`), runText(move(plans), move(result))],
	]);
}

/** What a branch's edit added to one cell: the inserted text, and whether it also removed text. */
export function addedText(before: string, after: string): { text: string; edited: boolean } {
	if (before === after) return { text: '', edited: false };
	let start = 0;
	while (start < before.length && before[start] === after[start]) start++;
	let end = 0;
	while (
		end < before.length - start &&
		end < after.length - start &&
		before[before.length - 1 - end] === after[after.length - 1 - end]
	)
		end++;
	return {
		text: after.slice(start, after.length - end).replace(/^[\s;,]+|[\s;,]+$/g, ''),
		edited: before.length - end > start,
	};
}

/** A run file's name, without `.md`, from the run named in its text or the first date of its plans. */
export function runFileName(plans: string, result: string, taken: ReadonlySet<string>): string {
	const run = `${plans} ${result}`.match(/\b(\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*)\b/)?.[1];
	const date = plans.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
	const plan = plans.match(/^[a-z][a-z0-9-]*/i)?.[0]?.toLowerCase() ?? 'run';
	const name = run ?? `${date ? date.slice(1).join('') : '00000000'}-${plan}`;
	let unique = name;
	for (let n = 2; taken.has(unique); n++) unique = `${name}-${n}`;
	return unique;
}

/** The folder of the record whose device and browser match a row's facts, if one matches. */
export function matchRow(rows: readonly DeviceRow[], facts: Facts): DeviceRow | undefined {
	const device = rows.filter((row) => row.facts.Device === facts.Device);
	return (
		device.find((row) => row.facts.Browser === facts.Browser) ??
		device.find((row) => browserName(row.facts.Browser) === browserName(facts.Browser))
	);
}

/** A README's text with one fact replaced. */
const withFact = (readme: string, fact: string, value: string) =>
	readme.replace(new RegExp(`^- ${fact}:.*$`, 'm'), `- ${fact}:${value ? ` ${value}` : ''}`);

/** A README's text with one more known issue. */
function withIssue(readme: string, issue: string): string {
	const text = sentenceLines(issue);
	return /\nNone recorded\.\n?$/.test(readme)
		? readme.replace(/None recorded\.\n?$/, `${text}\n`)
		: `${readme.trimEnd()}\n\n${text}\n`;
}

/**
 * The record's files that carry over what a branch added to the old single table: `before` is the
 * page where the branch started and `after` the branch's page. Each row's new plans and results
 * become a run file in its folder, a new row becomes a new folder, and changed facts and new known
 * issues go into the folder's README. `files` holds the record as main has it now. The notes name
 * each cell that the branch changed in place rather than added to, for a person to check.
 */
export function branchEntries(
	before: string,
	after: string,
	files: ReadonlyMap<string, string>,
): { writes: Map<string, string>; notes: string[] } {
	const { rows } = readRecord(files);
	const writes = new Map<string, string>();
	const notes: string[] = [];
	const pageDir = posix.dirname(RECORD_PAGE);
	const oldRows = tableRows(before);
	const folders = new Set(rows.map((row) => posix.basename(row.folder)));
	for (const cells of tableRows(after)) {
		const facts = factsOf(cells);
		const old =
			oldRows.find((o) => o[0] === cells[0] && o[2] === cells[2]) ??
			oldRows.find(
				(o) => o[0] === cells[0] && browserName(o[2] ?? '') === browserName(facts.Browser),
			);
		if (old && old.join('|') === cells.join('|')) continue;
		const row = matchRow(rows, old ? factsOf(old) : facts) ?? matchRow(rows, facts);
		const title = rowTitle(facts);
		if (!row) {
			const name = runFileName(cells[6] ?? '', cells[7] ?? '', new Set());
			const made = rowFiles(cells, name, folders);
			for (const [path, text] of made) writes.set(path, text);
			folders.add(posix.basename(posix.dirname([...made.keys()][0] as string)));
			notes.push(`${title}: a new folder, ${posix.dirname([...made.keys()][0] as string)}`);
			continue;
		}
		const readmePath = posix.join(row.folder, 'README.md');
		const move = (text: string) => rebaseLinks(text, pageDir, row.folder);
		let readme = writes.get(readmePath) ?? files.get(readmePath) ?? '';
		FACTS.forEach((fact, i) => {
			const value = cells[i] ?? '';
			if (old && value === old[i]) return;
			if (onPage(row.facts[fact], readmePath) === value) return;
			readme = withFact(readme, fact, move(value));
			notes.push(`${title}: the ${fact} fact is now "${value}"`);
		});
		const [plans, result, issues] = [6, 7, 8].map((i) => addedText(old?.[i] ?? '', cells[i] ?? ''));
		for (const [label, change] of [
			['Plans', plans],
			['Result', result],
			['Known issues', issues],
		] as const)
			if (change?.edited)
				notes.push(
					`${title}: the branch changed text inside its ${label} cell, not only added to it; check the new files`,
				);
		if (issues?.text) readme = withIssue(readme, move(issues.text));
		if (readme !== (files.get(readmePath) ?? '')) writes.set(readmePath, readme);
		if (plans?.text || result?.text) {
			const taken = new Set(
				[...files.keys(), ...writes.keys()]
					.filter((path) => posix.dirname(path) === row.folder)
					.map((path) => posix.basename(path, '.md')),
			);
			const name = runFileName(plans?.text ?? '', result?.text ?? '', taken);
			writes.set(
				posix.join(row.folder, `${name}.md`),
				runText(move(plans?.text || '(not given)'), move(result?.text || '(not given)')),
			);
			if (!plans?.text || !result?.text)
				notes.push(`${title}: the run lacks its plans or its result; fill in "(not given)"`);
		}
	}
	return { writes, notes };
}

/**
 * The folders that may hold a device and browser that a runner page described. The page knows
 * less than a person: a model number or "iPad", not "iPad Pro 11-inch". So the browser's name
 * must match and the device's folder must name the page's model. The screen, the cores and the
 * place narrow the choice when more than one folder fits.
 */
export function findFolders(rows: readonly DeviceRow[], facts: Facts): DeviceRow[] {
	const [model = '', ...details] = facts.Device.split(', ');
	let found = rows.filter(
		(row) =>
			browserName(row.facts.Browser) === browserName(facts.Browser) &&
			row.facts.Device.toLowerCase().includes(model.toLowerCase()),
	);
	const narrowers = [
		...details.map((detail) => (row: DeviceRow) => row.facts.Device.includes(detail)),
		(row: DeviceRow) => row.facts.Where.toLowerCase() === facts.Where.toLowerCase(),
	];
	for (const fits of narrowers) {
		if (found.length < 2) break;
		const narrower = found.filter(fits);
		if (narrower.length > 0) found = narrower;
	}
	return found;
}

/**
 * The files that record one run from the device runner, as text to paste: the run file, and the
 * folder's README when no folder fits the device and browser. It says where each file goes, and
 * which facts of a fitting folder differ from what the run found.
 */
export function runEntryText(
	rows: readonly DeviceRow[],
	run: string,
	facts: Facts,
	plans: string,
	result: string,
): string {
	const found = findFolders(rows, facts);
	const file = `${run}.md`;
	const body = runText(plans, result);
	if (found.length === 1) {
		const row = found[0] as DeviceRow;
		const differ = FACTS.filter((fact) => facts[fact] && facts[fact] !== row.facts[fact]).map(
			(fact) => `  ${fact}: the README says "${row.facts[fact]}"; the run found "${facts[fact]}"`,
		);
		return [
			`${posix.join(row.folder, file)}:`,
			body,
			...(differ.length
				? ['Facts that differ from the folder README, to update if they changed:', ...differ, '']
				: []),
		].join('\n');
	}
	if (found.length > 1)
		return [
			`One of these folders, whichever holds this device: ${found.map((row) => row.folder).join(', ')}`,
			`<folder>/${file}:`,
			body,
		].join('\n');
	const folder = posix.join(
		RECORD_DIR,
		folderName(facts, new Set(rows.map((row) => posix.basename(row.folder)))),
	);
	return [
		`No folder holds this device and browser yet. Check, then add ${folder}/ and run bun run docs.`,
		`${folder}/README.md (fill in the empty facts where you know them):`,
		readmeText(rowTitle(facts), facts, []),
		`${folder}/${file}:`,
		body,
	].join('\n');
}
