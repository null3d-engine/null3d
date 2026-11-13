import { describe, expect, test } from 'bun:test';
import { blank, type Rgba } from '../lib/plant-review/image.ts';
import { measurePiece } from './piece.ts';
import { disc, empty, HEIGHT, line, WIDTH } from './shapes.fixture.ts';
import { branchFigures, graphOf, thin, turnsOf } from './skeleton.ts';

describe('the wood of a cut branch', () => {
	test('a thick bar thins to one line with two ends', () => {
		const mask = empty();
		line(mask, 100, 200, 300, 200, 9);
		const graph = graphOf(thin(mask, WIDTH, HEIGHT), WIDTH, HEIGHT, 6, 4);
		expect(graph.lines).toHaveLength(1);
		expect(graph.nodes.filter((node) => node.lines === 1)).toHaveLength(2);
		expect(Math.abs((graph.lines[0]?.length ?? 0) - 200)).toBeLessThan(14);
	});

	test('a forked twig has one joint, two tips and no fan', () => {
		const mask = empty();
		line(mask, 200, 380, 200, 220, 7);
		line(mask, 200, 220, 120, 80, 5);
		line(mask, 200, 220, 280, 80, 5);
		const figures = branchFigures(mask, WIDTH, HEIGHT, 300, 160 * 300);
		expect(figures?.tips).toBe(2);
		expect(figures?.joints).toBe(1);
		expect(figures?.fanShare).toBe(0);
		// The stem and its two arms, in pieces 300 long.
		const wood = (160 + 2 * Math.hypot(80, 140)) / 300;
		expect(Math.abs((figures?.woodLength ?? 0) - wood)).toBeLessThan(0.08);
		expect(figures?.woodPerTip).toBeCloseTo((figures?.woodLength ?? 0) / 2, 3);
		expect(figures?.tipsPerArea).toBeCloseTo((2 * 300 * 300) / (160 * 300), 2);
		expect(figures?.kinksPerLength).toBe(0);
	});

	test('four twigs from one point are a fan', () => {
		const mask = empty();
		line(mask, 200, 380, 200, 220, 5);
		for (const angle of [-60, -20, 20, 60])
			line(
				mask,
				200,
				220,
				200 + 150 * Math.sin((angle * Math.PI) / 180),
				220 - 150 * Math.cos((angle * Math.PI) / 180),
				5,
			);
		const figures = branchFigures(mask, WIDTH, HEIGHT, 310, 260 * 310);
		expect(figures?.tips).toBe(4);
		expect(figures?.joints).toBe(1);
		expect(figures?.fanShare).toBe(1);
	});

	test('a zigzag twig counts its corners as kinks', () => {
		const mask = empty();
		const corners = [
			[100, 300],
			[160, 200],
			[220, 300],
			[280, 200],
			[340, 300],
		] as const;
		for (let k = 1; k < corners.length; k++) {
			const [ax, ay] = corners[k - 1] as readonly [number, number];
			const [bx, by] = corners[k] as readonly [number, number];
			line(mask, ax, ay, bx, by, 5);
		}
		const figures = branchFigures(mask, WIDTH, HEIGHT, 240, 240 * 100);
		expect(figures?.tips).toBe(1);
		expect(figures?.joints).toBe(0);
		expect(figures?.fanShare).toBeNull();
		const wood = (4 * Math.hypot(60, 100)) / 240;
		expect(Math.abs((figures?.woodLength ?? 0) - wood)).toBeLessThan(0.1);
		expect(Math.round((figures?.kinksPerLength ?? 0) * (figures?.woodLength ?? 0))).toBe(3);
		// Each corner turns the twig by the angle between its two stretches.
		const turn = 180 - (2 * Math.atan2(60, 100) * 180) / Math.PI;
		expect(Math.abs((figures?.meanKink ?? 0) - turn)).toBeLessThan(8);
	});

	test('a straight run has no turn, and a right angle has one', () => {
		expect(turnsOf([0, 0, 5, 0, 10, 0, 20, 0], 1)).toEqual([]);
		const corner = turnsOf([0, 0, 10, 0, 20, 0, 20, 10, 20, 20], 1);
		expect(corner).toHaveLength(1);
		expect(corner[0]).toBeCloseTo(90, 5);
		// A corner cut by a short stretch is one corner, and a short hook at the end is none.
		const cut = [0, 0, 40, 0, 43, 3, 43, 43];
		expect(turnsOf(cut, 0.5)).toHaveLength(2);
		const one = turnsOf(cut, 0.5, 6);
		expect(one).toHaveLength(1);
		expect(Math.abs((one[0] as number) - 90)).toBeLessThan(6);
		expect(turnsOf([0, 0, 40, 0, 42, 2], 0.5, 6)).toEqual([]);
	});
});

