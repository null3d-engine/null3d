// Stage 4's close pass: a kept piece is drawn only where its carrier chain joins drawn wood, the
// chain is raised at its coarsest segments and priced, and a chain the level cannot pay drops its
// socket. The scope is every drawn piece, extras included.
import { describe, expect, test } from 'bun:test';
import type { MacroSkeleton } from '../core/graph';
import { type CloseSockets, closeCarriers } from './carrier-close';

/** A skeleton of `count` axes in a chain: each axis's parent is the one before it. */
function chain(count: number): Pick<MacroSkeleton, 'axes'> {
	const parent = Int32Array.from({ length: count }, (_, axis) => (axis === 0 ? -1 : axis - 1));
	const order = Uint8Array.from({ length: count }, (_, axis) => axis);
	return {
		axes: {
			count,
			parent,
			order,
			first: new Int32Array(count),
			last: new Int32Array(count),
		} as unknown as MacroSkeleton['axes'],
	};
}

/** One socket on an axis, kept. */
function socket(axis: number, kept = 1): CloseSockets {
	return {
		count: 1,
		carrierAxis: Uint32Array.from([axis]),
		kept: Uint8Array.from([kept]),
	};
}

/** The drawn flags: the first `drawnCount` axes of a chain are drawn. */
function drawnUpTo(count: number, drawnCount: number): Uint8Array {
	return Uint8Array.from({ length: count }, (_, axis) => (axis < drawnCount ? 1 : 0));
}

/** Ten triangles an axis at its coarsest. */
const cost = () => 10;

describe('the carrier close pass', () => {
	test('raises the chain from the nearest drawn ancestor down to the carrier, and prices it', () => {
		const result = closeCarriers(chain(4), socket(3), drawnUpTo(4, 2), cost);
		expect(result.raised).toEqual([
			{ axis: 2, triangles: 10 },
			{ axis: 3, triangles: 10 },
		]);
		expect(result.price).toBe(20);
		expect(result.dropped).toEqual([]);
	});

	test('closes an extra by the same rule as a leaf', () => {
		// The socket table says nothing about the piece's kind, so an extra and a leaf close alike.
		const leaf = closeCarriers(chain(3), socket(2), drawnUpTo(3, 1), cost);
		const extra = closeCarriers(chain(3), socket(2), drawnUpTo(3, 1), cost);
		expect(extra).toEqual(leaf);
		expect(extra.raised.map((entry) => entry.axis)).toEqual([1, 2]);
	});

	test('drops a socket whose chain the allowance cannot pay', () => {
		const result = closeCarriers(chain(4), socket(3), drawnUpTo(4, 2), cost, 15);
		expect(result.raised).toEqual([]);
		expect(result.price).toBe(0);
		expect(result.dropped).toHaveLength(1);
		expect(result.dropped[0]?.reason).toContain('allowance leaves 15');
	});

	test('drops a socket whose chain reaches no drawn wood', () => {
		const result = closeCarriers(chain(3), socket(2), drawnUpTo(3, 0), cost);
		expect(result.raised).toEqual([]);
		expect(result.dropped[0]?.reason).toContain('no drawn ancestor');
	});

	test('draws nothing for a socket already on drawn wood, or one the grow stage dropped', () => {
		expect(closeCarriers(chain(3), socket(2), drawnUpTo(3, 3), cost).raised).toEqual([]);
		expect(closeCarriers(chain(3), socket(2, 0), drawnUpTo(3, 1), cost).raised).toEqual([]);
	});

	test('charges a chain once for two sockets that share it', () => {
		const sockets: CloseSockets = {
			count: 2,
			carrierAxis: Uint32Array.from([2, 2]),
			kept: Uint8Array.from([1, 1]),
		};
		const result = closeCarriers(chain(3), sockets, drawnUpTo(3, 1), cost);
		expect(result.raised.map((entry) => entry.axis)).toEqual([1, 2]);
		expect(result.price).toBe(20);
	});
});
