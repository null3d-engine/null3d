// The extras on a variant: lathe fruit and cones, petal cups, spine fans and catkins on the sites
// their records name, a share of the sites each, only in their seasons, hanging toward the ground,
// each naming its record entry in its first texture coordinate, small ones left off the thinned
// level, and the same bytes from the same seed.
import { describe, expect, it } from 'bun:test';
import type { SpeciesKitData } from '../asset';
import { placeholderSkeleton } from '../core/placeholder';
import type { ExtraSpec, Species } from '../core/record';
import type { Season } from '../core/types';
import type { MeshInput } from '../stages';
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

/** Each record's kit, built once: a kit grows every prototype at four tiers. */
const kits = new Map<Species, SpeciesKitData>();

/** A dressed variant of a record with extras, in a season. */
function dressed(record: Species, season: Season): MeshInput {
	const kit = kits.get(record) ?? testKit(record);
	kits.set(record, kit);
	const skeleton = placeholderSkeleton({ record, seed: 11, variant: 0, season });
	const base = { record, seed: 11, variant: 0, season, kit, skeleton };
	return {
		...base,
		rows: placeShoots(base),
		crown: { cells: [1, 1, 1], min: [0, 0, 0], cell: 1, sky: new Float32Array([1]) },
		detail: 'high',
	};
}

// The first four entries draw; the cone, the fifth, draws on a record of its own.
const record = oakRecord({ extras: [ACORN, ...OTHERS] });
// The cones' record hands its shoots to cards where a shoot spans the pedunculate oak's pixels.
const coned = oakRecord({
	extras: [OTHERS[3] as ExtraSpec],
	lod: { ...oakRecord().lod, switchPixels: [104, 12, 160] },
});

