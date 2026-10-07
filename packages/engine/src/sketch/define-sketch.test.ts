import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { defineSketch, loadSketch, type SketchLoadOptions } from './define-sketch';

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

/** The error that loading the module at `url` throws, with no wait before the second import. */
async function failure(url: string, options: SketchLoadOptions = {}): Promise<EngineError> {
	try {
		await loadSketch(url, { retryWaitMs: 0, ...options });
	} catch (e) {
		return e as EngineError;
	}
	throw new Error(`${url} loaded`);
}

// The page sets the table of fixes that ends each error's message before it can raise an error.
// The loader notes each second import in the console, which the tests keep quiet.
let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
	setErrorFixes(ERROR_FIXES);
	warn = spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

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

	/** Reports a policy violation as a browser does, a moment after the request that it blocked. */
	const reportViolation = (directive: string, blocked: string) =>
		setTimeout(() => {
			const event = new Event('securitypolicyviolation');
			Object.assign(event, { effectiveDirective: directive, blockedURI: blocked });
			dispatchEvent(event);
		}, 0);

	it("refuses a module that the page's policy blocks, or an import of it, with E1422 and the directive", async () => {
		const url = 'http://127.0.0.1:9/assets/sketch.js';
		const failing = failure(url);
		reportViolation('worker-src', 'http://127.0.0.1:9/assets/src.js');
		const error = await failing;
		expect(error.code).toBe('E1422');
		expect(error.message).toStartWith(
			`E1422: the page's Content-Security-Policy blocks the sketch module ${url}: its worker-src does not allow http://127.0.0.1:9/assets/src.js.`,
		);
	});

	it('keeps E1410 when the only violation is of a directive that blocks no module', async () => {
		const url = 'http://127.0.0.1:10/assets/sketch.js';
		const failing = failure(url);
		reportViolation('img-src', 'http://127.0.0.1:10/assets/texture.png');
		expect((await failing).code).toBe('E1410');
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

describe('loadSketch, when an import fails', () => {
	const url = 'https://example.com/assets/sketch.js';
	const sketch = { default: defineSketch(() => ({})) };

	/**
	 * A stub import that answers each call with the next outcome, an error to throw or a module to
	 * return, and records the addresses it was asked for.
	 */
	function stubImport(...outcomes: unknown[]) {
		const asked: string[] = [];
		const importModule = async (address: string) => {
			asked.push(address);
			const outcome = outcomes[asked.length - 1];
			if (outcome instanceof Error) throw outcome;
			return outcome as { default?: unknown };
		};
		return { asked, importModule };
	}

	it('imports the module once more, and notes the second import in the trail and the console', async () => {
		const { asked, importModule } = stubImport(
			new TypeError('Importing a module script failed.'),
			sketch,
		);
		const steps: string[] = [];
		const loaded = await loadSketch(url, {
			importModule,
			retryWaitMs: 0,
			step: (text) => steps.push(text),
		});
		expect(loaded).toBe(sketch.default);
		expect(asked).toEqual([url, url]);
		expect(steps).toEqual([
			`the sketch module ${url} did not load (Importing a module script failed), so the engine imports it once more`,
		]);
		expect(warn).toHaveBeenCalledWith(`null3D: ${steps[0]}`);
	});

	it('imports the module at an address with a query when the browser keeps the failed import', async () => {
		const { asked, importModule } = stubImport(
			new TypeError(`Failed to fetch dynamically imported module: ${url}`),
			new TypeError(`Failed to fetch dynamically imported module: ${url}`),
			sketch,
		);
		const steps: string[] = [];
		const loaded = await loadSketch(url, {
			importModule,
			retryWaitMs: 0,
			step: (text) => steps.push(text),
		});
		expect(loaded).toBe(sketch.default);
		expect(asked).toEqual([url, url, `${url}?null3d-retry=1`]);
		expect(steps[1]).toBe(
			`the second import failed too, so the engine imports ${url}?null3d-retry=1`,
		);
	});

	it('fails with E1410 and the first reason, in the same words, when the second import fails too', async () => {
		const { asked, importModule } = stubImport(
			new TypeError('Importing a module script failed.'),
			new TypeError('Importing a module script failed.'),
			new TypeError('Load failed.'),
		);
		const error = await failure(url, { importModule });
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe('E1410');
		expect(error.message).toStartWith(
			`E1410: the sketch module ${url} did not load: Importing a module script failed. ${ERROR_FIXES.E1410}`,
		);
		expect(asked).toHaveLength(3);
	});

	it('does not ask again for a module whose code threw, which the browser rethrows', async () => {
		const threw = new TypeError('the module threw on purpose.');
		const { asked, importModule } = stubImport(threw, threw);
		const error = await failure(url, { importModule });
		expect(error.code).toBe('E1410');
		expect(error.message).toStartWith(
			`E1410: the sketch module ${url} did not load: the module threw on purpose. Pass the sketch`,
		);
		expect(asked).toEqual([url, url]);
	});

	it('gives no query to an address other than http or https', async () => {
		const blob = 'blob:https://example.com/0b6c2f4e';
		const { asked, importModule } = stubImport(new TypeError('a'), new TypeError('b'));
		expect((await failure(blob, { importModule })).code).toBe('E1410');
		expect(asked).toEqual([blob, blob]);
	});

	it('keeps the code of an engine error that the second import throws', async () => {
		const { importModule } = stubImport(
			new TypeError('Importing a module script failed.'),
			new EngineError('E1204', 'setBackground() got the color "blue-ish".'),
		);
		expect((await failure(url, { importModule })).code).toBe('E1204');
	});
});
