// Two filmstrips that a still cannot draw, for D-274's look bar. The hand-over strip walks the
// camera from before the hand-over band to past it, one frame at a time, and counts each frame's
// pixels off the background. A card that faded as its mesh does would drop the pixels that the
// mesh's dither drops too, and the count would dip by about a quarter inside the band, so the strip
// fails when a middle frame keeps fewer than this share of the ends. The sun strip moves the sun
// around a row of turned pairs, so the meshes and their cards relight together.
//
// The frames are written to target/filmstrip/ for the owner to look at. It runs only with
// NULL3D_IMPOSTOR_STRIP_COST set, on a computer with a GPU of its own, because it draws about
// thirty frames: NULL3D_IMPOSTOR_STRIP_COST=1 bun run test:browser --
// impostor-handover-strip.spec.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { writePng } from '../../packages/cli/src/png.js';
import { pageResult } from '../lib/page-result.ts';

test.skip(
	!process.env.NULL3D_IMPOSTOR_STRIP_COST,
	'set NULL3D_IMPOSTOR_STRIP_COST to draw the filmstrips',
);

/** Where the frames go, from the repository the tests run in. */
const OUT = join(process.cwd(), 'target', 'filmstrip');

/** The camera's distance as a share of the switch distance, from before the band to past it. */
const AT = [0.9, 0.925, 0.95, 0.975, 1.0, 1.025, 1.05, 1.075, 1.1] as const;

/** The sun's turns about the world's up, in degrees. */
const SUN_YAW = [0, 25, 50, 75, 100, 125, 150, 175] as const;

/** The smallest share of its end frames' pixels that a middle frame of the hand-over may keep. */
const KEPT = 0.9;

