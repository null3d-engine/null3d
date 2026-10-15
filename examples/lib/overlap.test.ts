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

test('two coplanar quads that face opposite ways overlap', () => {
	// Two double-sided faces on the one plane, away from the origin, shimmer: their planes are `d`
	// and `-d`, which the check once read as two different planes.
	const front = quad('front', 1, 0, 2, 0, 2);
	const back: OverlapPart = { ...quad('back', 1, 1, 3, 1, 3), indices: [0, 2, 1, 0, 3, 2] };
	const found = findOverlaps([front, back]);
	expect(found.length).toBeGreaterThan(0);
	expect(found[0]?.kind).toBe('coplanar');
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
