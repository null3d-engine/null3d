// A held frame holds a sky layer in its environment map, and its own frame keeps the core sky's
// diffuse light. The page installs the layer during its setup, as an example add-on does, and hold
// mode draws one frame at the aurora demo's own hold time. The mirror sphere reflects the map, so
// its green comes from the layer when the map's fill runs in the held frame. The rough sphere takes
// the map's diffuse light, which the GPU captures during that fill and reads back after the frame's
// own list is recorded, so a held frame is lit by the core sky's model: `sky-layer-light` proves the
// light in live frames, where a later frame takes the capture. The same scene without the layer is
// the control, so the green is the layer's rather than the core sky's.
import { expect, type Page, test } from '@playwright/test';
import { pageResultWhileProgressing } from '../lib/page-result.ts';

interface Held {
	tier: string;
	layer: boolean;
	hold: number;
	frame: number;
	mirror: number[];
	rough: number[];
}

/** The held time that the page asks for, and the frame that it gives: 90 steps and the frame. */
const HOLD = 1.5;
const HELD_FRAME = 91;
/** The change of a color that counts as the layer's, in levels of 255. */
const CHANGE = 40;
/** How near the two scenes must agree where the layer does not show, in levels of 255. */
const NEAR = 6;
/** The run fails when its page notes no new step for this long. */
const STALL_MS = 30_000;
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;

/** How green a color is: the green above the mean of red and blue, in levels of 255. */
const green = (color: number[]) =>
	(color[1] as number) - ((color[0] as number) + (color[2] as number)) / 2;

/** Opens the page on `gpu`, with the layer or the scene without it, and reads its held frame. */
async function held(
	page: Page,
	gpu: keyof typeof TIERS,
	layer: boolean,
): Promise<Held & { error?: string }> {
	await page.goto(`sky-layer-held.html?gpu=${gpu}${layer ? '' : '&layer=off'}`);
	return pageResultWhileProgressing<Held & { error?: string }>(page, STALL_MS);
}

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`a held frame's map holds a sky layer, and its frame keeps the core light on ${gpu}`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const withLayer = await held(page, gpu, true);
		const without = await held(page, gpu, false);
		expect(withLayer.error).toBeUndefined();
		expect(without.error).toBeUndefined();
		expect([withLayer.tier, without.tier]).toEqual([TIERS[gpu], TIERS[gpu]]);
		expect([withLayer.hold, withLayer.frame]).toEqual([HOLD, HELD_FRAME]);
		const text = JSON.stringify({ withLayer, without });
		// The mirror reflects the map, and a held frame fills the map whole with the layer in it.
		expect(green(withLayer.mirror) - green(without.mirror), text).toBeGreaterThan(CHANGE);
		expect(Math.abs(green(without.mirror)), text).toBeLessThanOrEqual(NEAR);
		// The rough sphere takes the map's diffuse light, whose capture lands after the held frame's
		// list is recorded, so the layer's green does not reach it in this frame.
		expect(Math.abs(green(withLayer.rough) - green(without.rough)), text).toBeLessThanOrEqual(NEAR);
		console.log(
			`sky layer held on ${gpu}: mirror ${green(withLayer.mirror).toFixed(1)} against ${green(without.mirror).toFixed(1)}, rough ${green(withLayer.rough).toFixed(1)} against ${green(without.rough).toFixed(1)}`,
		);
	});
