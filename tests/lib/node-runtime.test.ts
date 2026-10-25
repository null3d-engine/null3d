// Playwright and Vite load their configs, the specs and every module that these import under Node,
// which has no `Bun` global and no `bun:` modules. A tool that a spec reaches and that calls Bun's
// own API throws "Bun is not defined" only there: on 25 October 2026 the package build's process
// runner did, inside the CDN picture test, and a full run failed all seven of its tests, while the
// unit tests, which Bun runs, passed. This test follows those imports and refuses a module they
// reach that uses Bun's API, so the fault shows in every run, not only in a full one.
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withImports } from '../../tools/lib/script-imports.ts';

const ROOT = join(import.meta.dirname, '../..');

/** The shader build's output, which imports only its own files and is too large to read here. */
const GENERATED = 'packages/engine/src/generated/';

/**
 * The walk lists every file under the test folders, picture references among them, and reads each
 * module that they reach. That takes about a second, and ten times as long at background priority.
 */
const WALK_MS = 30_000;

/** Every file that Node loads first: the Playwright and Vite configs, and the Playwright specs. */
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
	return [...specs, ...configs];
}

/** A use of Bun's API outside comments: the `Bun` global, or a `bun:` or `bun` module. */
const BUN_API = /\bBun\.\w|from\s*['"]bun(?::[\w-]+)?['"]|import\(\s*['"]bun(?::[\w-]+)?['"]/;

/** The text of a module with its line and block comments left out, which may name Bun freely. */
const withoutComments = (text: string) =>
	text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

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
