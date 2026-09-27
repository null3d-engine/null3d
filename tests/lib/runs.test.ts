import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../real-browsers.ts';
import { checksPlan, judge, PLANS, parityPlan } from './plans.ts';
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
		expect(judge(webgpu.check, missing, true)).toBe('skip');
		expect(judge(webgpu.check, missing, false)).toEqual([missing.error]);
		expect(judge(webgl2.check, { ok: false, error: 'no WebGPU adapter' }, true)).toEqual([
			'no WebGPU adapter',
		]);
	});

	it('judges isolation from the page result', () => {
		const isolation = items.find((item) => item.id === 'isolation');
		if (!isolation) throw new Error('the plan lacks the isolation page');
		expect(
			judge(isolation.check, { ok: true, crossOriginIsolated: true, threaded: true }, false),
		).toEqual([]);
		expect(
			judge(isolation.check, { ok: true, crossOriginIsolated: false, threaded: false }, false),
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
	const SOKKO3D_WEBGPU = 'parity-s1-sokko3d-webgpu';

	it('opens every hold page once and pairs each sokko3d page with three.js on its tier', () => {
		expect(PLANS.parity).toBe(parityPlan);
		expect(items).toHaveLength(12);
		expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
		for (const { path } of items) expect(path).toMatch(/^\/bench\/pages\/.+\.html\?.+&hold$/);
		const pairs = items.flatMap(({ id, check }) =>
			check.kind === 'parity' ? [`${id} ${check.pair.reference}`] : [],
		);
		expect(pairs).toEqual(
			['s1', 's1-static', 's2'].flatMap((scene) => [
				`parity-${scene}-sokko3d-webgpu threejs-webgpu`,
				`parity-${scene}-sokko3d-webgl2 threejs-webgl`,
			]),
		);
		expect(item('parity-s2-sokko3d-webgl2').path).toBe(
			'/bench/pages/sokko3d/s2.html?gpu=webgl2&hold',
		);
	});

	it('passes a three.js page with a frame, and skips it without WebGPU only when allowed', () => {
		const { check } = item(THREE_WEBGPU);
		expect(judge(check, holdResult([10, 20, 30]), false)).toEqual([]);
		expect(judge(check, holdResult([10, 20, 30], { pixels: 'AAAA' }), false)).toEqual([
			'the frame holds 3 bytes, not the 1024 that 16 x 16 RGBA8 pixels need',
		]);
		const fellBack = {
			ok: false,
			error: 'three.js could not start WebGPU and switched to WebGL 2. See the console.',
		};
		expect(judge(check, fellBack, true)).toBe('skip');
		expect(judge(check, fellBack, false)).toEqual([fellBack.error]);
		const noGpu = { ok: false, error: 'This browser has no WebGPU. Use ?renderer=webgl.' };
		expect(judge(item('parity-s1-threejs-webgl').check, noGpu, true)).toEqual([noGpu.error]);
	});

	it('compares a sokko3d frame with the three.js frame of its tier from the same run', () => {
		const imageDir = mkdtempSync(join(tmpdir(), 'sokko3d-parity-'));
		try {
			const results: Record<string, ItemResult> = { [THREE_WEBGPU]: holdResult([10, 20, 30]) };
			const context = { resultOf: (id: string) => results[id], imageDir };
			const { check } = item(SOKKO3D_WEBGPU);
			expect(judge(check, holdResult([10, 20, 30]), false, context)).toEqual([]);
			const name = 's1-sokko3d-webgpu-vs-threejs-webgpu';
			const images = [`${name}-inputs.png`, `${name}-diff.png`];
			expect(readdirSync(imageDir).sort()).toEqual([...images].sort());
			expect(judge(check, holdResult([200, 20, 30]), false, context)).toEqual([
				`against ${THREE_WEBGPU}, 100.000% of pixels differ; three.js's rule allows under 0.1%. Images: ${images.map((file) => join(imageDir, file)).join(', ')}`,
			]);
		} finally {
			rmSync(imageDir, { recursive: true, force: true });
		}
	});

	it('says what is missing when a frame cannot be compared', () => {
		const { check } = item(SOKKO3D_WEBGPU);
		const frame = holdResult([10, 20, 30]);
		const withReference = (reference: ItemResult | undefined) => ({
			resultOf: (id: string) => (id === THREE_WEBGPU ? reference : undefined),
			imageDir: join(tmpdir(), 'sokko3d-parity-unused'),
		});
		const noReference = [`no result from ${THREE_WEBGPU} to compare with`];
		expect(judge(check, frame, false)).toEqual(noReference);
		expect(judge(check, frame, false, withReference(undefined))).toEqual(noReference);
		expect(
			judge(check, frame, false, withReference({ ok: false, error: 'no result within 60 s' })),
		).toEqual([`${THREE_WEBGPU} has no frame to compare with: no result within 60 s`]);
		expect(judge(check, holdResult([10, 20, 30], { n: 10 }), false, withReference(frame))).toEqual([
			'the pages drew different object counts: 10 and 1000',
		]);
		expect(judge(check, { ok: false, error: 'no result within 60 s' }, false)).toEqual([
			'no result within 60 s',
		]);
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
			allowNoWebGPU: true,
			mac: ['Safari'],
			android: ['chrome', 'brave'],
			lan: ['ipad-safari'],
		});
		expect(() => parseArgs(['--plan', 'nothing'])).toThrow('no plan named nothing');
		expect(() => parseArgs(['--fast'])).toThrow('unknown option --fast');
	});
});
