// Where a click on a screen's surface lands on the canvas that painted it. The canvas texture turns
// the canvas's rows over, so a hit's second coordinate runs against the canvas's own down.
import { describe, expect, test } from 'bun:test';
import { canvasPointAt, canvasTexelAt } from './map';

/** A canvas of the shape that a screen usually has. */
const [WIDTH, HEIGHT] = [512, 256];

describe('the point on a canvas that a texture coordinate names', () => {
	test('the bottom-left coordinate is the canvas bottom-left corner', () => {
		expect(canvasPointAt([0, 0], WIDTH, HEIGHT)).toEqual({ x: 0, y: HEIGHT });
	});

	test('the top-right coordinate is the canvas top-right corner', () => {
		expect(canvasPointAt([1, 1], WIDTH, HEIGHT)).toEqual({ x: WIDTH, y: 0 });
	});

	test('the middle coordinate is the canvas middle', () => {
		expect(canvasPointAt([0.5, 0.5], WIDTH, HEIGHT)).toEqual({ x: 256, y: 128 });
	});

	test('the second coordinate runs against the canvas down', () => {
		// A quarter of the way up the surface is three quarters of the way down the canvas.
		expect(canvasPointAt([0.25, 0.25], WIDTH, HEIGHT)).toEqual({ x: 128, y: 192 });
		expect(canvasPointAt([0.75, 0.75], WIDTH, HEIGHT)).toEqual({ x: 384, y: 64 });
	});

	test('a coordinate outside the surface clamps to its edge', () => {
		expect(canvasPointAt([-0.5, 1.5], WIDTH, HEIGHT)).toEqual({ x: 0, y: 0 });
		expect(canvasPointAt([1.5, -0.5], WIDTH, HEIGHT)).toEqual({ x: WIDTH, y: HEIGHT });
	});

	test('a canvas of another shape maps each axis by its own size', () => {
		expect(canvasPointAt([0.5, 0], 1000, 100)).toEqual({ x: 500, y: 100 });
		expect(canvasPointAt([0, 0.5], 1000, 100)).toEqual({ x: 0, y: 50 });
	});
});

describe('the texel of a canvas that a texture coordinate names', () => {
	test('a texel is a whole number inside the canvas', () => {
		expect(canvasTexelAt([0, 0], WIDTH, HEIGHT)).toEqual({ x: 0, y: HEIGHT - 1 });
		expect(canvasTexelAt([1, 1], WIDTH, HEIGHT)).toEqual({ x: WIDTH - 1, y: 0 });
	});

	test('the canvas middle rounds to the texel under the point', () => {
		expect(canvasTexelAt([0.5, 0.5], WIDTH, HEIGHT)).toEqual({ x: 256, y: 128 });
	});

	test('an edge takes the texel inside it', () => {
		expect(canvasTexelAt([1, 0], WIDTH, HEIGHT)).toEqual({ x: WIDTH - 1, y: HEIGHT - 1 });
		expect(canvasTexelAt([0, 1], WIDTH, HEIGHT)).toEqual({ x: 0, y: 0 });
	});

	test('a canvas of one texel always takes that texel', () => {
		expect(canvasTexelAt([0, 0], 1, 1)).toEqual({ x: 0, y: 0 });
		expect(canvasTexelAt([1, 1], 1, 1)).toEqual({ x: 0, y: 0 });
	});

	test('every texel comes from a distinct coordinate inside it', () => {
		const columns = new Set<number>();
		for (let x = 0; x < WIDTH; x++)
			columns.add(canvasTexelAt([(x + 0.5) / WIDTH, 0.5], WIDTH, HEIGHT).x);
		expect(columns.size).toBe(WIDTH);
	});
});
