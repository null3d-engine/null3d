// Playwright and Vite load their configs, the specs and every module that these import under Node,
// which has no `Bun` global and no `bun:` modules. A tool that a spec reaches and that calls Bun's
// own API throws "Bun is not defined" only there, so a full run fails while the unit tests, which
// Bun runs, pass. This test follows those imports and refuses a module they
// reach that uses Bun's API, so the fault shows in every run, not only in a full one.

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { withImports } from '../../tools/lib/script-imports.ts';
import { scaledBudget } from './run-budget.ts';

const ROOT = join(import.meta.dirname, '../..');

/** The shader build's output, which imports only its own files and is too large to read here. */
const GENERATED = 'packages/engine/src/generated/';

/**
 * The walk lists every file under the test folders, picture references among them, and reads each
 * module that they reach. That takes about a second, and ten times as long at background priority.
 */
const WALK_MS = scaledBudget(30_000);

/** Every file that Node loads first: the Playwright and Vite configs, the files they name, and the Playwright specs. */
function nodeEntries(): string[] {
	const specs = ['tests', 'bench'].flatMap((folder) =>
		readdirSync(join(ROOT, folder), { recursive: true, encoding: 'utf8' })
			.filter((path) => path.endsWith('.spec.ts') && !path.includes('node_modules'))
			.map((path) => join(folder, path)),
	);
	const configs = [
		'tests/playwright.config.ts',
		'bench/playwright.config.ts',
		'vite.config.ts',
		...readdirSync(join(ROOT, 'packages'))
			.map((name) => join('packages', name, 'vite.config.ts'))
			.filter((path) => {
				try {
					return readFileSync(join(ROOT, path)).length > 0;
				} catch {
					return false;
				}
			}),
	];
	// Files that a config names by path rather than imports, such as Playwright's global setups.
	const named = configs.flatMap((config) =>
		[...readFileSync(join(ROOT, config), 'utf8').matchAll(/['"]([\w./-]+\.ts)['"]/g)]
			.map(([, path]) => join(dirname(config), path as string))
			.filter((path) => existsSync(join(ROOT, path))),
	);
	return [...specs, ...configs, ...named];
}

/**
 * A use of Bun's API: the `Bun` global, read or taken apart, a `bun:` or `bun` module, or one of the
 * `import.meta` paths that only Bun sets. `typeof Bun` works on Node, and so does a script's
 * `if (import.meta.main)`, which reads as false there, so neither counts.
 */
const BUN_API =
	/\bBun\s*(?:\.|\?\.|\[)|=\s*Bun\b|\b(?:from|import|require)\s*\(?\s*['"]bun(?::[\w-]+)?['"]|\bimport\.meta\.(?:dir|path|file)\b/;

/**
 * The text of a module without its comments, which may name Bun freely: line comments that fill
 * their line, and block comments that start one. A comment after code stays, so a guard reads too
 * much rather than too little, and no text inside a string can start a comment here.
 */
const withoutComments = (text: string) =>
	text.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');

describe('the modules that Node loads under Playwright and Vite', () => {
	it(
		"use no API of Bun's own, which Node does not have",
		() => {
			const entries = nodeEntries();
			expect(entries.length).toBeGreaterThan(100);
			const reached = withImports(ROOT, entries, (file) => file.startsWith(GENERATED));
			const usesBun = [...reached].filter(
				(file) =>
					!file.startsWith(GENERATED) &&
					BUN_API.test(withoutComments(readFileSync(join(ROOT, file), 'utf8'))),
			);
			expect(usesBun).toEqual([]);
		},
		WALK_MS,
	);
});
