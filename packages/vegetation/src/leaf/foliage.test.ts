// Needles, fascicles and the seasons on shoots: a needle's length and its few triangles per tier,
// a fascicle's needles round its sheath, and rows that draw leafless twins in winter, keep dead
// leaves low in a marcescent crown, and stay in leaf in summer.
import { describe, expect, it } from 'bun:test';
import type { ShootRows } from '../asset';
import { placeholderSkeleton } from '../core/placeholder';
import type { NeedleShape, Species } from '../core/record';
import type { Season } from '../core/types';
import { DETAILS } from '../core/types';
import { fascicleMesh } from './fascicle';
import { placeShoots } from './instancer';
import { needleMesh } from './needle';
import { OAK_MANIFEST, oakRecord, testKit } from './oak.test-support';
import { inLeaf } from './season';

const NEEDLE: NeedleShape = {
	length: 0.05,
	width: 0.0015,
	section: 'rhombic',
	density: 2,
	angle: 50,
	ranks: 0,
	optics: {
		reflectance: [0.03, 0.06, 0.03],
		reflectanceBack: [0.04, 0.07, 0.04],
		transmittance: [0.02, 0.05, 0.01],
		roughness: [0.4, 0.5],
	},
};

/** The farthest a mesh's points reach up +Y. */
function top(positions: Float32Array): number {
	let high = 0;
	for (let i = 1; i < positions.length; i += 3) high = Math.max(high, positions[i] as number);
	return high;
}

describe('the needle', () => {
	it('runs its length to a point in 3 to 20 triangles by tier, each section', () => {
		for (const section of ['rhombic', 'flat', 'half-round', 'awl'] as const)
			for (const detail of DETAILS) {
				const needle = needleMesh({ ...NEEDLE, section }, OAK_MANIFEST, detail);
				const triangles = needle.indices.length / 3;
				expect(triangles).toBeGreaterThanOrEqual(3);
				expect(triangles).toBeLessThanOrEqual(30);
				expect(top(needle.positions)).toBeCloseTo(0.05, 6);
			}
	});
});

describe('the fascicle', () => {
	it('bundles its needles round a sheath', () => {
		const record: Species = {
			...oakRecord(),
			foliage: { kind: 'fascicle', needle: { ...NEEDLE, length: 0.06 }, sheath: 0.008, twist: 30 },
			shoots: { ...oakRecord().shoots!, phyllotaxis: { kind: 'fascicle', needles: 3 } },
		};
		const one = needleMesh(
			{ ...NEEDLE, length: 0.06, section: 'half-round' },
			OAK_MANIFEST,
			'high',
		);
		const bundle = fascicleMesh(record, OAK_MANIFEST, 'high');
		let stem = 0;
		for (let i = 2; i < bundle.colors.length; i += 4) if (bundle.colors[i] === 85) stem++;
		expect(stem).toBeGreaterThan(0);
		expect(bundle.positions.length / 3 - stem).toBe((one.positions.length / 3) * 3);
		// The needles part a little: their tips stand apart, near the bundle's height.
		expect(top(bundle.positions)).toBeGreaterThan(0.059);
	});
});

describe('the seasons on shoots', () => {
	const record = oakRecord();
	const kit = testKit(record);
	const skeleton = placeholderSkeleton({ record, seed: 11, variant: 0, season: 'summer' });
	const rowsIn = (season: Season, species: Species = record): ShootRows =>
		placeShoots({
			record: species,
			seed: 11,
			variant: 0,
			season,
			kit: { ...kit, record: species },
			skeleton,
		});
	const bare = (rows: ShootRows) => {
		let count = 0;
		for (let r = 0; r < rows.count; r++)
			if (kit.prototypes[rows.prototype[r] as number]?.leaves === 0) count++;
		return count;
	};

	it('keeps a deciduous crown in leaf in summer and bare in winter', () => {
		expect(bare(rowsIn('summer'))).toBe(0);
		const winter = rowsIn('winter');
		expect(bare(winter)).toBe(winter.count);
	});

	it('keeps dead leaves on the lower crown of a marcescent species in winter', () => {
		const marcescent: Species = { ...record, seasons: { ...record.seasons, winter: 'marcescent' } };
		const rows = rowsIn('winter', marcescent);
		expect(bare(rows)).toBeGreaterThan(0);
		expect(bare(rows)).toBeLessThan(rows.count);
		expect(inLeaf(marcescent, 'winter', 0.1, 0.5)).toBe(true);
		expect(inLeaf(marcescent, 'winter', 0.9, 0.5)).toBe(false);
	});

	it('keeps an evergreen in leaf in winter, and the record share in leaf in blossom', () => {
		expect(
			inLeaf({ ...record, seasons: { ...record.seasons, deciduous: false } }, 'winter', 0.5, 0.5),
		).toBe(true);
		const blossom: Species = {
			...record,
			seasons: { ...record.seasons, blossom: { extra: 0, leaves: 0.25 } },
		};
		expect(inLeaf(blossom, 'blossom', 0.5, 0.2)).toBe(true);
		expect(inLeaf(blossom, 'blossom', 0.5, 0.3)).toBe(false);
	});
});
