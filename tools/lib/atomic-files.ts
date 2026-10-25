// Puts build output in place so that a reader never sees part of a file. Each file goes to a
// temporary name beside its place, then a rename puts it in place in one step, so a dev server or
// a browser run that reads the output while a build runs gets the old file or the new one whole.

import {
	copyFileSync,
	linkSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** The ending of a file that is not complete yet. */
const PARTIAL = '.partial';

/** The temporary name beside `path` that a file takes until it is complete. */
export function partialName(path: string): string {
	return `${path}.${process.pid}${PARTIAL}`;
}

/** Copies `source` to `path`, which takes the whole new file in one step. */
export function copyInPlace(source: string, path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const partial = partialName(path);
	copyFileSync(source, partial);
	renameSync(partial, path);
}

/**
 * Puts a link to `source` at `path` in one step: the two names share one file, and no byte is
 * written. A later write into either file in place shows through the other name. A path that names
 * the source's file already stays as it is. A rename onto the same file leaves the temporary name
 * behind, and a failed one leaves a link to the source under it, so the temporary name always goes,
 * and a later write to that name never reaches the source.
 */
export function linkInPlace(source: string, path: string): void {
	const from = statSync(source);
	const at = statSync(path, { throwIfNoEntry: false });
	if (at !== undefined && at.dev === from.dev && at.ino === from.ino) return;
	mkdirSync(dirname(path), { recursive: true });
	const partial = partialName(path);
	rmSync(partial, { force: true });
	try {
		linkSync(source, partial);
		renameSync(partial, path);
	} finally {
		rmSync(partial, { force: true });
	}
}

/** The paths of the files under `folder`, relative to it, or none when it does not exist. */
function filesIn(folder: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(folder, { recursive: true, encoding: 'utf8' });
	} catch {
		return [];
	}
	return entries.filter((entry) => statSync(join(folder, entry)).isFile());
}

/**
 * Puts each file of the folder `staged` in its place in `folder`, as `copyInPlace` does, then
 * removes the files of `folder` that `staged` does not hold, and `staged` itself. Files that
 * another build has not completed yet stay.
 */
export function replaceFolder(staged: string, folder: string): void {
	const files = filesIn(staged);
	for (const file of files) copyInPlace(join(staged, file), join(folder, file));
	const kept = new Set(files);
	for (const file of filesIn(folder))
		if (!kept.has(file) && !file.endsWith(PARTIAL)) rmSync(join(folder, file), { force: true });
	rmSync(staged, { recursive: true, force: true });
}
