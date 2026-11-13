// Where the species' reference folders are: the folder that NULL3D_PLANT_REFERENCES names, or the
// repository's own folder for them, which git ignores.
import { isAbsolute, join, resolve } from 'node:path';
import { REPO_ROOT } from '../../../tests/lib/server.ts';

/** The folder that holds one reference folder for each species. */
export const REFERENCES =
	process.env.NULL3D_PLANT_REFERENCES ??
	join(REPO_ROOT, '.internal/coordination/tree-corpus/generated');

/** A reference folder from its name: a path as it stands, or a species' slug under the store. */
export function referenceFolder(named: string): string {
	return isAbsolute(named) || named.includes('/') ? resolve(named) : join(REFERENCES, named);
}
