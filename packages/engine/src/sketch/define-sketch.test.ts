import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { loadSketch } from './define-sketch';

/**
 * The folder of the sketch modules that the tests write, by its real path: on macOS the temp folder
 * is a link, and Bun does not import a module through it.
 */
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'null3d-sketches-')));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The address of an engine module, for the modules that the tests write. */
const engineModule = (path: string) => pathToFileURL(join(import.meta.dirname, path)).href;

/** Writes a module with `code` and returns its address. */
function writeModule(name: string, code: string): string {
	const file = join(dir, name);
	writeFileSync(file, code);
	return pathToFileURL(file).href;
}

/** The error that loading the module at `url` throws. */
async function failure(url: string): Promise<EngineError> {
	try {
		await loadSketch(url);
	} catch (e) {
		return e as EngineError;
	}
	throw new Error(`${url} loaded`);
}

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

describe('loadSketch', () => {
	it('returns the sketch that a module exports as its default export', async () => {
		const url = writeModule(
			'sketch.js',
			`import { defineSketch } from '${engineModule('define-sketch.ts')}';
			export default defineSketch(() => ({}));`,
		);
		expect(typeof (await loadSketch(url)).setup).toBe('function');
	});

	it('refuses a module that exports no sketch, with E1401', async () => {
		const url = writeModule('not-a-sketch.js', 'export const sketch = {};');
		const error = await failure(url);
		expect(error.code).toBe('E1401');
		expect(error.message).toStartWith(`E1401: ${url} must export default defineSketch(...).`);
	});

	it('refuses a module that does not exist, with E1410 and the reason', async () => {
		const url = pathToFileURL(join(dir, 'missing.js')).href;
		const error = await failure(url);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe('E1410');
		expect(error.message).toStartWith(`E1410: the sketch module ${url} did not load: `);
		expect(error.message).toContain(ERROR_FIXES.E1410);
	});

	it('refuses a module whose code throws when it loads, with E1410 and the error', async () => {
		const url = writeModule('throws.js', "throw new TypeError('the module threw on purpose.');");
		const error = await failure(url);
		expect(error.code).toBe('E1410');
		expect(error.message).toStartWith(
			`E1410: the sketch module ${url} did not load: the module threw on purpose. Pass the sketch`,
		);
	});

	it('keeps the code of an engine error that the module throws when it loads', async () => {
		const url = writeModule(
			'engine-error.js',
			`import { EngineError } from '${engineModule('../errors/engine-error.ts')}';
			throw new EngineError('E1204', 'setBackground() got the color "blue-ish".');`,
		);
		const error = await failure(url);
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe('E1204');
		expect(error.message).toStartWith('E1204: setBackground() got the color "blue-ish".');
	});
});
