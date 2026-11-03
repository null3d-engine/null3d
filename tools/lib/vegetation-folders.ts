// The vegetation add-on's species folders, read from packages/vegetation/src/species/. The registry
// generator and the image manifest's species tests both list them from here. This file uses only
// Node's own modules, since Playwright loads the manifest under Node.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The species folders' parent. */
export const SPECIES_DIR = 'packages/vegetation/src/species';

/** One species folder: its id, and whether it has species-only code in a `hooks.ts`. */
export interface SpeciesFolder {
	readonly id: string;
	readonly hooks: boolean;
}

/**
 * The species folders, sorted: every folder under `species/` with an `index.ts`, but those whose
 * names start with an underscore, such as the template.
 */
export function speciesFolders(root: string): SpeciesFolder[] {
	const dir = join(root, SPECIES_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
		.filter((entry) => existsSync(join(dir, entry.name, 'index.ts')))
		.map((entry) => ({
			id: entry.name,
			hooks: existsSync(join(dir, entry.name, 'hooks.ts')),
		}))
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
