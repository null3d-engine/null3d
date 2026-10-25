import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheDir, HEAVY_SLOT_ENV } from './build-cache';
import {
	QUIET_FILE_ENV,
	QUIET_PASSED_ENV,
	quietFile,
	quietRefusal,
	refuseInQuietWindow,
} from './quiet-window';

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** An environment whose marker is a file of its own, which holds `text` when given. */
function withMarker(text?: string): NodeJS.ProcessEnv {
	const folder = mkdtempSync(join(tmpdir(), 'quiet-window-'));
	folders.push(folder);
	const file = join(folder, 'quiet-window');
	if (text !== undefined) writeFileSync(file, text);
	return { [QUIET_FILE_ENV]: file };
}

describe('quietFile', () => {
	it('is the path that the variable names, or one in the null3D cache folder', () => {
		expect(quietFile({ [QUIET_FILE_ENV]: '/tmp/marker' })).toBe('/tmp/marker');
		expect(quietFile({})).toBe(cacheDir('quiet-window'));
	});
});

describe('quietRefusal', () => {
	it('lets a tool start when no marker stands', () => {
		expect(quietRefusal('The page build', withMarker())).toBeNull();
	});

	it("refuses a tool that no queue started while a marker stands, and names the marker's holder", () => {
		const env = withMarker('the light-map cost run\nmore');
		const refusal = quietRefusal('The page build', env);
		expect(refusal).toStartWith(
			'The page build did not start: a timing run holds this machine quiet (the light-map cost run)',
		);
		expect(refusal).toContain(`once ${env[QUIET_FILE_ENV]} is gone`);
		expect(quietRefusal('The page build', withMarker(''))).toContain('holds this machine quiet,');
	});

	it('lets the job queue start a tool, since the queue holds its own jobs back', () => {
		expect(
			quietRefusal('The page build', { ...withMarker('a run'), [HEAVY_SLOT_ENV]: '2' }),
		).toBeNull();
	});
});

describe('refuseInQuietWindow', () => {
	it('marks a process that may start, so the processes it starts go on when a window opens', () => {
		const env = withMarker();
		refuseInQuietWindow('The shader build', env);
		expect(env[QUIET_PASSED_ENV]).toBe('1');
		writeFileSync(env[QUIET_FILE_ENV] as string, 'a run');
		expect(() => refuseInQuietWindow('The shader build', env)).not.toThrow();
	});

	it('throws the refusal for a process that may not start', () => {
		const env = withMarker('a run');
		expect(() => refuseInQuietWindow('The shader build', env)).toThrow(
			'The shader build did not start',
		);
		expect(env[QUIET_PASSED_ENV]).toBeUndefined();
	});
});

describe('the tools that build or drive a browser', () => {
	it('refuse to start while a marker stands, before they do any work', () => {
		const env: NodeJS.ProcessEnv = { ...process.env, ...withMarker('a timing run') };
		delete env[HEAVY_SLOT_ENV];
		delete env[QUIET_PASSED_ENV];
		const root = join(import.meta.dirname, '../..');
		for (const [tool, what] of [
			['tools/shaders.ts', 'The shader build'],
			['tools/build-wasm.ts', 'The WebAssembly build'],
			['tools/build-test-pages.ts', 'The test page build'],
		] as const) {
			const run = spawnSync(process.execPath, [join(root, tool)], {
				cwd: root,
				env,
				encoding: 'utf8',
			});
			expect(run.status, tool).toBe(1);
			expect(run.stderr, tool).toContain(
				`${what} did not start: a timing run holds this machine quiet`,
			);
		}
	}, 60_000);
});

describe('each guarded entry point', () => {
	const root = join(import.meta.dirname, '../..');
	/**
	 * Each file, the text that opens the guarded code, and the first heavy call after it, which the
	 * guard must come before, or null when the guard must be the code's first statement.
	 */
	const GUARDED: readonly [string, string, string | null][] = [
		['tests/playwright.config.ts', 'export const', 'ensureShaderModules(REPO_ROOT);'],
		['bench/probes/f10-upscalers/run.ts', 'import', 'Bun.serve('],
		['tests/lib/load-server.ts', 'function viteBuild(', "spawnSync('bunx', ['vite', 'build'"],
		['tests/lib/server.ts', 'export async function startServer(', 'await answers('],
		['tests/lib/server.ts', 'export async function startPreview(', 'await refuseTaken('],
		['tools/lib/shader-modules.ts', 'export function ensureShaderModules(', null],
		['tools/lib/shader-modules.ts', 'export function shaderModulesUnlessBusy(', null],
		['tools/typecheck.ts', 'async function main(shaders: boolean)', null],
		['tools/build-cdn.ts', 'async function main()', null],
		['tests/fresh-project.ts', 'async function main()', null],
		...[
			'run',
			'allocation',
			'profile',
			'readme-media',
			'parity',
			'soak',
			'startup',
			'gpu-check',
		].map((tool): [string, string, null] => [`bench/${tool}.ts`, 'async function main()', null]),
	];

	it('checks the window before its first heavy step', () => {
		for (const [file, opening, heavy] of GUARDED) {
			const text = readFileSync(join(root, file), 'utf8');
			const from = opening === 'import' || file.endsWith('.config.ts') ? 0 : text.indexOf(opening);
			expect(from, `${file}: ${opening}`).toBeGreaterThan(-1);
			const guard = text.indexOf('refuseInQuietWindow(', from);
			if (heavy === null) {
				const body = text.slice(text.indexOf('{\n', from) + 2).trimStart();
				expect(body.startsWith('refuseInQuietWindow('), `${file}: ${opening}`).toBe(true);
			} else {
				const step = text.indexOf(heavy, from);
				expect(step, `${file}: ${heavy}`).toBeGreaterThan(-1);
				expect(guard, `${file}: ${opening}`).toBeGreaterThan(-1);
				expect(guard, `${file}: ${opening}`).toBeLessThan(step);
			}
		}
	});
});