describe('a picture of a branch piece', () => {
	/** A picture on plain grey: brown wood drawn by lines, and round green leaves. */
	function picture(
		wood: readonly (readonly [number, number, number, number])[],
		leaves: readonly (readonly [number, number, number])[],
	): Rgba {
		const image = blank(WIDTH, HEIGHT, [200, 200, 200]);
		const paint = (shape: Uint8Array, colour: readonly number[]): void => {
			for (let at = 0; at < shape.length; at++)
				if (shape[at]) for (let c = 0; c < 3; c++) image.data[at * 4 + c] = colour[c] as number;
		};
		const leafMask = empty();
		for (const [x, y, radius] of leaves) disc(leafMask, x, y, radius);
		paint(leafMask, [40, 140, 40]);
		const woodMask = empty();
		for (const [ax, ay, bx, by] of wood) line(woodMask, ax, ay, bx, by, 7);
		paint(woodMask, [110, 80, 60]);
		return image;
	}

	test('parts the leaves from the wood and reads the wood', () => {
		const result = measurePiece(
			picture(
				[
					[200, 399, 200, 220],
					[200, 220, 130, 110],
					[200, 220, 270, 110],
				],
				[
					[125, 85, 55],
					[275, 85, 55],
				],
			),
			false,
		);
		if ('problem' in result) throw new Error(result.problem);
		const figures = result.figures;
		expect(figures.clipped).toEqual(['bottom']);
		expect(figures.foliageShare).toBeGreaterThan(0.05);
		expect(figures.woodShare).toBeGreaterThan(0.08);
		expect(figures.woodShare).toBeLessThan(0.3);
		expect(figures.branch?.tips).toBe(2);
		expect(figures.branch?.joints).toBe(1);
		expect(figures.droop).toBeNull();
		expect(figures.missing.droop).toContain('stands the cut piece on its cut');
		// A leaf cluster gives the shares, and no cut-branch figures.
		const cluster = measurePiece(
			picture([[200, 399, 200, 220]], [[200, 180, 60]]),
			false,
			true,
			false,
		);
		if ('problem' in cluster) throw new Error(cluster.problem);
		expect(cluster.figures.branch).toBeNull();
		expect(cluster.figures.missing.branch).toContain('leaf cluster');
	});

	test('reads the droop of a branch from the edge it enters by', () => {
		// A bare branch from the top edge that falls 60 degrees below level.
		const run = 300 / Math.tan((60 * Math.PI) / 180);
		const result = measurePiece(picture([[120, 0, 120 + run, 300]], []), true);
		if ('problem' in result) throw new Error(result.problem);
		expect(result.figures.clipped).toEqual(['top']);
		expect(Math.abs((result.figures.droop as number) - 60)).toBeLessThan(2);
		expect(result.figures.woodShare).toBe(1);
		expect(result.figures.branch?.tips).toBe(1);
		// A subject that rises from the bottom edge may be a standing plant, so it has no droop.
		const rising = measurePiece(picture([[120, 399, 120 + run, 99]], []), true);
		if ('problem' in rising) throw new Error(rising.problem);
		expect(rising.figures.clipped).toEqual(['bottom']);
		expect(rising.figures.droop).toBeNull();
		expect(rising.figures.missing.droop).toContain("rises from the frame's lower edge");
	});

	test('gives no wood figures where the foliage is not green', () => {
		const image = picture([[200, 399, 200, 220]], [[200, 160, 70]]);
		const result = measurePiece(image, false, false);
		if ('problem' in result) throw new Error(result.problem);
		expect(result.figures.foliageShare).toBeNull();
		expect(result.figures.branch).toBeNull();
		expect(result.figures.missing.branch).toContain('not green');
	});
});
