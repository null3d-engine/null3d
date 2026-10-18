// The overlap check's own rules: a crossing or a coplanar overlap is a fault, a shared edge or a
// clear gap is not.
import { expect, test } from 'bun:test';
import { findOverlaps, type OverlapPart } from './overlap';

const quad = (
	name: string,
	y: number,
	x0: number,
	x1: number,
	z0: number,
	z1: number,
): OverlapPart => ({
	name,
	positions: [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1],
	indices: [0, 1, 2, 0, 2, 3],
});

test('two coplanar quads that share an area overlap', () => {
	const found = findOverlaps([quad('a', 0, 0, 2, 0, 2), quad('b', 0, 1, 3, 1, 3)]);
	expect(found.length).toBeGreaterThan(0);
	expect(found[0]?.kind).toBe('coplanar');
});

/** The same part with every triangle's winding turned, so its faces look the other way. */
const flipped = (part: OverlapPart): OverlapPart => {
	const indices = part.indices ?? [];
	const out: number[] = [];
	for (let k = 0; k + 2 < indices.length; k += 3)
		out.push(indices[k] as number, indices[k + 2] as number, indices[k + 1] as number);
	return { ...part, indices: out };
};

test('two coplanar faces that face opposite ways overlap when both can be seen', () => {
	// Off the origin, so each triangle's plane distance takes the sign of its own normal. A part
	// that draws both sides shows the two faces together, and they z-fight.
	const found = findOverlaps([
		quad('a', 0.5, 0, 2, 0, 2),
		{ ...flipped(quad('b', 0.5, 1, 3, 1, 3)), doubleSided: true },
	]);
	expect(found.length).toBeGreaterThan(0);
	expect(found[0]?.kind).toBe('coplanar');
});

test('two solid faces that meet back to back do not overlap', () => {
	// Each solid part culls the face that looks away, so a box that stands on another shows no
	// z-fighting where the two meet.
	expect(findOverlaps([quad('a', 0.5, 0, 2, 0, 2), flipped(quad('b', 0.5, 1, 3, 1, 3))])).toEqual(
		[],
	);
});

test('two quads that share only an edge do not overlap', () => {
	expect(findOverlaps([quad('a', 0, 0, 1, 0, 1), quad('b', 0, 1, 2, 0, 1)])).toEqual([]);
});

test('two coplanar quads with a gap do not overlap', () => {
	expect(findOverlaps([quad('a', 0, 0, 1, 0, 1), quad('b', 0, 1.5, 2.5, 0, 1)])).toEqual([]);
});

test('two quads on parallel planes do not overlap', () => {
	expect(findOverlaps([quad('a', 0, 0, 2, 0, 2), quad('b', 0.5, 0, 2, 0, 2)])).toEqual([]);
});

test('a triangle that crosses another overlaps', () => {
	const flat: OverlapPart = {
		name: 'floor',
		positions: [-2, 0, -2, 2, 0, -2, 0, 0, 2],
		indices: [0, 1, 2],
	};
	const spike: OverlapPart = {
		name: 'spike',
		positions: [0, -1, 0, 0, 1, 0.5, 0, 1, -0.5],
		indices: [0, 1, 2],
	};
	const found = findOverlaps([flat, spike]);
	expect(found.length).toBeGreaterThan(0);
	expect(found[0]?.kind).toBe('cross');
});

test('an ignored part pair may overlap on purpose', () => {
	const parts = [quad('roof', 0, 0, 2, 0, 2), quad('chimney', 0, 1, 3, 1, 3)];
	expect(findOverlaps(parts).length).toBeGreaterThan(0);
	expect(findOverlaps(parts, { ignore: ['roof|chimney'] })).toEqual([]);
});
