// The one walk over a folder of the repository's own files. It never enters `node_modules` and never
// follows a symbolic link. The workspace packages link to each other through `node_modules`, and two
// that name each other make a cycle of links: `readdirSync` with `recursive: true` follows the links
// on Linux and stops with ELOOP, while the Mac's walk does not follow them. No tool reads an installed
// package's files, so the walk leaves them out on both.
import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The folder that holds installed packages and the links between the workspace packages. */
const INSTALLED = 'node_modules';

/**
 * Every file below `folder`, as a path from it with the system's separator, in the order of the walk.
 * Folders named `node_modules` or in `skip` are not entered, and a symbolic link is neither entered
 * nor listed. A folder that does not exist gives no files.
 *
 * @param folder The folder to walk.
 * @param skip The names of further folders not to enter, such as a folder of generated files.
 * @returns The files' paths from `folder`.
 */
export function filesBelow(folder: string, skip: readonly string[] = []): string[] {
	const files: string[] = [];
	const pending = [''];
	for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
		let entries: Dirent[];
		try {
			entries = readdirSync(join(folder, path), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const child = path === '' ? entry.name : join(path, entry.name);
			if (entry.isDirectory()) {
				if (entry.name !== INSTALLED && !skip.includes(entry.name)) pending.push(child);
			} else if (entry.isFile()) files.push(child);
		}
	}
	return files;
}