/** What the image page publishes: the frame's size and its pixels, base64. */
interface FrameResult {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

/** A page's frame as 8-bit RGBA pixels. */
async function frame(
	page: import('@playwright/test').Page,
	sketch: string,
): Promise<{ width: number; height: number; data: Uint8Array }> {
	const query = `gpu=webgpu&hold=0&size=480x270&sketch=${encodeURIComponent(sketch)}`;
	await page.goto(`image.html?${query}`);
	const result = await pageResult<FrameResult>(page, 60_000);
	expect(result.error).toBeUndefined();
	const data = new Uint8Array(Buffer.from(result.pixels, 'base64'));
	return { width: result.width, height: result.height, data };
}

/** The pixels that differ from the frame's top-left corner, which the background fills. */
function off(pixels: { width: number; data: Uint8Array }): number {
	const at = (x: number, y: number) => (y * pixels.width + x) * 4;
	const [r, g, b] = [
		pixels.data[at(2, 2)] ?? 0,
		pixels.data[at(2, 2) + 1] ?? 0,
		pixels.data[at(2, 2) + 2] ?? 0,
	];
	let count = 0;
	for (let i = 0; i < pixels.data.length; i += 4)
		if (
			Math.abs((pixels.data[i] ?? 0) - r) +
				Math.abs((pixels.data[i + 1] ?? 0) - g) +
				Math.abs((pixels.data[i + 2] ?? 0) - b) >
			6
		)
			count++;
	return count;
}

test('the hand-over strip keeps every crown pixel through the band', async ({ page }) => {
	test.setTimeout(240_000);
	mkdirSync(OUT, { recursive: true });
	const sketch = '/tests/pages/sketches/impostor-handover-sketch.ts';
	const counts: { at: number; off: number }[] = [];
	for (const at of AT) {
		const pixels = await frame(page, `${sketch}?at=${at}`);
		writePng(join(OUT, `impostor-handover-${at.toFixed(3)}.png`), pixels);
		counts.push({ at, off: off(pixels) });
	}
	console.log(counts.map((one) => `at ${one.at}: ${one.off} pixels off the ground`).join('\n'));
	// The ends draw the whole tree, as the mesh and as the card; a middle frame that drops a share
	// of them shows a hole.
	const ends = Math.min(counts[0]?.off ?? 0, counts.at(-1)?.off ?? 0);
	for (const middle of counts.slice(1, -1))
		expect(middle.off, `at ${middle.at}`).toBeGreaterThanOrEqual(KEPT * ends);
});

/** The pixels where `pixels` differs from `empty`, which draws the ground and sky alone. */
function shape(
	pixels: { width: number; data: Uint8Array },
	empty: { width: number; data: Uint8Array },
): Uint8Array {
	const mask = new Uint8Array(pixels.data.length / 4);
	for (let i = 0; i < mask.length; i++) {
		const at = i * 4;
		const difference =
			Math.abs((pixels.data[at] ?? 0) - (empty.data[at] ?? 0)) +
			Math.abs((pixels.data[at + 1] ?? 0) - (empty.data[at + 1] ?? 0)) +
			Math.abs((pixels.data[at + 2] ?? 0) - (empty.data[at + 2] ?? 0));
		mask[i] = difference > 6 ? 1 : 0;
	}
	return mask;
}

/** The share of the two shapes' pixels that both cover. */
function overlap(a: Uint8Array, b: Uint8Array): number {
	let both = 0;
	let either = 0;
	for (let i = 0; i < a.length; i++) {
		if (a[i] && b[i]) both++;
		if (a[i] || b[i]) either++;
	}
	return either === 0 ? 0 : both / either;
}

/** The mean absolute difference of two frames' colour over the pixels that either shape covers. */
function difference(a: { data: Uint8Array }, b: { data: Uint8Array }, mask: Uint8Array): number {
	let sum = 0;
	let count = 0;
	for (let i = 0; i < mask.length; i++) {
		if (!mask[i]) continue;
		const at = i * 4;
		sum +=
			Math.abs((a.data[at] ?? 0) - (b.data[at] ?? 0)) +
			Math.abs((a.data[at + 1] ?? 0) - (b.data[at + 1] ?? 0)) +
			Math.abs((a.data[at + 2] ?? 0) - (b.data[at + 2] ?? 0));
		count += 3;
	}
	return count === 0 ? 0 : sum / count;
}

test('the turned band hands over to cards whose crowns match their turn', async ({ page }) => {
	test.setTimeout(240_000);
	const sketch = '/tests/pages/sketches/impostor-handover-sketch.ts';
	mkdirSync(OUT, { recursive: true });
	const empty = await frame(page, `${sketch}?at=0.96&only=none`);
	const mesh = await frame(page, `${sketch}?at=0.96&only=mesh`);
	const card = await frame(page, `${sketch}?at=0.96&only=card`);
	const wrong = await frame(page, `${sketch}?at=0.96&only=card&cardTurn=60`);
	for (const [name, pixels] of Object.entries({ empty, mesh, card, wrong }))
		writePng(join(OUT, `turn-${name}.png`), pixels);
	const meshShape = shape(mesh, empty);
	const cardShape = shape(card, empty);
	const wrongShape = shape(wrong, empty);
	const covered = (mask: Uint8Array) => mask.reduce((sum, one) => sum + one, 0);
	// The crown is each tree's shape above its lowest third, where the card's base band sits.
	const width = mesh.width;
	const seen = new Uint8Array(meshShape.length);
	const crowns: Uint8Array[] = [];
	for (let start = 0; start < meshShape.length; start++) {
		if (!meshShape[start] || seen[start]) continue;
		const stack = [start];
		seen[start] = 1;
		let [left, top, right, bottom] = [width, meshShape.length / width, -1, -1];
		const pixels: number[] = [];
		while (stack.length > 0) {
			const i = stack.pop() as number;
			const [x, y] = [i % width, Math.floor(i / width)];
			[left, top, right, bottom] = [
				Math.min(left, x),
				Math.min(top, y),
				Math.max(right, x),
				Math.max(bottom, y),
			];
			pixels.push(i);
			for (const next of [i - 1, i + 1, i - width, i + width])
				if (next >= 0 && next < meshShape.length && meshShape[next] && !seen[next]) {
					seen[next] = 1;
					stack.push(next);
				}
		}
		const crown = new Uint8Array(meshShape.length);
		const floor = bottom - (bottom - top) * 0.3;
		for (const i of pixels) if (Math.floor(i / width) <= floor) crown[i] = 1;
		crowns.push(crown);
	}
	const crown = new Uint8Array(meshShape.length);
	for (const one of crowns)
		for (let i = 0; i < crown.length; i++) crown[i] = (crown[i] ?? 0) | (one[i] ?? 0);
	console.log(
		[
			`shapes ${covered(meshShape)} mesh, ${covered(cardShape)} card, ${covered(wrongShape)} wrong`,
			`crown ${covered(crown)}`,
			`silhouette ${overlap(cardShape, meshShape).toFixed(4)} correct, ${overlap(wrongShape, meshShape).toFixed(4)} wrong`,
			`crown colour ${difference(card, mesh, crown).toFixed(2)} correct, ${difference(wrong, mesh, crown).toFixed(2)} wrong`,
			`card against wrong ${difference(card, wrong, cardShape).toFixed(2)}`,
		].join('; '),
	);
	// A band that ignores the turn draws the same card twice, so the offset changes nothing.
	expect(difference(card, wrong, cardShape)).toBeGreaterThan(5);
	// The band's own turn matches the mesh better than a turn that is wrong.
	expect(difference(card, mesh, crown)).toBeLessThan(difference(wrong, mesh, crown));
});

test('the sun strip moves the light on the meshes and their cards together', async ({ page }) => {
	test.setTimeout(240_000);
	mkdirSync(OUT, { recursive: true });
	const sketch = '/tests/pages/sketches/impostor-turn-sketch.ts';
	let previous: { width: number; data: Uint8Array } | undefined;
	for (const yaw of SUN_YAW) {
		const pixels = await frame(page, `${sketch}?sunYaw=${yaw}`);
		writePng(join(OUT, `impostor-sun-${yaw}.png`), pixels);
		// Each turn must change the picture: a card baked with its own light would hold still.
		if (previous !== undefined) {
			let changed = 0;
			for (let i = 0; i < pixels.data.length; i++)
				if (pixels.data[i] !== previous.data[i]) changed++;
			expect(changed / pixels.data.length, `at ${yaw} degrees`).toBeGreaterThan(0.01);
		}
		previous = pixels;
	}
});