/** The vertices of each extra entry, by the entry its third colour byte names. */
function byEntry(mesh: ReturnType<typeof extrasMesh>): number[] {
	const counts = new Array<number>(8).fill(0);
	if (!mesh) return counts;
	for (let i = 0; i < mesh.colors.length; i += 4) {
		const entry = mesh.colors[i + 2] as number;
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
		expect(summer[4]).toBe(0); // a fifth entry never draws
		expect(byEntry(extrasMesh(dressed(coned, 'summer'), 0))[0]).toBeGreaterThan(0); // cones on the crown's top
		const winter = byEntry(extrasMesh(dressed(record, 'winter'), 0));
		expect(winter[0]).toBe(0);
		expect(winter[3]).toBeGreaterThan(0);
		expect(byEntry(extrasMesh(dressed(record, 'blossom'), 0))[1]).toBeGreaterThan(0);
	});

	it('puts one on about the record share of the matching sites', () => {
		const input = dressed(oakRecord({ extras: [ACORN] }), 'summer');
		const mesh = extrasMesh(input, 0);
		const perAcorn = (ACORN.shape as { lathe: unknown[] }).lathe.length * 9;
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

	it('keeps an extra on a card level only where it spans a few pixels', () => {
		expect(byEntry(extrasMesh(dressed(record, 'summer'), 2))[2]).toBe(0); // thorns of 12 mm
		// Cones 4 cm across span several pixels where the first card level starts, and a pixel or
		// two where the second does.
		expect(byEntry(extrasMesh(dressed(coned, 'summer'), 1))[0]).toBeGreaterThan(0);
		expect(byEntry(extrasMesh(dressed(coned, 'summer'), 2))[0]).toBe(0);
		// An acorn's nut, 2 cm across, is a speck at either card level.
		const acorned = oakRecord({ extras: [{ ...ACORN, share: 1 }] });
		expect(extrasMesh(dressed(acorned, 'summer'), 1)).toBeUndefined();
		expect(extrasMesh(dressed(acorned, 'summer'), 0)).toBeDefined();
	});

	it('keeps the scale bumps inside the range the shape names', () => {
		// A plain column with four scale rows over its first fifth: below that the profile is smooth.
		const ringed: ExtraSpec = {
			...ACORN,
			share: 1,
			shape: {
				lathe: [
					[0.01, 0],
					[0.01, 0.05],
					[0.01, 0.1],
				],
				scales: 4,
				scaled: [0, 0.02],
			},
		};
		const mesh = extrasMesh(dressed(oakRecord({ extras: [ringed] }), 'summer'), 0);
		if (!mesh) throw new Error('no extras');
		// Each profile row turns into one ring of nine vertices, and the four scale rows add one
		// ring each: seven rings for the first extra.
		const perRing = 9;
		const rings = 3 + 4;
		let bumped = 0;
		let base: number | undefined;
		for (let ring = 0; ring < rings; ring++) {
			const first = ring * perRing;
			const centre = [0, 0, 0];
			for (let j = 0; j < perRing - 1; j++)
				for (let axis = 0; axis < 3; axis++)
					centre[axis] =
						(centre[axis] as number) +
						(mesh.positions[(first + j) * 3 + axis] as number) / (perRing - 1);
			const radius = Math.hypot(
				(mesh.positions[first * 3] as number) - (centre[0] as number),
				(mesh.positions[first * 3 + 1] as number) - (centre[1] as number),
				(mesh.positions[first * 3 + 2] as number) - (centre[2] as number),
			);
			base ??= centre[1] as number;
			const height = Math.abs((centre[1] as number) - base);
			// The acorn hangs straight down, so height along the lathe is the drop from its first ring.
			if (height > 0.03) expect(radius).toBeCloseTo(0.01, 4);
			else if (radius > 0.0105) bumped++;
		}
		expect(bumped).toBe(4);
	});

	it('draws one to three at a site where the record gives a count', () => {
		const clustered: ExtraSpec = { ...ACORN, share: 1, count: { mean: 2, spread: 1 } };
		const input = dressed(oakRecord({ extras: [clustered] }), 'summer');
		const mesh = extrasMesh(input, 0);
		const perAcorn = (ACORN.shape as { lathe: unknown[] }).lathe.length * 9;
		const acorns = (mesh?.positions.length ?? 0) / 3 / perAcorn;
		// Every site carries one or more, none more than three, and the count's mean is two.
		expect(acorns).toBeGreaterThanOrEqual(input.rows.count);
		expect(acorns).toBeLessThanOrEqual(input.rows.count * 3);
		expect(acorns / input.rows.count).toBeGreaterThan(1.7);
		expect(acorns / input.rows.count).toBeLessThan(2.3);
	});

	it('forks every copy of a cluster from the end of one shared stalk', () => {
		const shared: ExtraSpec = {
			...ACORN,
			share: 1,
			count: { mean: 3, spread: 0 },
			shape: { lathe: (ACORN.shape as { lathe: readonly [number, number][] }).lathe, stalk: 0.05 },
		};
		const input = dressed(oakRecord({ extras: [shared] }), 'summer');
		const mesh = extrasMesh(input, 0);
		if (!mesh) throw new Error('no acorns');
		// A four-sided stalk's ring holds a vertex a side plus the seam; a copy's ring holds nine.
		const stalkRing = 5;
		const perAcorn = (ACORN.shape as { lathe: unknown[] }).lathe.length * 9;
		const perSite = stalkRing * 2 + perAcorn * 3;
		expect(mesh.positions.length / 3).toBe(input.rows.count * perSite);
		// The middle of a ring, which a shared stalk's last ring and every copy's first ring share.
		const centre = (first: number, ring: number): number[] => {
			const out = [0, 0, 0];
			for (let j = 0; j < ring - 1; j++)
				for (let axis = 0; axis < 3; axis++)
					out[axis] =
						(out[axis] as number) + (mesh.positions[(first + j) * 3 + axis] as number) / (ring - 1);
			return out;
		};
		const top = centre(0, stalkRing);
		const fork = centre(stalkRing, stalkRing);
		expect(fork[1] as number).toBeLessThan((top[1] as number) - 0.03);
		for (let k = 0; k < 3; k++) {
			const at = centre(stalkRing * 2 + k * perAcorn, 9);
			expect(at[0]).toBeCloseTo(fork[0] as number, 5);
			expect(at[1]).toBeCloseTo(fork[1] as number, 5);
			expect(at[2]).toBeCloseTo(fork[2] as number, 5);
		}
	});

	it('lets a lathe name the face count of its nearest level', () => {
		const lathe = (ACORN.shape as { lathe: readonly [number, number][] }).lathe;
		const plain = extrasMesh(dressed(oakRecord({ extras: [{ ...ACORN, share: 1 }] }), 'summer'), 0);
		const round = extrasMesh(
			dressed(
				oakRecord({ extras: [{ ...ACORN, share: 1, shape: { lathe, sides: 12 } }] }),
				'summer',
			),
			0,
		);
		if (!plain || !round) throw new Error('no acorns');
		// The same sites carry the same profile, so the faces alone change the count: thirteen
		// vertices round a ring in place of nine. A card level keeps its own thinned count.
		expect(round.positions.length / plain.positions.length).toBeCloseTo(13 / 9, 6);
		const cone = (OTHERS[3] as ExtraSpec).shape;
		const thinned: ExtraSpec = {
			...(OTHERS[3] as ExtraSpec),
			shape: { ...(cone as { lathe: readonly [number, number][] }), sides: 12 },
		};
		const roundCone = oakRecord({
			extras: [thinned],
			lod: { ...oakRecord().lod, switchPixels: [104, 12, 160] },
		});
		const drawn = extrasMesh(dressed(coned, 'summer'), 1);
		const thinnedDrawn = extrasMesh(dressed(roundCone, 'summer'), 1);
		if (!drawn || !thinnedDrawn) throw new Error('no cones');
		expect(thinnedDrawn.positions.length).toBe(drawn.positions.length);
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
