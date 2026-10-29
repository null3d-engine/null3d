import { describe, expect, test } from 'bun:test';
import { buildLeaves } from './leaves';
import type { LeafCard } from './levels';

/** A cluster card with its own middle, and axes lined up with the world so its corners read plainly. */
function card(x: number, y: number, z: number): LeafCard {
	return {
		center: [x, y, z],
		normal: [0, 0, 1],
		right: [1, 0, 0],
		up: [0, 1, 0],
		width: 0.3,
		height: 0.2,
		branch: 0,
		flutter: 3,
		stiffness: 128,
		occlusion: 0.25,
		kind: 'cluster',
	};
}

describe('leaf target records', () => {
	test('grows a kept card and folds a dropped card toward the next level', () => {
		const kept = card(0, 0, 0);
		const dropped = card(2, 1, 0);
		const part = buildLeaves([kept, dropped], 1, {
			keep: new Set([kept]),
			grow: Math.SQRT2,
			error: 0.5,
		});
		const targets = part.targets as Float32Array;
		const vertices = part.positions.length / 3;
		expect(targets.length).toBe(vertices * 4);
		// The kept card's six corners each move out by the growth's ratio about its middle.
		for (let v = 0; v < 6; v++) {
			for (let axis = 0; axis < 3; axis++)
				expect(targets[v * 4 + axis]).toBeCloseTo(
					(kept.center[axis] as number) +
						((part.positions[v * 3 + axis] as number) - (kept.center[axis] as number)) * Math.SQRT2,
					5,
				);
			expect(targets[v * 4 + 3]).toBe(0.5);
		}
		// The dropped card's four corners fall to its middle, so it shrinks to nothing there.
		for (let v = 6; v < vertices; v++) {
			expect(targets[v * 4]).toBeCloseTo(dropped.center[0] as number, 6);
			expect(targets[v * 4 + 1]).toBeCloseTo(dropped.center[1] as number, 6);
			expect(targets[v * 4 + 2]).toBeCloseTo(dropped.center[2] as number, 6);
			expect(targets[v * 4 + 3]).toBe(0.5);
		}
	});

	test('names the coarsest level own place with no error, so it never moves', () => {
		const part = buildLeaves([card(1, 2, 3)], 2);
		const targets = part.targets as Float32Array;
		for (let v = 0; v < targets.length / 4; v++) expect(targets[v * 4 + 3]).toBe(0);
	});
});
