// A click on an in-world screen, in a live engine. The page holds a plane that fills the view, whose
// first texture coordinates run across a 256 x 144 display. The test asks the sketch for the canvas
// point of a texel, clicks there, and the sketch reports the texel that the engine's hit landed on.
// A click must reach the display's own space on both GPU paths, without the sketch working out where
// the plane lies in the world.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** A texel of the display, the canvas point at its centre, and that point in the world. */
interface Aimed {
	texel: [number, number];
	x: number;
	y: number;
	world: [number, number, number];
}

/** What a click on the display reported. */
interface Clicked {
	texel: [number, number];
	uv: [number, number];
	point: [number, number, number];
}

/** How long a test waits for the page to start and for the handlers to run. */
const WAIT_MS = 60_000;

/** Opens the page, and returns a function that asks the sketch a question and gives its reply. */
async function open(page: Page, tier: string) {
	await page.goto(`uv-pick.html?gpu=${tier}`);
	const result = await pageResult<{ ok: boolean; error?: string }>(page, WAIT_MS);
	expect(result.error).toBeUndefined();
	return <T>(message: string) =>
		page.evaluate(
			(m) => (globalThis as { uvPick?: (m: string) => Promise<unknown> }).uvPick?.(m) as Promise<T>,
			message,
		);
}

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`a click on an in-world screen lands on the texel under it, on ${tier}`, async ({
		page,
	}) => {
		const ask = await open(page, tier);
		const aims = await ask<Aimed[]>('aims');
		expect(aims.length).toBe(8);
		for (const aim of aims) await page.mouse.click(aim.x, aim.y);
		// A click's handlers run in the frame after its event.
		let clicks: Clicked[] = [];
		await expect
			.poll(
				async () => {
					clicks = await ask<Clicked[]>('clicks');
					return clicks.length;
				},
				{ timeout: WAIT_MS },
			)
			.toBe(aims.length);
		const wrong: string[] = [];
		for (let i = 0; i < aims.length; i++) {
			const aim = aims[i] as Aimed;
			const click = clicks[i] as Clicked;
			if (click.texel[0] !== aim.texel[0] || click.texel[1] !== aim.texel[1])
				wrong.push(
					`clicking the canvas at ${aim.x.toFixed(1)}, ${aim.y.toFixed(1)} for texel ${aim.texel} landed on texel ${click.texel} at uv ${click.uv.map((v) => v.toFixed(4))}`,
				);
			// One texel is 0.094 m across, so the hit stays inside the aimed texel.
			else if (
				Math.abs(click.point[0] - aim.world[0]) > 0.094 ||
				Math.abs(click.point[1] - aim.world[1]) > 0.094
			)
				wrong.push(`texel ${aim.texel} reported the point ${click.point}, not ${aim.world}`);
		}
		expect(wrong).toEqual([]);
	});
