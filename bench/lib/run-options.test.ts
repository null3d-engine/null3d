import { describe, expect, test } from 'bun:test';
import { parseBenchArgs } from '../run';
import { BENCH_SCENES, isMatchScene, MATCH_PAGES, pagePath, RUN_SCENES } from './parity';

describe('the benchmark run options', () => {
	test('run a match scene in a browser without its frame cap', () => {
		const options = parseBenchArgs(['--scenes', 'desert']);
		expect(options.scenes).toEqual(['desert']);
		expect(options.uncapped).toBe(true);
		expect(parseBenchArgs(['--scenes', 's1']).uncapped).toBe(false);
		expect(parseBenchArgs(['--scenes', 's1', '--uncapped']).uncapped).toBe(true);
	});

	test('run a match scene in the protocol only', () => {
		expect(() => parseBenchArgs(['--scenes', 'desert', '--sweep'])).toThrow(
			'--sweep: desert runs in the protocol only',
		);
		expect(() => parseBenchArgs(['--scenes', 'desert', '--jobs', '1,2'])).toThrow(
			'--jobs: desert runs in the protocol only',
		);
		expect(() =>
			parseBenchArgs(['--scenes', 'desert', '--compare', 'a,b', '--pages', 'null3d-webgpu']),
		).toThrow('--compare: desert runs in the protocol only');
	});

	test('refuse a page that a match scene does not have', () => {
		expect(() => parseBenchArgs(['--scenes', 'desert', '--pages', 'threejs-webgl'])).toThrow(
			'--pages: desert has the pages threejs-webgpu and null3d-webgpu only; leave out threejs-webgl',
		);
		expect(parseBenchArgs(['--scenes', 'desert', '--pages', 'null3d-webgpu']).pages).toEqual([
			'null3d-webgpu',
		]);
	});

	test('take the desert scene options as page switches', () => {
		expect(
			parseBenchArgs(['--scenes', 'desert', '--switches', 'view=aerial&shadows=3']).switches,
		).toBe('view=aerial&shadows=3');
	});
});

describe('the match scenes', () => {
	test('stay out of the scenes that the image tests, parity and the comparison of builds read', () => {
		for (const scene of RUN_SCENES)
			expect(isMatchScene(scene)).toBe(!(BENCH_SCENES as readonly string[]).includes(scene));
	});

	test('open the three.js page first in each round, then null3D', () => {
		expect(MATCH_PAGES.desert).toEqual(['threejs-webgpu', 'null3d-webgpu']);
		expect(pagePath('desert', 'threejs-webgpu', 'view=aerial')).toBe(
			'/bench/pages/threejs/desert.html?renderer=webgpu&view=aerial',
		);
		expect(pagePath('desert', 'null3d-webgpu')).toBe('/bench/pages/null3d/desert.html?gpu=webgpu');
	});
});
