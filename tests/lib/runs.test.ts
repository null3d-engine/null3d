import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../real-browsers.ts';
import { benchPlan, checksPlan, judge, NONE_MISSING, PLANS, parityPlan } from './plans.ts';

/** A browser may lack WebGPU, and must have WebGL2. */
const NO_WEBGPU = { webgpu: true, webgl2: false };

import { batchTimeoutMs, type ItemResult, runName, turnBatches } from './runs.ts';

describe('turnBatches', () => {
	it('lets one browser per device run at a time, in the order given', () => {
		const runners = [
			{ name: 'mac-safari', device: 'mac' },
			{ name: 'mac-brave-browser', device: 'mac' },
			{ name: 'sm-s926b-chrome', device: 'sm-s926b' },
			{ name: 'sm-s926b-chrome-beta', device: 'sm-s926b' },
			{ name: 'ipad-safari', device: 'ipad' },
		];
		expect(turnBatches(runners)).toEqual([
			['mac-safari', 'sm-s926b-chrome', 'ipad-safari'],
			['mac-brave-browser', 'sm-s926b-chrome-beta'],
		]);
	});
});

describe('runName', () => {
	it('sorts by time and is safe as a folder name', () => {
		expect(runName('checks', new Date('2026-09-27T10:15:30.123Z'))).toBe('20260927-101530-checks');
	});
});

describe('the checks plan', () => {
	const items = checksPlan();

	it('has unique item names and pages on the test pages path', () => {
		expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
		for (const item of items) expect(item.path.startsWith('/tests/pages/')).toBe(true);
		expect(items.map((item) => item.id)).toContain('engine-webgl2-single-threaded');
		expect(batchTimeoutMs({ run: 'r', createdAt: '', items })).toBeGreaterThan(
			items.length * 30_000,
		);
	});

	it('skips a WebGPU page on a browser without WebGPU only when allowed', () => {
		const webgpu = items.find((item) => item.id === 'clear-webgpu');
		const webgl2 = items.find((item) => item.id === 'clear-webgl2');
		if (!webgpu || !webgl2) throw new Error('the plan lacks the clear pages');
		const missing = {
			ok: false,
			error: 'E1301: no usable GPU path for ?gpu=webgpu in this browser.',
		};
		expect(judge(webgpu.check, missing, NO_WEBGPU)).toBe('skip');
		expect(judge(webgpu.check, missing, NONE_MISSING)).toEqual([missing.error]);
		expect(judge(webgl2.check, { ok: false, error: 'no WebGPU adapter' }, NO_WEBGPU)).toEqual([
			'no WebGPU adapter',
		]);
	});

	it('skips a WebGL2 page, and the shaders page, on a browser without WebGL2 only when allowed', () => {
		const webgl2 = items.find((item) => item.id === 'engine-webgl2-pipelined');
		const shaders = items.find((item) => item.id === 'shaders');
		const webgpu = items.find((item) => item.id === 'clear-webgpu');
		if (!webgl2 || !shaders || !webgpu) throw new Error('the plan lacks the pages');
		const noWebGL2 = { webgpu: false, webgl2: true };
		const engineMissing = {
			ok: false,
			error: 'E1301: no usable GPU path for ?gpu=webgl2 in this browser.',
		};
		expect(judge(webgl2.check, engineMissing, noWebGL2)).toBe('skip');
		expect(judge(webgl2.check, engineMissing, NONE_MISSING)).toEqual([engineMissing.error]);
		const pageMissing = { ok: false, error: 'no WebGL2 context' };
		expect(judge(shaders.check, pageMissing, noWebGL2)).toBe('skip');
		expect(judge(shaders.check, pageMissing, NO_WEBGPU)).toEqual([pageMissing.error]);
		expect(judge(webgpu.check, pageMissing, noWebGL2)).toEqual([pageMissing.error]);
	});

	it('judges isolation from the page result', () => {
		const isolation = items.find((item) => item.id === 'isolation');
		if (!isolation) throw new Error('the plan lacks the isolation page');
		expect(
			judge(isolation.check, { ok: true, crossOriginIsolated: true, threaded: true }, NONE_MISSING),
		).toEqual([]);
		expect(
			judge(
				isolation.check,
				{ ok: true, crossOriginIsolated: false, threaded: false },
				NONE_MISSING,
			),
		).toEqual(['the page is not cross-origin isolated', 'the threaded build did not load']);
	});
});

