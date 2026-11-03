// The extras on a variant: lathe fruit and cones, petal cups, spine fans and catkins on the sites
// their records name, a share of the sites each, only in their seasons, hanging toward the ground,
// each naming its record entry in its first texture coordinate, small ones left off the thinned
// level, and the same bytes from the same seed.
import { describe, expect, it } from 'bun:test';
import { placeholderSkeleton } from '../core/placeholder';
import type { ExtraSpec, Species } from '../core/record';
import type { Season } from '../core/types';
import type { MeshInput, MeshLevel } from '../stages';
import { extrasMesh } from './extras';
import { placeShoots } from './instancer';
import { oakRecord, testKit } from './oak.test-support';

/** An acorn on a long stalk at shoot tips, hanging straight down in summer and autumn. */
const ACORN: ExtraSpec = {
	kind: 'fruit',
	at: 'shoot-tip',
	share: 0.5,
	seasons: ['summer', 'autumn'],
	shape: {
		lathe: [
			[0.001, 0],
			[0.001, 0.03],
			[0.007, 0.033],
			[0.008, 0.042],
			[0.0075, 0.055],
			[0, 0.06],
		],
	},
	colour: [0.25, 0.3, 0.08],
	hang: 180,
};

/** The other shapes, one each. */
const OTHERS: readonly ExtraSpec[] = [
	{
		kind: 'flower',
		at: 'node',
		share: 0.3,
		seasons: ['blossom'],
		shape: { petals: 5, radius: 0.015, cup: 0.4 },
		colour: [0.9, 0.85, 0.9],
		hang: 0,
	},
	{
		kind: 'thorn',
		at: 'old-wood',
		share: 0.4,
		seasons: ['summer', 'autumn', 'winter', 'blossom'],
		shape: { spines: 3, length: 0.012, spread: 25 },
		colour: [0.2, 0.15, 0.1],
		hang: 0,
	},
	{
		kind: 'catkin',
		at: 'node',
		share: 0.2,
		seasons: ['winter'],
		shape: { catkin: { length: 0.05, radius: 0.004 } },
		colour: [0.5, 0.45, 0.2],
		hang: 150,
	},
	{
		kind: 'cone',
		at: 'crown-top',
		share: 1,
		seasons: ['summer'],
		shape: {
			lathe: [
				[0.01, 0],
				[0.02, 0.03],
				[0.015, 0.07],
				[0, 0.09],
			],
			scales: 6,
		},
		colour: [0.35, 0.22, 0.12],
		hang: 0,
	},
];

/** A dressed variant of a record with extras, in a season. */
function dressed(record: Species, season: Season): MeshInput {
	const kit = testKit(record);
	const skeleton = placeholderSkeleton({ record, seed: 11, variant: 0, season });
	const base = { record, seed: 11, variant: 0, season, kit, skeleton };
	return {
		...base,
		rows: placeShoots(base),
		crown: { cells: [1, 1, 1], min: [0, 0, 0], cell: 1, sky: new Float32Array([1]) },
		detail: 'high',
	};
}

const record = oakRecord({ extras: [ACORN, ...OTHERS] });

/** The vertices of each extra entry, by the eighth its first texture coordinate names. */
function byEntry(mesh: ReturnType<typeof extrasMesh>): number[] {
	const counts = new Array<number>(8).fill(0);
	if (!mesh) return counts;
	for (let i = 0; i < mesh.uvs.length; i += 2) {
		const entry = Math.floor((mesh.uvs[i] as number) * 8);
		counts[entry] = (counts[entry] as number) + 1;
	}
	return counts;
}

describe('the extras', () => {
	it('draws only the extras of the season, each naming its record entry', () => {
		const summer = byEntry(extrasMesh(dressed(record, 'summer'), 0));
		expect(summer[0]).toBeGreaterThan(0); // acorns
		expect(summer[1]).toBe(0); // flowers, blossom only
		expect(summer[2]).toBeGreaterThan(0); // thorns
		expect(summer[3]).toBe(0); // catkins, winter only
		expect(summer[4]).toBeGreaterThan(0); // cones on the crown's top
		const winter = byEntry(extrasMesh(dressed(record, 'winter'), 0));
		expect(winter[0]).toBe(0);
		expect(winter[3]).toBeGreaterThan(0);
		expect(byEntry(extrasMesh(dressed(record, 'blossom'), 0))[1]).toBeGreaterThan(0);
	});

	it('puts one on about the record share of the matching sites', () => {
		const input = dressed(oakRecord({ extras: [ACORN] }), 'summer');
		const mesh = extrasMesh(input, 1);
		const perAcorn = (ACORN.shape as { lathe: unknown[] }).lathe.length * 6;
		const acorns = (mesh?.positions.length ?? 0) / 3 / perAcorn;
		expect(acorns / input.rows.count).toBeGreaterThan(0.35);
		expect(acorns / input.rows.count).toBeLessThan(0.65);
	});

	it('hangs an acorn straight down from its shoot tip', () => {
		const mesh = extrasMesh(dressed(oakRecord({ extras: [{ ...ACORN, share: 1 }] }), 'summer'), 0);
		if (!mesh) throw new Error('no acorns');
		// Each acorn's lathe turns about a downward axis: its last ring, its point, lies below its first.
		const perAcorn = (ACORN.shape as { lathe: unknown[] }).lathe.length * 9;
		for (let a = 0; a < mesh.positions.length / 3; a += perAcorn) {
			const top = mesh.positions[a * 3 + 1] as number;
			const point = mesh.positions[(a + perAcorn - 1) * 3 + 1] as number;
			expect(point).toBeLessThan(top - 0.05);
		}
	});

	it('leaves small extras off the thinned level and keeps large ones', () => {
		const counts = (level: MeshLevel) => byEntry(extrasMesh(dressed(record, 'summer'), level));
		expect(counts(2)[2]).toBe(0); // thorns of 12 mm
		expect(counts(2)[4]).toBeGreaterThan(0); // cones of 9 cm
	});

	it('grows the same extras from the same seed', () => {
		const a = extrasMesh(dressed(record, 'summer'), 0);
		const b = extrasMesh(dressed(record, 'summer'), 0);
		expect(Array.from(a?.positions ?? [])).toEqual(Array.from(b?.positions ?? []));
	});

	it('draws nothing for a record without extras in the season', () => {
		expect(extrasMesh(dressed(oakRecord(), 'summer'), 0)).toBeUndefined();
	});
});
