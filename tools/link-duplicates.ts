// Makes each set of files with equal contents below the named folders one file with several names,
// so that an archive which keeps hard links, as tar does, holds each content once. Each test page's
// production build writes the whole shader set, so builds of several pages repeat most of their
// files.
//   bun tools/link-duplicates.ts <folder...>
import { linkSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** What a run linked: the files it read, the files it made links of, and the bytes they held. */
export interface Linked {
	files: number;
	links: number;
	bytes: number;
}

/** Every file below `folder`, by its path. */
function filesBelow(folder: string): string[] {
	return readdirSync(folder, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Links every file below `folders` whose contents equal an earlier file's to that file. Only files of
 * equal size are read and compared, by their SHA-256. A link replaces a file in one rename, so a
 * file never goes missing partway.
 */
export function linkDuplicates(folders: readonly string[]): Linked {
	const bySize = new Map<number, string[]>();
	let files = 0;
	for (const folder of folders)
		for (const file of filesBelow(folder)) {
			files++;
			const { size, nlink } = statSync(file);
			// A file that is already a link of another holds no content of its own to compare.
			if (nlink > 1) continue;
			const same = bySize.get(size);
			if (same) same.push(file);
			else bySize.set(size, [file]);
		}
	let links = 0;
	let bytes = 0;
	for (const [size, group] of bySize) {
		if (group.length < 2) continue;
		const first = new Map<string, string>();
		for (const file of group) {
			const hash = new Bun.CryptoHasher('sha256').update(readFileSync(file)).digest('hex');
			const original = first.get(hash);
			if (original === undefined) {
				first.set(hash, file);
				continue;
			}
			const staged = `${file}.link`;
			linkSync(original, staged);
			renameSync(staged, file);
			links++;
			bytes += size;
		}
	}
	return { files, links, bytes };
}

if (import.meta.main) {
	const folders = process.argv.slice(2);
	if (folders.length === 0) {
		console.error('usage: bun tools/link-duplicates.ts <folder...>');
		process.exit(1);
	}
	const started = performance.now();
	const { files, links, bytes } = linkDuplicates(folders);
	console.log(
		`Linked ${links} of ${files} files to an earlier file of equal contents, ${(bytes / 2 ** 30).toFixed(2)} GB, in ${Math.round((performance.now() - started) / 1000)} s.`,
	);
}
