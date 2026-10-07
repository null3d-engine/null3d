// The decision records in `.dev/decisions/`. Each record holds its own title, status and summary,
// and the list of records is made from them, so a pull request that adds a record edits no file
// that other pull requests edit too.
import { posix } from 'node:path';
import { readIfExists, walkFiles } from './files';

export const DECISIONS_DIR = '.dev/decisions';

/** Markdown files in the folder that are not records. */
const NOT_RECORDS = new Set(['README.md', 'TEMPLATE.md']);

/** A record's file name: its ID, then a short name in lowercase words joined by hyphens. */
const FILE_NAME = /^D-(\d{2,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export interface DecisionRecord {
	number: number;
	/** The ID, such as D-07. */
	id: string;
	title: string;
	path: string;
	/** The record's status paragraph, without its label. */
	status: string;
	/** The record's one-paragraph summary, without its label. */
	summary: string;
}

/** The text of the paragraph that starts with `label:`, joined onto one line, or '' when absent. */
export function labelledParagraph(text: string, label: string): string {
	const match = text.match(new RegExp(`^${label}: (.+(?:\\n.+)*)`, 'm'));
	return match ? (match[1] as string).replace(/\s*\n\s*/g, ' ').trim() : '';
}

/**
 * The records among `files` (repository path to text), sorted by number, and every problem that
 * keeps one out of the list or makes two clash: a file name without an ID, a title line that does
 * not match it, a missing status or summary, and a number that two records share.
 */
export function readRecords(files: ReadonlyMap<string, string>): {
	records: DecisionRecord[];
	problems: string[];
} {
	const records: DecisionRecord[] = [];
	const problems: string[] = [];
	for (const [path, text] of files) {
		const name = posix.basename(path);
		const number = name.match(FILE_NAME)?.[1];
		if (number === undefined) {
			problems.push(`${path}: name the file D-<number>-<short-name>.md, in lowercase`);
			continue;
		}
		const id = `D-${number}`;
		const title = text.match(new RegExp(`^# ${id}: (.+)`))?.[1]?.trim();
		const status = labelledParagraph(text, 'Status');
		const summary = labelledParagraph(text, 'Summary');
		if (!title) problems.push(`${path}: start the record with the line "# ${id}: <title>"`);
		if (!status) problems.push(`${path}: add a "Status:" paragraph under the title`);
		if (!summary) problems.push(`${path}: add a "Summary:" paragraph under the status`);
		records.push({ number: Number(number), id, title: title ?? '', path, status, summary });
	}
	records.sort((a, b) => a.number - b.number || a.path.localeCompare(b.path));
	for (let i = 1; i < records.length; i++) {
		const [before, record] = [records[i - 1] as DecisionRecord, records[i] as DecisionRecord];
		if (before.number === record.number)
			problems.push(
				`${before.path} and ${record.path} both take ${record.id}: give one the next free number`,
			);
	}
	return { records, problems };
}

/** The records' files under `root`, as repository path to text. */
export function recordFiles(root: string): Map<string, string> {
	const isRecord = (path: string) =>
		posix.dirname(path) === DECISIONS_DIR &&
		path.endsWith('.md') &&
		!NOT_RECORDS.has(posix.basename(path));
	return new Map(
		walkFiles(root, DECISIONS_DIR, isRecord).map((path) => [path, readIfExists(root, path) ?? '']),
	);
}

/** The list of records: each record's ID, title and file, then its status and summary. */
export function recordList(records: readonly DecisionRecord[]): string {
	return records
		.map((r) => `${r.id}: ${r.title} (${r.path})\n  Status: ${r.status}\n  Summary: ${r.summary}\n`)
		.join('\n');
}
