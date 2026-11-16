// The architectural grower: one leader with whorls of boughs, the orders below them, the envelope
// that caps their run, and the bud sites that the shoot prototypes stand on.
import { describe, expect, it } from 'bun:test';
import type { MacroSkeleton } from '../core/graph';
import { AXIS_STEM, BUD_LATERAL } from '../core/graph';
import { hashBytes, unitAt } from '../core/hash';
import { spreadAt } from '../core/types';
import { record } from '../species/scots-pine/record';
import { ENVELOPE_ROUND, growArchitectural } from './architectural';
import { envelopeVolume, insetVolume, smoothedVolume } from './envelope';
import { shootReach } from './self-organizing';

/** The pine grown at one seed and variant. */
function grown(seed = 11, variant = 0): MacroSkeleton {
	return growArchitectural({ record, seed, variant, season: 'summer' });
}

/** The digest of the arrays a growth gives, so two runs compare byte for byte. */
function digest(skeleton: MacroSkeleton): string {
	return [
		hashBytes(new Uint8Array(skeleton.position.buffer), 1),
		hashBytes(new Uint8Array(skeleton.radius.buffer), 2),
		hashBytes(new Uint8Array(skeleton.axes.order.buffer), 3),
		hashBytes(skeleton.buds.kind, 4),
	].join(':');
}

/** Whether every axis's chain of parents reaches a stem. */
function reachesStem(skeleton: MacroSkeleton): boolean {
	const { axes } = skeleton;
	for (let a = 0; a < axes.count; a++) {
		let at = a;
		let steps = 0;
		while ((axes.parent[at] as number) >= 0) {
			at = axes.parent[at] as number;
			if (++steps > axes.count) return false;
		}
		if ((axes.order[at] as number) !== 0 || (axes.kind[at] as number) !== AXIS_STEM) return false;
	}
	return true;
}

describe('the architectural grower', () => {
	const skeleton = grown();

	it('grows one leader with whorls of boughs in the orders below it', () => {
		let stems = 0;
		let boughs = 0;
		let deepest = 0;
		for (let a = 0; a < skeleton.axes.count; a++) {
			const order = skeleton.axes.order[a] as number;
			if (order === 0) stems++;
			if (order === 1) boughs++;
			deepest = Math.max(deepest, order);
		}
		expect(stems).toBe(1);
		expect(boughs).toBeGreaterThan(4);
		expect(deepest).toBe(3);
	});

	it('joins every axis to a stem', () => {
		expect(reachesStem(skeleton)).toBe(true);
	});

	it('grows the same bytes twice', () => {
		expect(digest(grown())).toBe(digest(grown()));
	});

	it('stands its buds on the finest axes and at every tip', () => {
		const { axes, buds } = skeleton;
		expect(buds.count).toBeGreaterThan(0);
		for (let b = 0; b < buds.count; b++) {
			const axis = buds.axis[b] as number;
			expect(axes.order[axis] as number).toBeLessThanOrEqual(3);
			// A lateral bud stands on the finest axes, and on the leader's own top; a tip carries its
			// terminal bud on any order.
			if ((buds.kind[b] as number) === BUD_LATERAL) {
				const order = axes.order[axis] as number;
				expect(order === 0 || order === 3).toBe(true);
			}
		}
		// Every finest axis ends in a terminal bud at its last node.
		for (let a = 0; a < axes.count; a++) {
			if ((axes.order[a] as number) !== 3) continue;
			const last = axes.last[a] as number;
			let found = false;
			for (let b = 0; b < buds.count && !found; b++) found = (buds.node[b] as number) === last;
			expect(found).toBe(true);
		}
	});

	it('caps the wood inside the envelope', () => {
		expect(record.envelope).toBeDefined();
		// The grower turns the outline by the variant's own angle, which is its second hash purpose,
		// and scales it by the height its own first hash purpose draws, not by the built tree's top.
		const salt = record.seedSalt >>> 0;
		const turn = unitAt(11, salt, 0, 2) * 2 * Math.PI;
		const drawn = spreadAt(record.size.height, unitAt(11, salt, 0, 1));
		const volume = smoothedVolume(
			insetVolume(
				envelopeVolume(record.envelope as NonNullable<typeof record.envelope>, drawn, turn),
				shootReach(record) * 0.6,
			),
			ENVELOPE_ROUND,
		);
		for (let n = 0; n < skeleton.nodeCount; n++) {
			const axis = skeleton.axisOf[n] as number;
			if ((skeleton.axes.order[axis] as number) === 0) continue;
			const y = skeleton.position[n * 3 + 1] as number;
			// The dead stubs on the bole stand below the outline, which holds the crown alone.
			if (y < volume.base) continue;
			const room = volume.room(
				skeleton.position[n * 3] as number,
				y,
				skeleton.position[n * 3 + 2] as number,
			);
			// A node on the outline sits at the boundary, within the step that found it.
			expect(room).toBeGreaterThan(-0.02);
		}
	});

	it('grows to a mature height with the crown on its upper part', () => {
		expect(skeleton.height).toBeGreaterThan(10);
		expect(skeleton.crownBase).toBeGreaterThan(skeleton.height * 0.3);
	});
});
