// Checks that the example add-ons under `examples/addons/` keep the shape that the shared README
// gives (D-173 ruling 5, M3-D5). An example add-on is shaped like a package but is never published:
// one entry, its WGSL and that file's declaration beside it, and a README that gives its costs and
// its licence. `tools/check-addon-layout.ts` runs the check over the repository.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The licence line that every example add-on's README gives. */
const LICENCE = 'MIT OR Apache-2.0';

/** The result of a layout scan: the problems found and the add-on folders read. */
export interface AddonLayoutReport {
	/** One `folder: problem` line for each break of the shape. */
	problems: string[];
	/** The add-on folders that were read, by name. */
	folders: string[];
}

/** The files in `folder`, as names, or none when it cannot be read. */
function filesIn(folder: string): string[] {
	try {
		return readdirSync(folder, { withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
}

/**
 * Checks one add-on folder against the shape, adding one line per break to `problems`. The shape is
 * an `index.ts` entry, a `.wgsl` file that the entry imports with its `.wgsl.d.ts` beside it, and a
 * `README.md` with a `## Licence` section that names the engine's licences.
 */
function checkFolder(dir: string, name: string, problems: string[]): void {
	const files = filesIn(join(dir, name));
	if (files.length === 0) {
		problems.push(`${name}: the folder holds no files`);
		return;
	}
	const hasEntry = files.includes('index.ts');
	const entry = hasEntry ? readFileSync(join(dir, name, 'index.ts'), 'utf8') : '';
	if (!hasEntry) problems.push(`${name}: no index.ts entry`);
	const shaders = files.filter((file) => file.endsWith('.wgsl'));
	if (shaders.length === 0) problems.push(`${name}: no .wgsl shader`);
	for (const shader of shaders) {
		if (!files.includes(`${shader}.d.ts`))
			problems.push(`${name}: ${shader} has no ${shader}.d.ts beside it`);
		if (hasEntry && !entry.includes(`'./${shader}'`))
			problems.push(`${name}: index.ts does not import ${shader}`);
	}
	const readme = files.includes('README.md')
		? readFileSync(join(dir, name, 'README.md'), 'utf8')
		: '';
	if (!readme) problems.push(`${name}: no README.md`);
	else {
		if (!/^## Licence$/m.test(readme))
			problems.push(`${name}: README.md has no "## Licence" section`);
		if (!readme.includes(LICENCE)) problems.push(`${name}: README.md does not name ${LICENCE}`);
	}
}

/** Every break of the example add-on shape in the repository at `root`, and the folders read. */
export function addonLayoutProblems(root: string): AddonLayoutReport {
	const dir = join(root, 'examples/addons');
	let folders: string[];
	try {
		folders = readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
			.map((entry) => entry.name)
			.sort();
	} catch {
		return { problems: [], folders: [] };
	}
	const problems: string[] = [];
	for (const folder of folders) checkFolder(dir, folder, problems);
	return { problems, folders };
}
