// Starts the engine in hold mode with the sky layer held sketch, which installs the layer during
// its setup as an example add-on does, and reads the held frame's pixels: the mirror sphere's
// middle and the rough sphere's front. ?layer=off starts the same scene without the layer, and the
// sketch reads that switch from its own address. Both spheres show the layer only if a held
// frame's map holds it and the diffuse light follows it.
import { createEngine, type HoldResult } from '@null3d/engine';
import { progress, run } from './lib/result';

const [WIDTH, HEIGHT] = [480, 270];
/** The sketch time that hold mode holds at, as the aurora demo's own image test does. */
const HOLD = 1.5;
/** The camera's field of view and distance, and where the sketch puts each sphere. */
const FOV = 40;
const DISTANCE = 6;
const MIRROR: [number, number] = [-1.2, 0];
const ROUGH: [number, number] = [1.2, 0];

/** The pixel of a point of the spheres' plane. */
function pixel([x, y]: [number, number]): [number, number] {
	const half = Math.tan(((FOV / 2) * Math.PI) / 180) * DISTANCE;
	const aspect = WIDTH / HEIGHT;
	return [
		Math.round(((x / (half * aspect) + 1) / 2) * WIDTH),
		Math.round(((1 - y / half) / 2) * HEIGHT),
	];
}

/** The mean color of the 5 x 5 pixels around `at`. */
function mean(pixels: Uint8Array, [px, py]: [number, number]): number[] {
	const sum = [0, 0, 0];
	for (let y = py - 2; y <= py + 2; y++)
		for (let x = px - 2; x <= px + 2; x++)
			for (let c = 0; c < 3; c++)
				sum[c] = (sum[c] as number) + (pixels[(y * WIDTH + x) * 4 + c] as number);
	return sum.map((s) => s / 25);
}

run('sky-layer-held', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const layer = new URLSearchParams(location.search).get('layer') !== 'off';
	const sketch = new URL('./sketches/sky-layer-held-sketch.ts', import.meta.url);
	if (!layer) sketch.searchParams.set('layer', 'off');
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1, hold: HOLD });
	progress('the held frame');
	const held = (globalThis as { __null3dHold?: HoldResult }).__null3dHold;
	if (held === undefined) throw new Error('the engine published no held frame');
	if (!held.ok) throw new Error(`hold mode failed: ${held.error}`);
	const { width, height, pixels, frame } = held;
	if (width !== WIDTH || height !== HEIGHT) throw new Error(`a held frame of ${width} x ${height}`);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		layer,
		hold: held.time,
		frame,
		mirror: mean(pixels, pixel(MIRROR)),
		rough: mean(pixels, pixel(ROUGH)),
	};
});
