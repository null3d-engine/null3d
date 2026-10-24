// The temporal resolve's figures against D-129's bar, and its cost on each GPU path and preset
// (tests/pages/taa-quality.ts). It runs only with NULL3D_TAA_QUALITY set, on a computer with a GPU of
// its own: NULL3D_TAA_QUALITY=1 bun run test:browser -- taa-quality.spec.ts --workers=1. The quality
// runs draw 16 consecutive frames at 960 x 540 for each preset and camera, resolve off and on, and
// compare them with the same frames drawn at 3840 x 2160 with MSAA 4x, which is 64 samples per pixel.
// The cost runs play each scene at 1920 x 1080 with the resolve off and on in turns. Each result is
// written under test-results/taa-quality/ for the decision record.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { costTimeout, loadNow, sideLine, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

interface CaseFigure {
	preset: string;
	camera: string;
	taa: boolean;
	effective: string;
	shimmer: number;
	smear: number;
	error: number;
	sharpness: number;
	still: number;
	referenceStill: number;
}

interface QualityResult {
	ok: boolean;
	error?: string;
	scene: string;
	size: [number, number];
	referenceSize: [number, number];
	down: number;
	records: Record<string, { consecutive: boolean }>;
	cases: CaseFigure[];
	failures: string[];
}

interface CostSide {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	threads: Record<string, number | null>;
}

interface CostResult {
	ok: boolean;
	error?: string;
	mode: string;
	scene: string;
	tier: string;
	preset: string;
	off: CostSide;
	on: CostSide;
	failures: string[];
}

/** Writes a result beside the test results, for the decision record. */
function save(name: string, result: unknown): void {
	mkdirSync('test-results/taa-quality', { recursive: true });
	writeFileSync(`test-results/taa-quality/${name}.json`, JSON.stringify(result, null, 2));
}

const presets = (process.env.NULL3D_TAA_PRESETS ?? 'low,medium,high,ultra').split(',');
const scenes = (process.env.NULL3D_TAA_SCENES ?? 'thin,grass').split(',');
const paths = (process.env.NULL3D_TAA_PATHS ?? 'webgpu,webgl2').split(',');
const cameras = (process.env.NULL3D_TAA_CAMERAS ?? 'still,slow,brisk').split(',');
const jitter = process.env.NULL3D_TAA_JITTER === '0' ? '&jitter=0' : '';

for (const gpu of paths)
	for (const scene of scenes)
		test(`${scene} quality on ${gpu}`, async ({ page }) => {
			test.skip(!process.env.NULL3D_TAA_QUALITY, 'set NULL3D_TAA_QUALITY to measure the bar');
			test.setTimeout(1_800_000);
			await page.goto(
				`taa-quality.html?gpu=${gpu}&scene=${scene}&mode=quality&fps=4&cameras=${cameras.join(',')}&presets=${presets.join(',')}${jitter}`,
			);
			const result = await pageResult<QualityResult>(page, 1_700_000);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
			for (const [camera, record] of Object.entries(result.records))
				expect(record.consecutive, `the reference for ${camera} skipped a frame`).toBe(true);
			const lines = result.cases.map(
				(c) =>
					`TAAD "m=${c.taa ? 'on' : 'off'}" ${c.effective} ${c.camera}: shimmer ${c.shimmer.toFixed(3)}, smear ${c.smear.toFixed(3)}, error ${c.error.toFixed(3)}, sharpness ${c.sharpness.toFixed(3)}, still ${c.still.toFixed(3)}`,
			);
			console.log([`TAAD ${scene} on ${gpu}, ${result.cases.length} cases`, ...lines].join('\n'));
			save(`${scene}-${gpu}-quality`, result);
			expect(result.cases).toHaveLength(presets.length * 3 * 2);
		});

for (const gpu of paths)
	for (const scene of scenes)
		for (const preset of presets)
			test(`${scene} cost on ${gpu} at ${preset}`, async ({ page }) => {
				test.skip(!process.env.NULL3D_TAA_QUALITY, 'set NULL3D_TAA_QUALITY to time the resolve');
				test.setTimeout(costTimeout(300_000));
				const loadBefore = await waitForQuiet();
				await page.goto(
					`taa-quality.html?gpu=${gpu}&scene=${scene}&mode=cost&preset=${preset}&size=1920x1080`,
				);
				const result = await pageResult<CostResult>(page, 400_000);
				expect(result.error).toBeUndefined();
				expect(result.failures).toEqual([]);
				const delta =
					result.off.gpuMs === null || result.on.gpuMs === null
						? 'none'
						: (result.on.gpuMs - result.off.gpuMs).toFixed(3);
				console.log(
					[
						`TAADCOST ${scene} ${result.tier} at ${preset} (drawn at ${result.preset}), load ${loadBefore} before and ${loadNow()} after, resolve adds ${delta} ms`,
						sideLine('off', result.off, 3),
						sideLine('on', result.on, 3),
					].join('\n'),
				);
				save(`${scene}-${gpu}-${preset}-cost`, result);
			});
