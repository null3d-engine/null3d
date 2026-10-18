// The pixels of an image test page's frame, which specs that measure a look read: the frame that
// the engine reads back, as colors from 0 to 1, with helpers that average and compare regions.
import { expect, type Page } from '@playwright/test';
import { pageResult } from './page-result.ts';

/** What an image test page publishes when it holds its frame. */
interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

/** A frame's pixels. */
export interface Image {
	width: number;
	height: number;
	/** Each pixel's red, green and blue, from 0 to 1. */
	rgb: Float32Array;
}

export type Vec3 = readonly [number, number, number];

/** The frame that the image test page at `path` holds, after the page draws it without error. */
export async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	const rgb = new Float32Array((pixels.length / 4) * 3);
	for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3)
		for (let c = 0; c < 3; c++) rgb[j + c] = (pixels[i + c] ?? 0) / 255;
	return { width: frame.width, height: pixels.length / 4 / frame.width, rgb };
}

/** The page of a run with `query` added to its sketch's address. */
export function variant(path: string, sketch: string, query: string): string {
	expect(path).toContain(sketch);
	return path.replace(sketch, `${sketch}${encodeURIComponent(query)}`);
}

/** The mean difference of color between two images over `pixels`, from 0 to 1 per channel. */
export function difference(a: Image, b: Image, pixels: readonly number[]): number {
	let sum = 0;
	for (const p of pixels)
		for (let c = 0; c < 3; c++) sum += Math.abs((a.rgb[3 * p + c] ?? 0) - (b.rgb[3 * p + c] ?? 0));
	return sum / (3 * pixels.length);
}

/** The mean color over `pixels`. */
export function meanOf(image: Image, pixels: readonly number[]): Vec3 {
	let [r, g, b] = [0, 0, 0];
	for (const p of pixels) {
		r += image.rgb[3 * p] ?? 0;
		g += image.rgb[3 * p + 1] ?? 0;
		b += image.rgb[3 * p + 2] ?? 0;
	}
	return [r / pixels.length, g / pixels.length, b / pixels.length];
}

/** The brightness of pixel `p`, with the Rec. 709 weights. */
export const luma = (image: Image, p: number) =>
	0.2126 * (image.rgb[3 * p] ?? 0) +
	0.7152 * (image.rgb[3 * p + 1] ?? 0) +
	0.0722 * (image.rgb[3 * p + 2] ?? 0);

/** The pixels of the rectangle from `left`, `top` to `right`, `bottom`, as shares of the image. */
export function regionOf(
	image: Image,
	left: number,
	top: number,
	right: number,
	bottom: number,
): number[] {
	const pixels: number[] = [];
	for (let y = Math.floor(top * image.height); y < bottom * image.height; y++)
		for (let x = Math.floor(left * image.width); x < right * image.width; x++)
			pixels.push(y * image.width + x);
	return pixels;
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

/** A perspective camera, as a sketch places it: its vertical field of view in degrees. */
export interface CameraPlace {
	fov: number;
	position: Vec3;
	target: Vec3;
}

/** Where a point lands in an image of `width` by `height` pixels, in pixels from the top left. */
export function project(
	camera: CameraPlace,
	point: Vec3,
	width: number,
	height: number,
): { x: number; y: number } {
	const { fov, position, target } = camera;
	const forward = unit(sub(target, position));
	const right = unit(cross(forward, [0, 1, 0]));
	const up = cross(right, forward);
	const relative = sub(point, position);
	const depth = dot(relative, forward);
	const scale = 1 / Math.tan((fov * Math.PI) / 360);
	const ndcX = (dot(relative, right) * scale) / (depth * (width / height));
	const ndcY = (dot(relative, up) * scale) / depth;
	return { x: (ndcX * 0.5 + 0.5) * width, y: (0.5 - ndcY * 0.5) * height };
}
