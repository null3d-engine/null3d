// The shadow grid: a bud's pyramid of shadow below it, lifted again exactly, no light outside the
// envelope, and the pull toward the brighter room around a bud.
import { describe, expect, it } from 'bun:test';
import { ShadowGrid } from './light-grid';

/** A grid of 1 m cells, 10 a side, with its corner at the origin. */
function grid(open = true): ShadowGrid {
	const g = new ShadowGrid([0, 0, 0], [10, 10, 10], 1, [3, 0.5, 2]);
	g.openWhere(() => open);
	return g;
}

describe('the shadow grid', () => {
	it('casts a pyramid below a bud and lifts it again to nothing', () => {
		const g = grid();
		const at = (i: number, j: number, l: number) => g.shadow[(j * 10 + l) * 10 + i] as number;
		g.cast(5.5, 8.5, 5.5, 1);
		// The bud's own shadow does not darken it; q layers down the shadow is a·b^-q, q cells aside.
		expect(g.light(5.5, 8.5, 5.5)).toBe(1);
		expect(at(5, 8, 5)).toBeCloseTo(0.5, 6);
		expect(at(4, 7, 6)).toBeCloseTo(0.25, 6);
		expect(at(3, 7, 5)).toBe(0);
		expect(at(2, 5, 8)).toBeCloseTo(0.0625, 6);
		expect(at(5, 4, 5)).toBe(0);
		g.cast(5.5, 8.5, 5.5, 1);
		expect(g.light(5.5, 8.5, 5.5)).toBeCloseTo(0.5, 6);
		g.cast(5.5, 8.5, 5.5, -1);
		g.cast(5.5, 8.5, 5.5, -1);
		for (const value of g.shadow) expect(Math.abs(value)).toBeLessThan(1e-6);
	});

	it('holds light only in open cells', () => {
		const g = grid(false);
		expect(g.light(5, 5, 5)).toBe(0);
		expect(g.light(-1, 5, 5)).toBe(0);
		const half = new ShadowGrid([0, 0, 0], [10, 10, 10], 1, [3, 0.5, 2]);
		half.openWhere((x) => x < 5);
		expect(half.light(2, 5, 5)).toBe(1);
		expect(half.light(7, 5, 5)).toBe(0);
	});

	it('leads a bud toward brighter room, and not away from the outline', () => {
		const g = grid();
		for (let k = 0; k < 6; k++) g.cast(3.5, 7.5, 5.5, 1);
		const out: [number, number, number] = [0, 0, 0];
		g.toward(5.5, 5.5, 5.5, [0, 1, 0], out);
		expect(out[0]).toBeGreaterThan(0.1);
		// An open grid with no shadow pulls nowhere, even beside its edge.
		const empty = new ShadowGrid([0, 0, 0], [10, 10, 10], 1, [3, 0.5, 2]);
		empty.openWhere((x) => x < 6);
		empty.toward(5.5, 5.5, 5.5, [1, 0, 0], out);
		expect(Math.abs(out[0]) + Math.abs(out[1]) + Math.abs(out[2])).toBeLessThan(1e-9);
	});
});
