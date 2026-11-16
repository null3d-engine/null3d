// The water body's descriptions: one river and one lake answer the same questions, so the surface
// and the view from under it draw both without knowing which kind they hold.
import { describe, expect, it } from 'bun:test';
import { waterBody } from './shape';

describe('a river shape', () => {
	/** A straight river along x, 4 m wide and 0.62 m deep, which is the Creek's own section. */
	const river = () =>
		waterBody({
			kind: 'river',
			middle: [
				[-10, 0],
				[0, 0],
				[10, 0],
			],
			halfWidth: 2,
			depth: 0.62,
		});

	it('is deepest along its middle and dry past the edge', () => {
		const body = river();
		expect(body.depthAt(0, 0)).toBeCloseTo(0.62, 6);
		// The bed rises smoothly from the middle to the edge.
		expect(body.depthAt(0, 1)).toBeCloseTo(0.62, 6);
		expect(body.depthAt(0, 2)).toBeLessThan(0.62);
		expect(body.depthAt(0, 2)).toBeGreaterThan(0);
		expect(body.depthAt(0, 2.65)).toBe(0);
		expect(body.contains(0, 0)).toBe(true);
		expect(body.contains(0, 2.65)).toBe(false);
	});

	it('carries its current downstream at the speed of its description', () => {
		const body = river();
		const out: [number, number] = [0, 0];
		body.currentAt(3, 0, out);
		expect(out[0]).toBeCloseTo(0.35, 6);
		expect(out[1]).toBeCloseTo(0, 6);
	});

	it('follows a bend, and holds a still current when its speed is 0', () => {
		const body = waterBody({
			kind: 'river',
			middle: [
				[0, 0],
				[10, 10],
			],
			halfWidth: 1,
			speed: 0,
		});
		expect(body.contains(10, 10)).toBe(true);
		expect(body.contains(0, 10)).toBe(false);
		const out: [number, number] = [1, 1];
		body.currentAt(5, 5, out);
		expect(out[0]).toBe(0);
		expect(out[1]).toBe(0);
	});

	it('takes a depth for each point of its middle line', () => {
		const body = waterBody({
			kind: 'river',
			middle: [
				[0, 0],
				[20, 0],
			],
			halfWidth: 2,
			depth: [1, 3],
		});
		expect(body.depthAt(0, 0)).toBeCloseTo(1, 5);
		expect(body.depthAt(20, 0)).toBeCloseTo(3, 5);
	});

	it('keeps its bounds around the water that it reaches', () => {
		const body = river();
		expect(body.minX).toBeCloseTo(-12.66, 2);
		expect(body.maxX).toBeCloseTo(12.66, 2);
		expect(body.minZ).toBeCloseTo(-2.66, 2);
		expect(body.maxZ).toBeCloseTo(2.66, 2);
	});

	it('refuses a middle line of one point, a width of 0, and a repeated point', () => {
		expect(() => waterBody({ kind: 'river', middle: [[0, 0]], halfWidth: 2 })).toThrow(
			'at least two points',
		);
		expect(() =>
			waterBody({
				kind: 'river',
				middle: [
					[0, 0],
					[1, 0],
				],
				halfWidth: 0,
			}),
		).toThrow('half width');
		expect(() =>
			waterBody({
				kind: 'river',
				middle: [
					[0, 0],
					[0, 0],
				],
				halfWidth: 1,
			}),
		).toThrow('must not be the same');
	});
});

describe('a lake shape', () => {
	/** A square lake 20 m across, whose bed reaches 3 m over 2 m from the shore. */
	const lake = () =>
		waterBody({
			kind: 'lake',
			shore: [
				[-10, -10],
				[10, -10],
				[10, 10],
				[-10, 10],
			],
			depth: 3,
			shoreWidth: 2,
		});

	it('deepens from its shore to its middle', () => {
		const body = lake();
		expect(body.depthAt(0, 0)).toBeCloseTo(3, 6);
		expect(body.depthAt(10, 0)).toBe(0);
		expect(body.depthAt(9, 0)).toBeCloseTo(1.5, 1);
	});

	it('holds still water, and no water outside its shore', () => {
		const body = lake();
		const out: [number, number] = [1, 1];
		body.currentAt(0, 0, out);
		expect(out).toEqual([0, 0]);
		expect(body.contains(0, 0)).toBe(true);
		expect(body.contains(12, 0)).toBe(false);
		expect(body.depthAt(12, 0)).toBe(0);
	});

	it('takes a depth function of the distance from the shore', () => {
		const body = waterBody({
			kind: 'lake',
			shore: [
				[-10, -10],
				[10, -10],
				[10, 10],
				[-10, 10],
			],
			depth: (_x, _z, fromShore) => Math.min(fromShore, 1),
		});
		expect(body.depthAt(0, 0)).toBeCloseTo(1, 6);
		expect(body.depthAt(9.5, 0)).toBeCloseTo(0.5, 6);
	});

	it('refuses a shore that encloses no area', () => {
		expect(() =>
			waterBody({
				kind: 'lake',
				shore: [
					[0, 0],
					[1, 0],
					[2, 0],
				],
			}),
		).toThrow('enclose an area');
	});
});
