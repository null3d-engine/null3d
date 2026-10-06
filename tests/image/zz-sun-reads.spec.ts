// Temporary: the sun's shadow reads of each measurement variant against the build's own reads.
import { expect, test } from '@playwright/test';
import { compareImages } from '../../packages/cli/src/compare.js';
import { loadResult } from '../lib/page-result.ts';
import { manifestRun } from './manifest.ts';

const TESTS = [
	'shadows',
	'shadows-filter-5',
	'shadows-seam',
	'shadows-contact',
	'shadows-contact-far',
];
for (const name of TESTS) {
	test(`sun shadow reads: ${name}`, async ({ page }) => {
		let run: ReturnType<typeof manifestRun>;
		try {
			run = manifestRun(name, 'webgl2');
		} catch {
			test.skip(true, `no ${name}`);
			return;
		}
		const images: Record<string, Uint8Array> = {};
		let size = [0, 0];
		for (const mode of ['grad', 'implicit', 'nearest', 'fetch']) {
			const result = (await loadResult(
				page,
				`${run.path}&render=main&glshadow=${mode}`,
				60_000,
			)) as {
				ok: boolean;
				width: number;
				height: number;
				pixels: string;
				error?: string;
			};
			expect([mode, result.ok, result.error]).toEqual([mode, true, undefined]);
			size = [result.width, result.height];
			images[mode] = new Uint8Array(Buffer.from(result.pixels, 'base64'));
		}
		for (const mode of ['implicit', 'nearest', 'fetch']) {
			const { share } = compareImages(
				{ width: size[0] as number, height: size[1] as number, data: images.grad as Uint8Array },
				{ width: size[0] as number, height: size[1] as number, data: images[mode] as Uint8Array },
				0.1,
			);
			console.log(`${name} ${mode}: ${(share * 100).toFixed(4)}% differ`);
		}
	});
}
