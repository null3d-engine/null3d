import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaledBudget } from '../../tests/lib/run-budget.ts';
import { cacheDir, HEAVY_SLOT_ENV } from './build-cache';
import {
	QUIET_FILE_ENV,
	QUIET_MARKER_LIFETIME_MS,
	QUIET_PASSED_ENV,
	quietEndTime,
	quietFile,
	quietHolderPid,
	quietQueueRunWaiting,
	quietRefusal,
	quietWindow,
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

	it('lets a tool start once the marker has outlived its run', () => {
		const old = withMarker('a memory run');
		const born = new Date(Date.now() - 2 * 60 * 60 * 1000);
		utimesSync(old[QUIET_FILE_ENV] as string, born, born);
		expect(quietRefusal('The page build', old)).toBeNull();
		// A run that named when it would finish is judged by that time instead, on both sides of it.
		const named = withMarker('a soak (until about 00:01)');
		expect(
			quietRefusal('The page build', named, undefined, new Date(2026, 10, 3, 23, 30)),
		).not.toBeNull();
		expect(
			quietRefusal('The page build', named, undefined, new Date(2026, 10, 4, 0, 30)),
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

describe('quietWindow', () => {
	/** Whether the window at `file` has outlived its run; a vanished marker holds nothing to outlive. */
	function stale(file: string, now: Date): boolean {
		const window = quietWindow(file, now);
		return window.held ? window.stale : false;
	}
	/** A marker file that holds `text` and claims to have been written at `born`. */
	function marker(text: string, born: Date): string {
		const file = withMarker(text)[QUIET_FILE_ENV] as string;
		utimesSync(file, born, born);
		return file;
	}

	it('reports no window when no marker stands', () => {
		expect(quietWindow(withMarker()[QUIET_FILE_ENV] as string)).toEqual({ held: false });
	});

	it('holds a window whose marker names no end time until an hour has passed', () => {
		const now = new Date(2026, 10, 3, 12, 0);
		const young = marker('a memory run\n', new Date(now.getTime() - 59 * 60 * 1000));
		expect(quietWindow(young, now)).toMatchObject({ held: true, stale: false });
		const old = marker('a memory run\n', new Date(now.getTime() - QUIET_MARKER_LIFETIME_MS));
		expect(quietWindow(old, now)).toMatchObject({ held: true, stale: true });
	});

	it('judges a marker that names an end time by that time alone', () => {
		const now = new Date(2026, 10, 3, 13, 0);
		const born = new Date(now.getTime() - 2 * 60 * 1000);
		// An hour past the time it promised, and still a fresh file: the run outlived its marker.
		expect(quietWindow(marker('a run (until about 12:00)\n', born), now)).toMatchObject({
			held: true,
			stale: true,
		});
		expect(quietWindow(marker('a run (until about 13:20)\n', born), now)).toMatchObject({
			held: true,
			stale: false,
		});
		// Five minutes of grace past the time it named, and no more.
		expect(stale(marker('a run (until about 12:55)\n', born), now)).toBe(true);
		expect(stale(marker('a run (until about 12:58)\n', born), new Date(2026, 10, 3, 13, 2))).toBe(
			false,
		);
	});

	it('releases a window whose holder named its process once that process has gone', () => {
		const now = new Date();
		// A marker naming a process that cannot be running: its run finished without removing it.
		expect(quietWindow(marker('a soak, pid 999999 (until about 23:59)\n', now), now)).toMatchObject(
			{
				held: true,
				stale: true,
			},
		);
		// This test's own process stands behind its marker, so the window holds.
		expect(stale(marker(`a soak, pid ${process.pid} (until about 23:59)\n`, now), now)).toBe(false);
		expect(quietHolderPid('a soak, pid 12')).toBe(12);
		expect(quietHolderPid('a soak')).toBeNull();
	});

	it('reads an end time before midnight as the day it closes on, not the day it was written', () => {
		const now = new Date(2026, 10, 3, 23, 50);
		const end = quietEndTime('a soak (until about 00:20)', now, now);
		expect(end?.getTime()).toBe(new Date(2026, 10, 4, 0, 20).getTime());
		expect(stale(marker('a soak (until about 00:20)\n', now), now)).toBe(false);
		expect(quietEndTime('a soak', now, now)).toBeNull();
	});

	it('counts a span the holder names from the moment it opened the window', () => {
		const now = new Date(2026, 10, 3, 13, 20);
		const born = new Date(2026, 10, 3, 13, 0);
		expect(quietEndTime('a sweep (M3-C1 ablation, about 12 minutes)', born, now)?.getTime()).toBe(
			new Date(2026, 10, 3, 13, 12).getTime(),
		);
		// Eighteen minutes on, a twelve-minute sweep is over and its marker is one it left behind.
		expect(stale(marker('a sweep (about 12 minutes)\n', born), now)).toBe(true);
		// Five minutes in, the same marker still holds.
		expect(stale(marker('a sweep (about 12 minutes)\n', born), new Date(2026, 10, 3, 13, 5))).toBe(
			false,
		);
	});
});

describe('quietQueueRunWaiting', () => {
	/** A queue folder of its own, with the folders that the queue keeps its runs in. */
	function queue(): string {
		const folder = mkdtempSync(join(tmpdir(), 'quiet-queue-'));
		folders.push(folder);
		mkdirSync(join(folder, 'heavy-tickets'));
		mkdirSync(join(folder, 'heavy-slots'));
		return folder;
	}

	it('finds no run behind a window when the queue holds none', () => {
		expect(quietQueueRunWaiting(queue())).toBe(false);
		expect(quietQueueRunWaiting('/tmp/a-queue-that-is-not-there')).toBe(false);
	});

	it('finds a timing run that waits, by the pid its ticket carries', () => {
		const folder = queue();
		const ticket = (pid: number, suffix: string) => {
			writeFileSync(join(folder, 'heavy-tickets', `1750000000.${pid}.${suffix}`), '');
			return () => rmSync(join(folder, 'heavy-tickets', `1750000000.${pid}.${suffix}`));
		};
		const gone = ticket(999999, 'q');
		expect(quietQueueRunWaiting(folder)).toBe(false);
		gone();
		// Only a timing run's ticket counts: CPU-only work does not open the window.
		const cpu = ticket(process.pid, 'c');
		expect(quietQueueRunWaiting(folder)).toBe(false);
		cpu();
		const timing = ticket(process.pid, 'q');
		expect(quietQueueRunWaiting(folder)).toBe(true);
		timing();
	});

	it('finds a timing run that holds a slot, until its window is closed', () => {
		const folder = queue();
		const slot = join(folder, 'heavy-slots', '1');
		mkdirSync(slot);
		writeFileSync(join(slot, 'quiet'), '');
		writeFileSync(join(slot, 'pid'), `${process.pid}\n`);
		expect(quietQueueRunWaiting(folder)).toBe(true);
		// A run whose window the queue closed counts as a normal run, so it stands behind nothing.
		writeFileSync(join(slot, 'window-closed'), 'no quiet minute in ten minutes');
		expect(quietQueueRunWaiting(folder)).toBe(false);
	});
});

describe('the tools that build or drive a browser', () => {
	it(
		'refuse to start while a marker stands, before they do any work',
		() => {
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
		},
		scaledBudget(60_000),
	);
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
		['tools/build-basis-transcoder.ts', 'async function main()', null],
		['tools/build-ufbx.ts', 'async function main()', null],
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
