import { describe, expect, it } from 'bun:test';
import {
	changedShare,
	edgeOffset,
	shadowFactors,
	stabilityFigures,
	stairSteps,
} from '../pages/lib/shadow-check.ts';

const [WIDTH, HEIGHT] = [40, 30];

/** A frame whose shadow covers each pixel left of `edgeAt(y)`, blurred over `blur` pixels. */
function frame(edgeAt: (y: number) => number, blur = 2): Float32Array {
	const out = new Float32Array(WIDTH * HEIGHT);
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++)
			out[y * WIDTH + x] = Math.min(1, Math.max(0, (x + 0.5 - edgeAt(y)) / blur + 0.5));
	return out;
}

describe('the shadow check figures', () => {
	it('read the shadow factor from the red channel', () => {
		expect([...shadowFactors(Uint8Array.from([0, 9, 9, 255, 255, 0, 0, 255]))]).toEqual([0, 1]);
	});

	it('count the pixels whose shadow changed by more than the dithering', () => {
		const still = frame(() => 20);
		expect(
			changedShare(
				still,
				frame(() => 20),
			),
		).toBe(0);
		// An edge that moved by one pixel changes the three pixels of each row that its blur covers.
		expect(
			changedShare(
				still,
				frame(() => 21),
			),
		).toBeCloseTo(3 / WIDTH);
		const figures = stabilityFigures([still, frame(() => 20), frame(() => 21)]);
		expect(figures.changedPercent).toBeCloseTo((100 * 3) / WIDTH);
		expect(figures.meanChangedPercent).toBeCloseTo((100 * 1.5) / WIDTH);
		expect(figures.shadowedPercent).toBeCloseTo(50);
	});

	it('measure how far edges stray from the reference, whatever their blur', () => {
		const straight = (y: number) => 10 + y * 0.6;
		const reference = frame(straight, 1);
		expect(edgeOffset(frame(straight, 4), reference, WIDTH)).toBe(0);
		// Steps of 4 pixels move the edge by up to 2 pixels from the straight line.
		const stepped = frame((y) => 10 + Math.floor((y * 0.6) / 4 + 0.5) * 4);
		expect(edgeOffset(stepped, reference, WIDTH)).toBeGreaterThan(0.5);
	});

	it('measure the stair steps of a straight edge in a box', () => {
		const box = [0, 0, WIDTH, HEIGHT] as const;
		const straight = stairSteps(
			frame((y) => 10 + y * 0.6),
			WIDTH,
			box,
		);
		expect(straight.rows).toBe(HEIGHT);
		expect(straight.rmsPixels).toBeLessThan(1e-6);
		const stepped = stairSteps(
			frame((y) => 10 + Math.floor((y * 0.6) / 4) * 4),
			WIDTH,
			box,
		);
		expect(stepped.rmsPixels).toBeGreaterThan(1);
		expect(stepped.maxPixels).toBeGreaterThan(stepped.rmsPixels);
		// Rows where nothing crosses one half find no edge.
		expect(stairSteps(new Float32Array(WIDTH * HEIGHT), WIDTH, box).rows).toBe(0);
	});
});
