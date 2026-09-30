// Words, counts and file paths in what the commands print.
import { isAbsolute, relative } from 'node:path';

/**
 * A count with its noun, such as `1 error` or `3 draw calls`.
 *
 * @param {number} count
 * @param {string} noun
 */
export const counted = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * A file as a summary names it: from the current folder when the file is inside it, and in full
 * elsewhere.
 *
 * @param {string} file
 */
export function shownPath(file, cwd = process.cwd()) {
	const path = relative(cwd, file);
	return path === '' || path.startsWith('..') || isAbsolute(path) ? file : path;
}

/** The lines of each logged entry that a summary shows. The JSON files keep all of them. */
const SHOWN_LINES = 3;

/**
 * Lines that list what a page logged, such as `2 errors:`, then each entry indented, cut to its
 * first lines.
 *
 * @param {readonly string[]} entries
 * @param {string} kind
 */
export function listed(entries, kind) {
	if (entries.length === 0) return [];
	return [
		`${counted(entries.length, kind)}:`,
		...entries.flatMap((entry) => {
			const lines = entry.split('\n');
			const shown = lines.slice(0, SHOWN_LINES);
			if (lines.length > SHOWN_LINES) shown.push('    ...');
			return shown.map((line) => `  ${line}`);
		}),
	];
}
