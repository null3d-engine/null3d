// Decals mark the surfaces inside their boxes on every tier, and nothing else: the decals test of
// the image test manifest. A decal that draws nowhere, or everywhere, still draws a plausible
// picture, which a new reference could take in. This spec compares places of the yard with the bare
// yard of the same scene, so it fails even before the test has references.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

interface Image {
	width: number;
	height: number;
	/** Each pixel's red, green and blue, from 0 to 1. */
	rgb: Float32Array;
}

type Vec3 = readonly [number, number, number];

/** The decals sketch's camera, as it places it. */
const CAMERA = { fov: 50, position: [0, 4.2, 6.5] as Vec3, target: [0, 0, 0] as Vec3 };

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	const rgb = new Float32Array((pixels.length / 4) * 3);
	for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3)
		for (let c = 0; c < 3; c++) rgb[j + c] = (pixels[i + c] ?? 0) / 255;
	return { width: frame.width, height: pixels.length / 4 / frame.width, rgb };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
	const length = Math.hypot(...a);
	return [a[0] / length, a[1] / length, a[2] / length];
};

/** The pixels of a square `size` pixels across around where a point of the yard lands in the image. */
function around(image: Image, point: Vec3, size = 7): number[] {
	const { fov, position, target } = CAMERA;
	const forward = unit(sub(target, position));
	const right = unit(cross(forward, [0, 1, 0]));
	const up = cross(right, forward);
	const relative = sub(point, position);
	const depth = dot(relative, forward);
	const scale = 1 / Math.tan((fov * Math.PI) / 360);
	const ndcX = (dot(relative, right) * scale) / (depth * (image.width / image.height));
	const ndcY = (dot(relative, up) * scale) / depth;
	const x = Math.round((ndcX * 0.5 + 0.5) * image.width);
	const y = Math.round((0.5 - ndcY * 0.5) * image.height);
	const pixels: number[] = [];
	const half = Math.floor(size / 2);
	for (let dy = -half; dy <= half; dy++)
		for (let dx = -half; dx <= half; dx++) pixels.push((y + dy) * image.width + x + dx);
	return pixels;
}

/** The mean brightness over `pixels`, from 0 to 1. */
function brightness(image: Image, pixels: readonly number[]): number {
	let sum = 0;
	for (const p of pixels)
		sum +=
			0.2126 * (image.rgb[3 * p] ?? 0) +
			0.7152 * (image.rgb[3 * p + 1] ?? 0) +
			0.0722 * (image.rgb[3 * p + 2] ?? 0);
	return sum / pixels.length;
}

test('decals: each decal marks its own place of the yard, and the rest stays bare', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'decals');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const marked = await imageOf(page, run.path);
		expect(run.path).toContain('decals-sketch.ts');
		const bare = await imageOf(
			page,
			run.path.replace('decals-sketch.ts', `decals-sketch.ts${encodeURIComponent('?none')}`),
		);
		const change = (point: Vec3, size?: number) =>
			brightness(marked, around(marked, point, size)) - brightness(bare, around(bare, point, size));
		// The scorch mark darkens the stone, and the road paint brightens it.
		expect.soft(change([-3.2, 0, 1.2]), `${run.id}: the scorch darkens`).toBeLessThan(-0.15);
		expect.soft(change([0.6, 0, 1.2]), `${run.id}: the paint brightens`).toBeGreaterThan(0.1);
		// The first mud splash of the batch darkens its place.
		expect.soft(change([-1.6, 0, 2.6]), `${run.id}: the mud darkens`).toBeLessThan(-0.05);
		// The thin cracks mark the wall over a wider square, and the stone away from every decal
		// stays as it was.
		const wall = change([-2.2, 1.6, -2], 41);
		expect.soft(wall, `${run.id}: the cracks mark the wall`).toBeLessThan(-0.01);
		expect.soft(Math.abs(change([4.2, 0, -1.4])), `${run.id}: bare stone`).toBeLessThan(0.01);
	}
});
