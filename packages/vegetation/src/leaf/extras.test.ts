// The extras on a variant: lathe fruit and cones, petal cups, spine fans and catkins on the sites
// their records name, a share of the sites each, only in their seasons, hanging toward the ground,
// each naming its record entry in its first texture coordinate, small ones left off the thinned
// level, and the same bytes from the same seed.
import { describe, expect, it } from 'bun:test';
import type { SpeciesKitData } from '../asset';
import { length3 } from '../core/math';
import { placeholderSkeleton } from '../core/placeholder';
import type { ExtraSpec, Species } from '../core/record';
import type { Season } from '../core/types';
import type { MeshInput } from '../stages';
import { extrasMesh, samaraMesh } from './extras';
import { placeShoots } from './instancer';
import { oakRecord, testKit } from './oak.test-support';
import { MeshWriter } from './writer';

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

/** The positions of one entry's vertices, in the order the mesh writes them. */
function positionsOf(mesh: NonNullable<ReturnType<typeof extrasMesh>>, entry: number): number[] {
	const out: number[] = [];
	for (let v = 0; v < mesh.positions.length / 3; v++)
		if (mesh.colors[v * 4 + 2] === entry)
			out.push(
				mesh.positions[v * 3] as number,
				mesh.positions[v * 3 + 1] as number,
				mesh.positions[v * 3 + 2] as number,
			);
	return out;
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

	it('sets a site back along the shoot when the record asks', () => {
		type Mesh = NonNullable<ReturnType<typeof extrasMesh>>;
		const reach = (mesh: Mesh): number => {
			let sum = 0;
			const n = mesh.positions.length / 3;
			for (let i = 0; i < mesh.positions.length; i += 3)
				sum += Math.hypot(
					mesh.positions[i] as number,
					mesh.positions[i + 1] as number,
					mesh.positions[i + 2] as number,
				);
			return sum / n;
		};
		const tip = extrasMesh(
			dressed(oakRecord({ extras: [{ ...ACORN, share: 1 }] }), 'summer'),
			0,
		) as Mesh;
		const back = extrasMesh(
			dressed(oakRecord({ extras: [{ ...ACORN, share: 1, tipShare: 0.5 }] }), 'summer'),
			0,
		) as Mesh;
		// The same shoots carry both, so a share back from the tip moves the fruit in from the tip.
		expect(reach(back)).toBeLessThan(reach(tip));
	});

	it('holds a petal cup on a stalk along the shoot, and leaves it at the site without one', () => {
		type Mesh = NonNullable<ReturnType<typeof extrasMesh>>;
		const highest = (mesh: Mesh): number => {
			let top = Number.NEGATIVE_INFINITY;
			for (let i = 1; i < mesh.positions.length; i += 3)
				top = Math.max(top, mesh.positions[i] as number);
			return top;
		};
		const cup = (stalk?: number): ExtraSpec => ({
			kind: 'flower',
			at: 'shoot-tip',
			share: 1,
			seasons: ['blossom'],
			shape: {
				petals: 5,
				radius: 0.015,
				cup: 0.4,
				...(stalk === undefined ? {} : { stalk }),
			},
			colour: [1, 1, 1],
			hang: 0,
		});
		const plain = extrasMesh(dressed(oakRecord({ extras: [cup()] }), 'blossom'), 0) as Mesh;
		const stalked = extrasMesh(dressed(oakRecord({ extras: [cup(0.03)] }), 'blossom'), 0) as Mesh;
		// The stalk adds a thin stem, and the crown-top cups stand the stalk's length higher.
		expect(stalked.positions.length).toBeGreaterThan(plain.positions.length);
		expect(highest(stalked)).toBeGreaterThan(highest(plain) + 0.01);
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

	it('draws a spine as a three-triangle cone with a shared apex', () => {
		// Each spine writes three base vertices and one apex, and three triangles between them.
		const thorn = { ...(OTHERS[1] as ExtraSpec), share: 1 };
		const mesh = extrasMesh(dressed(oakRecord({ extras: [thorn] }), 'summer'), 0);
		if (!mesh) throw new Error('no thorns');
		expect(mesh.indices.length / 3).toBe(((mesh.positions.length / 3) * 3) / 4);
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

	it('stands an extra beside its site where the record gives an offset', () => {
		const plain = extrasMesh(dressed(oakRecord({ extras: [{ ...ACORN, share: 1 }] }), 'summer'), 0);
		const moved = extrasMesh(
			dressed(oakRecord({ extras: [{ ...ACORN, share: 1, offset: [0.2, 0, 0] }] }), 'summer'),
			0,
		);
		if (!plain || !moved) throw new Error('no acorns');
		expect(plain.positions.length).toBe(moved.positions.length);
		// Every body stands the offset from where it stood, so the mesh's bounds move with it.
		let plainMin = Number.POSITIVE_INFINITY;
		let movedMin = Number.POSITIVE_INFINITY;
		for (let i = 0; i < plain.positions.length; i += 3) {
			plainMin = Math.min(plainMin, plain.positions[i] as number);
			movedMin = Math.min(movedMin, moved.positions[i] as number);
		}
		expect(movedMin - plainMin).toBeCloseTo(0.2, 5);
	});

	it('draws the extras that name one group at the same sites, and those alone at their own', () => {
		const twin: ExtraSpec = { ...ACORN, share: 0.4, count: undefined, tipShare: 0.5 };
		const grouped = extrasMesh(
			dressed(
				oakRecord({
					extras: [
						{ ...twin, group: 0 },
						{ ...twin, group: 0 },
					],
				}),
				'summer',
			),
			0,
		);
		if (!grouped) throw new Error('no acorns');
		const first = positionsOf(grouped, 0);
		const second = positionsOf(grouped, 1);
		expect(first.length).toBeGreaterThan(0);
		expect(second).toEqual(first);
		// The same two extras with no group pick their own sites, so their bodies stand apart.
		const apart = extrasMesh(dressed(oakRecord({ extras: [twin, { ...twin }] }), 'summer'), 0);
		if (!apart) throw new Error('no acorns');
		expect(positionsOf(apart, 1)).not.toEqual(positionsOf(apart, 0));
	});

	it('sets the parts of one group in an order along the shoot rather than on one point', () => {
		const twin: ExtraSpec = { ...ACORN, share: 0.4, count: undefined, group: 0 };
		const mesh = extrasMesh(
			dressed(
				oakRecord({
					extras: [
						{ ...twin, tipShare: 0.5 },
						{ ...twin, tipShare: 1 },
					],
				}),
				'summer',
			),
			0,
		);
		if (!mesh) throw new Error('no acorns');
		const low = positionsOf(mesh, 0);
		const high = positionsOf(mesh, 1);
		expect(high.length).toBe(low.length);
		let least = Number.POSITIVE_INFINITY;
		for (let i = 0; i < low.length; i += 3)
			least = Math.min(
				least,
				length3(
					(high[i] as number) - (low[i] as number),
					(high[i + 1] as number) - (low[i + 1] as number),
					(high[i + 2] as number) - (low[i + 2] as number),
				),
			);
		expect(least).toBeGreaterThan(0.01);
	});

	it('stands a bed of bristles off the lathe it lies on', () => {
		const lathe = (ACORN.shape as { lathe: readonly [number, number][] }).lathe;
		const plain = extrasMesh(dressed(oakRecord({ extras: [{ ...ACORN, share: 1 }] }), 'summer'), 0);
		const rows = 3;
		const around = 6;
		const bristled = extrasMesh(
			dressed(
				oakRecord({
					extras: [
						{
							...ACORN,
							share: 1,
							shape: { lathe, bristles: { rows, sides: around, length: 0.006 } },
						},
					],
				}),
				'summer',
			),
			0,
		);
		if (!plain || !bristled) throw new Error('no acorns');
		// Each bristle is a three-sided cone of two rings, so eight vertices a bristle.
		const added = bristled.positions.length - plain.positions.length;
		expect(added).toBeGreaterThan(0);
		expect(added % (rows * around * 8)).toBe(0);
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

	it('colours a band and the stalks apart from the body, meeting it at a sharp edge', () => {
		// One acorn on a shared stalk, its band the cup over the profile's first 33 mm.
		const lathe = (ACORN.shape as { lathe: readonly [number, number][] }).lathe;
		const shape = { lathe, scales: 2, scaled: [0, 0.033] as [number, number], stalk: 0.05 };
		const banded: ExtraSpec = { ...ACORN, share: 1, shape, bandColour: [0.3, 0.23, 0.15] };
		const input = dressed(oakRecord({ extras: [banded] }), 'summer');
		const mesh = extrasMesh(input, 0);
		const plain = extrasMesh(
			dressed(oakRecord({ extras: [{ ...banded, bandColour: undefined }] }), 'summer'),
			0,
		);
		if (!mesh || !plain) throw new Error('no acorns');
		// The stalk's two rings of five, then the body: its six profile rings, two scale rows and
		// a second ring at the band's end, nine vertices each.
		const stalk = 10;
		const perAcorn = stalk + (6 + 2 + 1) * 9;
		expect(mesh.positions.length / 3).toBe(input.rows.count * perAcorn);
		expect(plain.positions.length / 3).toBe(input.rows.count * (perAcorn - 9));
		const share = (vertex: number) => mesh.uvs1[vertex * 2] as number;
		for (let v = 0; v < stalk; v++) expect(share(v)).toBe(1);
		// Rings from the cup's foot to its rim take the band; the ring that repeats the rim, and
		// every ring past it, take the body.
		const rings = (mesh.positions.length / 3 / input.rows.count - stalk) / 9;
		const shares = Array.from({ length: rings }, (_, ring) => share(stalk + ring * 9));
		expect(shares).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0]);
		const at = (vertex: number) => [0, 1, 2].map((k) => mesh.positions[vertex * 3 + k] as number);
		expect(at(stalk + 4 * 9)).toEqual(at(stalk + 5 * 9));
		// No faces join the two rings at the edge, so none is drawn flat across it.
		const edge = new Set(
			[stalk + 4 * 9, stalk + 5 * 9].flatMap((r) => Array.from({ length: 9 }, (_, j) => r + j)),
		);
		for (let t = 0; t < mesh.indices.length; t += 3) {
			const corners = [0, 1, 2].map((k) => mesh.indices[t + k] as number);
			if (corners.every((c) => c < perAcorn))
				expect(corners.filter((c) => edge.has(c)).length).toBeLessThan(3);
		}
		for (let v = 0; v < plain.uvs1.length; v += 2) expect(plain.uvs1[v]).toBe(0);
	});

	it("shades a band's crevices toward the body by the shape's scale shade", () => {
		const lathe = (ACORN.shape as { lathe: readonly [number, number][] }).lathe;
		const scaled: [number, number] = [0, 0.033];
		const shape = { lathe, scales: 2, scaled, stalk: 0.05, scaleShade: 0.5 };
		const banded: ExtraSpec = { ...ACORN, share: 1, shape, bandColour: [0.3, 0.23, 0.15] };
		const mesh = extrasMesh(dressed(oakRecord({ extras: [banded] }), 'summer'), 0);
		if (!mesh) throw new Error('no acorns');
		// After the stalk's ten vertices, nine rings of nine: the band's five rings alternate a full
		// and a shaded share round the turn, offset from ring to ring, and the body's stay at none.
		const stalk = 10;
		for (let ring = 0; ring < 9; ring++)
			for (let j = 0; j < 9; j++) {
				const expected = ring < 5 ? ((j + ring) % 2 === 1 ? 0.5 : 1) : 0;
				expect(mesh.uvs1[(stalk + ring * 9 + j) * 2] as number).toBeCloseTo(expected, 9);
			}
	});

	it("varies each scale's shade by the shape's jitter, the same way every time", () => {
		const lathe = (ACORN.shape as { lathe: readonly [number, number][] }).lathe;
		const scaled: [number, number] = [0, 0.033];
		const at = (jitter: number) => {
			const shape = { lathe, scales: 2, scaled, stalk: 0.05, scaleJitter: jitter };
			const banded: ExtraSpec = { ...ACORN, share: 1, shape, bandColour: [0.3, 0.23, 0.15] };
			const mesh = extrasMesh(dressed(oakRecord({ extras: [banded] }), 'summer'), 0);
			if (!mesh) throw new Error('no acorns');
			return Array.from({ length: 45 }, (_, k) => mesh.uvs1[(10 + k) * 2] as number);
		};
		// Without the field the band's shares are the even ones, and the jitter changes nothing else.
		const even = at(0);
		for (const share of even) expect(share === 0 || share === 1).toBe(true);
		const varied = at(0.4);
		expect(varied).not.toEqual(even);
		expect(at(0.4)).toEqual(varied);
		for (const [k, share] of varied.entries())
			if ((even[k] as number) > 0) {
				expect(share).toBeGreaterThan(0);
				expect(share).toBeLessThanOrEqual(1);
			}
	});

	it("turns a scaled lathe's normals with its profile", () => {
		// The nut closes from 7.5 mm to a point over its last 5 mm: there its surface faces down the
		// hang, whatever the scale rows above do.
		const lathe = (ACORN.shape as { lathe: readonly [number, number][] }).lathe;
		const scaled: ExtraSpec = {
			...ACORN,
			share: 1,
			shape: { lathe, scales: 2, scaled: [0, 0.03] },
		};
		const mesh = extrasMesh(dressed(oakRecord({ extras: [scaled] }), 'summer'), 0);
		if (!mesh) throw new Error('no acorns');
		// The ring at 55 mm, the profile's fifth point after two scale rows: the seventh ring. The
		// profile falls 8 mm over the 18 mm round it, so the normal leans down by that slope.
		const ring = 6 * 9;
		const rise = (0 - 0.008) / (0.06 - 0.042);
		for (let j = 0; j < 8; j++) {
			const down = -(mesh.normals[(ring + j) * 3 + 1] as number);
			expect(down).toBeCloseTo(-rise / Math.hypot(1, rise), 3);
		}
	});

	it("gives the nearest level's stalks the faces the shape names, and the farther levels four", () => {
		const lathe = (ACORN.shape as { lathe: readonly [number, number][] }).lathe;
		const shape = { lathe, sides: 24, stalk: 0.05 };
		const named: ExtraSpec = { ...ACORN, share: 1, shape: { ...shape, stalkSides: 8 } };
		const input = dressed(oakRecord({ extras: [named] }), 'summer');
		const vertices = (extra: ExtraSpec, level: 0 | 1) => {
			const mesh = extrasMesh(dressed(oakRecord({ extras: [extra] }), 'summer'), level);
			if (!mesh) throw new Error('no acorns');
			return mesh.positions.length / 3;
		};
		// The sides and the seam round each of the stalk's two rings, then the body's 25 a ring.
		expect(vertices(named, 0)).toBe(input.rows.count * (2 * 9 + lathe.length * 25));
		expect(vertices({ ...named, shape }, 0)).toBe(input.rows.count * (2 * 5 + lathe.length * 25));
		// The farther level draws its stalks with four faces whatever the shape names. A fruit ten
		// times the size stands out far enough for that level to keep it.
		const big = lathe.map(([r, h]) => [r * 10, h * 10] as [number, number]);
		const far = { ...shape, lathe: big };
		expect(vertices({ ...named, shape: { ...far, stalkSides: 8 } }, 1)).toBe(
			vertices({ ...named, shape: far }, 1),
		);
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

describe('the one-winged key', () => {
	/** Four vertices round each station of a key's lens. */
	const RING = 4;
	/** A key's shape: a seed body of about a third, and a wing three times as long as it is wide. */
	const KEY = { length: 0.032, width: 0.01, body: 0.32 } as const;

	/** A key's mesh alone, hanging straight down from the origin. */
	function key(shape: { length: number; width: number; body: number; twist?: number } = KEY) {
		const mesh = new MeshWriter();
		samaraMesh(mesh, shape, [0, 0, 0], [0, -1, 0], 0, [0, 0, 0, 255]);
		return mesh;
	}

	/** The bounds of a mesh's positions, axis by axis. */
	function bounds(mesh: MeshWriter) {
		const low = [Infinity, Infinity, Infinity];
		const high = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < mesh.positions.length; i += 3)
			for (let axis = 0; axis < 3; axis++) {
				const value = mesh.positions[i + axis] as number;
				low[axis] = Math.min(low[axis] as number, value);
				high[axis] = Math.max(high[axis] as number, value);
			}
		return { low, high };
	}

	it('hangs its length below the site, and its wing as wide as the record says', () => {
		const { low, high } = bounds(key());
		// The wing's tip stands the record's length below the site, and the body's foot reaches a
		// little way above it, inside the stalk it hangs from.
		expect(low[1] as number).toBeCloseTo(-KEY.length, 6);
		expect(high[1] as number).toBeGreaterThanOrEqual(0);
		expect(high[1] as number).toBeLessThanOrEqual(0.005);
		expect((high[2] as number) - (low[2] as number)).toBeCloseTo(KEY.width, 4);
	});

	it('draws a flat lens, thin through the wing and broad across it', () => {
		const { low, high } = bounds(key());
		const across = (high[2] as number) - (low[2] as number);
		const through = (high[0] as number) - (low[0] as number);
		expect(through).toBeLessThan(across * 0.3);
	});

	it('turns the lens about its own length without moving it', () => {
		const flat = bounds(key());
		const turned = bounds(key({ ...KEY, twist: 90 }));
		expect(turned.low[1]).toBeCloseTo(flat.low[1] as number, 6);
		// A quarter turn puts the wing's width where its thickness stood.
		expect((turned.high[0] as number) - (turned.low[0] as number)).toBeCloseTo(KEY.width, 4);
		expect((turned.high[2] as number) - (turned.low[2] as number)).toBeCloseTo(
			(flat.high[0] as number) - (flat.low[0] as number),
			6,
		);
	});

	it('closes a ring of four at every station, so it reads from both faces', () => {
		const mesh = key();
		const rings = mesh.positions.length / 3 / RING;
		expect(rings).toBeGreaterThanOrEqual(4);
		expect((mesh.positions.length / 3) % RING).toBe(0);
		// Four faces close each pair of rings, but the body's last ring stands again as the wing's
		// first, so that pair carries the colour change and no faces.
		expect(mesh.indices.length / 3).toBe(8 * (rings - 2));
	});

	it("marks the seed body as the extra's band, so its colour stands apart from the wing", () => {
		const mesh = key();
		const rings = mesh.positions.length / 3 / RING;
		const banded: number[] = [];
		for (let r = 0; r < rings; r++) if ((mesh.uvs1[r * RING * 2] as number) === 1) banded.push(r);
		expect((banded[0] as number) ?? -1).toBe(0);
		expect(banded.length).toBeGreaterThan(1);
		expect(banded.length).toBeLessThan(rings);
		// The wing's first ring stands where the body's last does, so the colour changes at a sharp
		// edge rather than along the wing.
		const last = banded[banded.length - 1] as number;
		expect(mesh.uvs1[(last + 1) * RING * 2] as number).toBe(0);
		expect(mesh.positions[(last + 1) * RING * 3 + 1] as number).toBeCloseTo(
			mesh.positions[last * RING * 3 + 1] as number,
			6,
		);
	});

	it('draws a bunch of keys on the sites its record names, in its season', () => {
		const keyed: ExtraSpec = {
			kind: 'fruit',
			at: 'shoot-tip',
			share: 1,
			count: { mean: 3, spread: 0 },
			seasons: ['summer', 'autumn'],
			shape: { samara: KEY, stalk: 0.02, pedicel: 0.01 },
			colour: [0.3, 0.3, 0.09],
			hang: 180,
		};
		const record = oakRecord({ extras: [keyed] });
		const summer = extrasMesh(dressed(record, 'summer'), 0);
		if (!summer) throw new Error('no keys');
		expect(extrasMesh(dressed(record, 'winter'), 0)).toBeUndefined();
		// Every key hangs its own length and more below the highest point of its bunch.
		let lowest = Infinity;
		let highest = -Infinity;
		for (let i = 1; i < summer.positions.length; i += 3) {
			lowest = Math.min(lowest, summer.positions[i] as number);
			highest = Math.max(highest, summer.positions[i] as number);
		}
		expect(highest - lowest).toBeGreaterThan(KEY.length);
	});
});