describe('the parity plan', () => {
	const items = parityPlan();
	const item = (id: string) => {
		const found = items.find((candidate) => candidate.id === id);
		if (!found) throw new Error(`the plan lacks ${id}`);
		return found;
	};
	/** A hold page's result: a small frame of one color, as the benchmark pages publish it. */
	const holdResult = (rgb: number[], extra: Record<string, unknown> = {}): ItemResult => {
		const size = 16;
		const pixels = new Uint8Array(size * size * 4);
		for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
		return {
			ok: true,
			scene: 's1',
			n: 1000,
			width: size,
			height: size,
			pixels: Buffer.from(pixels).toString('base64'),
			...extra,
		};
	};
	const THREE_WEBGPU = 'parity-s1-threejs-webgpu';
	const NULL3D_WEBGPU = 'parity-s1-null3d-webgpu';

	it('opens every hold page once and pairs each null3d page with three.js on its tier', () => {
		expect(PLANS.parity).toBe(parityPlan);
		expect(items).toHaveLength(12);
		expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
		for (const { path } of items) expect(path).toMatch(/^\/bench\/pages\/.+\.html\?.+&hold$/);
		const pairs = items.flatMap(({ id, check }) =>
			check.kind === 'parity' ? [`${id} ${check.pair.reference}`] : [],
		);
		expect(pairs).toEqual(
			['s1', 's1-static', 's2'].flatMap((scene) => [
				`parity-${scene}-null3d-webgpu threejs-webgpu`,
				`parity-${scene}-null3d-webgl2 threejs-webgl`,
			]),
		);
		expect(item('parity-s2-null3d-webgl2').path).toBe(
			'/bench/pages/null3d/s2.html?gpu=webgl2&hold',
		);
	});

	it('passes a three.js page with a frame, and skips it without WebGPU only when allowed', () => {
		const { check } = item(THREE_WEBGPU);
		expect(judge(check, holdResult([10, 20, 30]), NONE_MISSING)).toEqual([]);
		expect(judge(check, holdResult([10, 20, 30], { pixels: 'AAAA' }), NONE_MISSING)).toEqual([
			'the frame holds 3 bytes, not the 1024 that 16 x 16 RGBA8 pixels need',
		]);
		const fellBack = {
			ok: false,
			error: 'three.js could not start WebGPU and switched to WebGL 2. See the console.',
		};
		expect(judge(check, fellBack, NO_WEBGPU)).toBe('skip');
		expect(judge(check, fellBack, NONE_MISSING)).toEqual([fellBack.error]);
		const noGpu = { ok: false, error: 'This browser has no WebGPU. Use ?renderer=webgl.' };
		expect(judge(item('parity-s1-threejs-webgl').check, noGpu, NO_WEBGPU)).toEqual([noGpu.error]);
	});

	it('compares a null3d frame with the three.js frame of its tier from the same run', () => {
		const imageDir = mkdtempSync(join(tmpdir(), 'null3d-parity-'));
		try {
			const results: Record<string, ItemResult> = { [THREE_WEBGPU]: holdResult([10, 20, 30]) };
			const context = { resultOf: (id: string) => results[id], imageDir };
			const { check } = item(NULL3D_WEBGPU);
			expect(judge(check, holdResult([10, 20, 30]), NONE_MISSING, context)).toEqual([]);
			const name = 's1-null3d-webgpu-vs-threejs-webgpu';
			const images = [`${name}-inputs.png`, `${name}-diff.png`];
			expect(readdirSync(imageDir).sort()).toEqual([...images].sort());
			expect(judge(check, holdResult([200, 20, 30]), NONE_MISSING, context)).toEqual([
				`against ${THREE_WEBGPU}, 100.000% of pixels differ; three.js's rule allows under 0.1%. Images: ${images.map((file) => join(imageDir, file)).join(', ')}`,
			]);
		} finally {
			rmSync(imageDir, { recursive: true, force: true });
		}
	});

	it('falls back to the stored baseline where three.js cannot draw with both renderers', () => {
		const imageDir = mkdtempSync(join(tmpdir(), 'null3d-parity-'));
		try {
			const THREE_WEBGL = 'parity-s1-threejs-webgl';
			// Only the WebGL page drew: the device has no WebGPU.
			const results: Record<string, ItemResult> = {
				[THREE_WEBGL]: holdResult([10, 20, 30]),
				[THREE_WEBGPU]: { ok: false, error: 'This browser has no WebGPU' },
			};
			const { check } = item('parity-s1-null3d-webgl2');
			// A quarter of the frame differs: over three.js's rule, under a stored 30%.
			const quarter = holdResult([10, 20, 30]);
			const pixels = Buffer.from(quarter.pixels as string, 'base64');
			for (let i = 0; i < pixels.length / 4; i += 4) pixels[i] = 200;
			const frame = { ...quarter, pixels: pixels.toString('base64') };
			const resultOf = (id: string) => results[id];
			expect(judge(check, frame, NO_WEBGPU, { resultOf, imageDir })).toHaveLength(1);
			expect(
				judge(check, frame, NO_WEBGPU, { resultOf, imageDir, storedBaselines: { s1: 0.3 } }),
			).toEqual([]);
			const [problem] = judge(check, frame, NO_WEBGPU, {
				resultOf,
				imageDir,
				storedBaselines: { s1: 0.1 },
			}) as string[];
			expect(problem).toContain(
				"25.000% of pixels differ; three.js's rule allows under 0.1%, and three.js's two renderers differ by 10.000%, in bench/parity-baselines.json from a device that draws with both",
			);
		} finally {
			rmSync(imageDir, { recursive: true, force: true });
		}
	});

	it('says what is missing when a frame cannot be compared', () => {
		const { check } = item(NULL3D_WEBGPU);
		const frame = holdResult([10, 20, 30]);
		const withReference = (reference: ItemResult | undefined) => ({
			resultOf: (id: string) => (id === THREE_WEBGPU ? reference : undefined),
			imageDir: join(tmpdir(), 'null3d-parity-unused'),
		});
		const noReference = [`no result from ${THREE_WEBGPU} to compare with`];
		expect(judge(check, frame, NONE_MISSING)).toEqual(noReference);
		expect(judge(check, frame, NONE_MISSING, withReference(undefined))).toEqual(noReference);
		expect(
			judge(
				check,
				frame,
				NONE_MISSING,
				withReference({ ok: false, error: 'no result within 60 s' }),
			),
		).toEqual([`${THREE_WEBGPU} has no frame to compare with: no result within 60 s`]);
		expect(
			judge(check, holdResult([10, 20, 30], { n: 10 }), NONE_MISSING, withReference(frame)),
		).toEqual(['the pages drew different object counts: 10 and 1000']);
		expect(judge(check, { ok: false, error: 'no result within 60 s' }, NONE_MISSING)).toEqual([
			'no result within 60 s',
		]);
	});
});

