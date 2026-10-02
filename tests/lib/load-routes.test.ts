import { describe, expect, it } from 'bun:test';
import {
	downloadsPath,
	fillRunner,
	loadedFile,
	loadOf,
	loadPath,
	parseDownloadsPath,
	parseLoadPath,
	runnerKey,
	takeDownloads,
} from './load-routes.ts';

describe('load addresses', () => {
	it('puts a load under its kind and key, and reads the file path back without its query', () => {
		const path = loadPath({ kind: 'cold', key: 'run1.ipad-safari.pipelined-cold-1' }, 'x');
		expect(path).toBe('/__null3d/load/cold/run1.ipad-safari.pipelined-cold-1/x');
		const page = loadPath({ kind: 'warm', key: 'k' }, 'tests/pages/engine.html?seconds=0.2');
		expect(parseLoadPath(page)).toEqual({
			kind: 'warm',
			key: 'k',
			path: 'tests/pages/engine.html',
		});
		expect(parseLoadPath('/__null3d/load/cold/k/assets/null3d_bg-Bt249kqm.wasm')).toEqual({
			kind: 'cold',
			key: 'k',
			path: 'assets/null3d_bg-Bt249kqm.wasm',
		});
		expect(loadOf(page)).toEqual({ kind: 'warm', key: 'k' });
		expect(loadOf('/tests/pages/engine.html')).toBeUndefined();
	});

	it('refuses other kinds, unsafe keys, and paths that could leave the build', () => {
		for (const url of [
			'/__null3d/load/hot/k/tests/pages/engine.html',
			'/__null3d/load/cold/K/tests/pages/engine.html',
			'/__null3d/load/cold/.k/tests/pages/engine.html',
			'/__null3d/load/cold/{run}.{runner}.x/tests/pages/engine.html',
			'/__null3d/load/cold/k/../../package.json',
			'/__null3d/load/cold/k/assets/../engine.html',
			'/__null3d/load/cold/k/.env',
			'/__null3d/load/cold/k//etc/passwd',
			'/__null3d/load/cold/k/',
			'/__null3d/load/cold/k',
			'/__null3d/load/cold/k/%2e%2e/secret',
			'/__null3d/loaded/cold/k/x',
		])
			expect(parseLoadPath(url)).toBeUndefined();
	});

	it('names the downloads of a load, and reads the load back', () => {
		const load = { kind: 'cold', key: 'a.b-1' } as const;
		expect(downloadsPath(load)).toBe('/__null3d/downloads/cold/a.b-1');
		expect(parseDownloadsPath(downloadsPath(load))).toEqual(load);
		expect(parseDownloadsPath('/__null3d/downloads/cold/a.b-1/more')).toBeUndefined();
		expect(parseDownloadsPath('/__null3d/downloads/lukewarm/a')).toBeUndefined();
		expect(parseDownloadsPath('/__null3d/load/cold/a/x')).toBeUndefined();
	});

	it('fills in the run and the runner, so each runner loads under keys of its own', () => {
		const template = loadPath({ kind: 'cold', key: runnerKey('pipelined-cold-1') }, 'p.html');
		expect(template).toBe('/__null3d/load/cold/{run}.{runner}.pipelined-cold-1/p.html');
		const filled = fillRunner(template, '20260930-101530-startup', 'ipad-safari');
		expect(filled).toBe(
			'/__null3d/load/cold/20260930-101530-startup.ipad-safari.pipelined-cold-1/p.html',
		);
		expect(parseLoadPath(filled)?.key).toBe('20260930-101530-startup.ipad-safari.pipelined-cold-1');
		expect(fillRunner('/tests/pages/engine.html?seconds=2', 'r', 'n')).toBe(
			'/tests/pages/engine.html?seconds=2',
		);
	});

	it("fills in the item's own name, as a page that posts its progress names its record", () => {
		expect(
			fillRunner('/p.html?progress=/__null3d/runs/{run}/{runner}/{item}.progress', 'r', 'n', 'i-2'),
		).toBe('/p.html?progress=/__null3d/runs/r/n/i-2.progress');
	});

	it('reads the build file of a load address, even before the runner fills in its key', () => {
		const template = loadPath({ kind: 'warm', key: runnerKey('bench') }, 'bench/pages/a.html?n=2');
		expect(loadedFile(template)).toBe('bench/pages/a.html');
		expect(loadedFile(fillRunner(template, 'r', 'n'))).toBe('bench/pages/a.html');
		expect(loadedFile('/bench/pages/a.html?n=2')).toBeUndefined();
	});

	it("asks the server for a load's downloads, and fails when the server cannot tell", async () => {
		const asked: string[] = [];
		const sent = { requests: 1, bytes: 205, files: [] };
		const answer = (status: number) => async (url: string) => {
			asked.push(url);
			return new Response(JSON.stringify(sent), { status });
		};
		const load = { kind: 'warm', key: 'w' } as const;
		expect(await takeDownloads(load, 'https://localhost:5174', answer(200))).toEqual(sent);
		expect(asked).toEqual(['https://localhost:5174/__null3d/downloads/warm/w']);
		await expect(takeDownloads(load, '', answer(404))).rejects.toThrow(
			'the server did not tell the downloads of w (HTTP 404)',
		);
	});
});
