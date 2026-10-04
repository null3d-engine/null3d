// The version of the null3d command, from its package.
import { readFileSync } from 'node:fs';

/** The version of this package. */
export const VERSION = /** @type {string} */ (
	JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
);