describe('the bench plan', () => {
	it('runs each page five times by default, and the pages take turns run by run', () => {
		const items = benchPlan();
		expect(items).toHaveLength(25);
		expect(items.slice(0, 5).map((item) => item.id)).toEqual([
			'bench-s1-null3d-webgpu-1',
			'bench-s1-null3d-webgl2-1',
			'bench-s1-threejs-webgpu-1',
			'bench-s1-threejs-webgl-1',
			'bench-s1-scene-code-1',
		]);
		expect(items.at(-1)?.id).toBe('bench-s1-scene-code-5');
	});

	it('takes the number of runs and the instance count', () => {
		const items = benchPlan({ runs: 2, count: 1000 });
		expect(items).toHaveLength(10);
		expect(items.every((item) => item.path.endsWith('n=1000'))).toBe(true);
	});
});

describe('parseArgs', () => {
	it('reads the plan, the flags, the device lists and the macOS apps', () => {
		expect(
			parseArgs([
				'--allow-no-webgpu',
				'--android',
				'chrome,brave',
				'--lan',
				'ipad-safari',
				'Safari',
			]),
		).toEqual({
			plan: 'checks',
			missing: { webgpu: true, webgl2: false },
			mac: ['Safari'],
			android: ['chrome', 'brave'],
			lan: ['ipad-safari'],
		});
		expect(parseArgs(['--allow-no-webgl2', 'Firefox']).missing).toEqual({
			webgpu: false,
			webgl2: true,
		});
		expect(parseArgs(['--plan', 'bench', '--n', '30000', 'Safari']).count).toBe(30000);
		expect(parseArgs(['--plan', 'bench', '--runs', '3', 'Safari']).runs).toBe(3);
		expect(parseArgs(['--plan', 'scale', '--android', 'chrome']).plan).toBe('scale');
		expect(() => parseArgs(['--n', 'many'])).toThrow('--n: use a whole number above 0');
		expect(() => parseArgs(['--runs', '0'])).toThrow('--runs: use a whole number above 0');
		expect(() => parseArgs(['--plan', 'nothing'])).toThrow('no plan named nothing');
		expect(() => parseArgs(['--fast'])).toThrow('unknown option --fast');
	});
});
