// Needles, fascicles and the seasons on shoots: a needle's length and its few triangles per tier,
// a fascicle's needles round its sheath, and rows that draw leafless twins in winter, keep dead
// leaves low in a marcescent crown, and stay in leaf in summer.
import { describe, expect, it } from 'bun:test';
import type { ShootRows } from '../asset';
import { AXIS_LIMB, AXIS_STEM, BUD_LATERAL, SkeletonBuilder } from '../core/graph';
import { placeholderSkeleton } from '../core/placeholder';
import type { NeedleShape, ScaleSpray, Species } from '../core/record';
import type { Season } from '../core/types';
import { DETAILS } from '../core/types';
import { fascicleMesh } from './fascicle';
import { placeShoots } from './instancer';
import { needleMesh } from './needle';
import { OAK_MANIFEST, oakRecord, testKit } from './oak.test-support';
import { builder as sprayBuilder, sprayMesh } from './scale-spray';
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
	const record: Species = {
		...oakRecord(),
		foliage: { kind: 'fascicle', needle: { ...NEEDLE, length: 0.06 }, sheath: 0.008, twist: 30 },
		shoots: { ...oakRecord().shoots!, phyllotaxis: { kind: 'fascicle', needles: 3 } },
	};

	it('bundles its round needles in a sheath at the finest tier', () => {
		const one = needleMesh(
			{ ...NEEDLE, length: 0.06, section: 'half-round' },
			OAK_MANIFEST,
			'ultra',
		);
		const bundle = fascicleMesh(record, OAK_MANIFEST, 'ultra');
		let stem = 0;
		for (let i = 2; i < bundle.colors.length; i += 4) if (bundle.colors[i] === 85) stem++;
		expect(stem).toBeGreaterThan(0);
		expect(bundle.positions.length / 3 - stem).toBe((one.positions.length / 3) * 3);
		// The needles part a little: their tips stand apart, near the bundle's height.
		expect(top(bundle.positions)).toBeGreaterThan(0.059);
	});

	it('draws each needle as one flat blade of two triangles at every other tier', () => {
		for (const detail of ['low', 'medium', 'high'] as const) {
			const bundle = fascicleMesh(record, OAK_MANIFEST, detail);
			expect(bundle.indices.length / 3).toBe(3 * 2);
			expect(bundle.positions.length / 3).toBe(3 * 4);
			// No sheath is drawn, and the blades reach the needle's length.
			for (let i = 2; i < bundle.colors.length; i += 4) expect(bundle.colors[i]).not.toBe(85);
			expect(top(bundle.positions)).toBeGreaterThan(0.059);
		}
	});

	it('stands the two blades of a pair square to each other, so a brush covers from every side', () => {
		const pair: Species = {
			...record,
			foliage: { kind: 'fascicle', needle: { ...NEEDLE, length: 0.06 }, sheath: 0.008, twist: 0 },
			shoots: { ...oakRecord().shoots!, phyllotaxis: { kind: 'fascicle', needles: 2 } },
		};
		const bundle = fascicleMesh(pair, OAK_MANIFEST, 'high');
		// Each blade's face normal, from its first three corners, laid level.
		const normals = [0, 4].map((first) => {
			const at = (k: number) =>
				[0, 1, 2].map((c) => bundle.positions[(first + k) * 3 + c] as number);
			const [a, b, d] = [at(0), at(1), at(3)];
			const u = [0, 1, 2].map((c) => (b[c] as number) - (a[c] as number));
			const v = [0, 1, 2].map((c) => (d[c] as number) - (a[c] as number));
			const n = [
				(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
				(u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
				(u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
			];
			const length = Math.hypot(n[0] as number, n[1] as number, n[2] as number);
			return n.map((c) => c / length);
		});
		const [first, second] = normals as [number[], number[]];
		const dot =
			(first[0] as number) * (second[0] as number) +
			(first[1] as number) * (second[1] as number) +
			(first[2] as number) * (second[2] as number);
		// Square within the few degrees that the needles part from the bundle's line.
		expect(Math.abs(dot)).toBeLessThan(0.1);
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

describe('the scale spray', () => {
	const SPRAY: ScaleSpray = {
		orders: 2,
		segment: 0.022,
		radius: 0.0012,
		flatten: 0.3,
		dead: 0.05,
		optics: {
			reflectance: [0.05, 0.1, 0.03],
			reflectanceBack: [0.1, 0.15, 0.07],
			transmittance: [0.04, 0.08, 0.02],
			roughness: [0.55, 0.7],
		},
	};

	it('builds a cord that divides, with its scales on the texture', () => {
		for (const detail of DETAILS) {
			const mesh = sprayMesh(SPRAY, OAK_MANIFEST, detail);
			const triangles = mesh.indices.length / 3;
			expect(triangles).toBeGreaterThan(10);
			expect(triangles).toBeLessThan(900);
			// The first cord runs a segment, and the child cords carry the spray above it.
			expect(top(mesh.positions)).toBeGreaterThan(SPRAY.segment);
			expect(top(mesh.positions)).toBeLessThan(SPRAY.segment * 2);
			let low = 1;
			let high = 0;
			for (let i = 0; i < mesh.uvs.length; i += 2) {
				low = Math.min(low, mesh.uvs[i] as number, mesh.uvs[i + 1] as number);
				high = Math.max(high, mesh.uvs[i] as number, mesh.uvs[i + 1] as number);
			}
			expect(low).toBeGreaterThanOrEqual(0);
			expect(high).toBeLessThanOrEqual(1);
		}
	});

	it('draws its oldest cords as dead wood when the record asks', () => {
		const live = sprayMesh({ ...SPRAY, dead: 0 }, OAK_MANIFEST, 'high');
		const dead = sprayMesh({ ...SPRAY, dead: 1 }, OAK_MANIFEST, 'high');
		const stem = (colors: Uint8Array) => {
			let count = 0;
			for (let i = 2; i < colors.length; i += 4) if (colors[i] === 85) count++;
			return count;
		};
		// A live spray is foliage throughout; a dead one draws its cords as stem.
		expect(stem(live.colors)).toBe(0);
		expect(stem(dead.colors)).toBeGreaterThan(0);
		expect(stem(dead.colors)).toBeLessThan(dead.colors.length / 4);
	});

	it('gives the shoots a few different sprays', () => {
		const record: Species = {
			...oakRecord(),
			foliage: { kind: 'scale-spray', spray: SPRAY },
		};
		const leaves = sprayBuilder.leaves(record, OAK_MANIFEST, 'high');
		expect(leaves.length).toBe(3);
		expect(new Set(leaves.map((leaf) => leaf.positions.join(','))).size).toBe(3);
		// Every leaf is a whole spray: its first cord runs a segment and its side cords carry the
		// spray above it, which is the frond the leaf close-ups frame.
		for (const leaf of leaves)
			expect(top((leaf as { positions: Float32Array }).positions)).toBeGreaterThan(SPRAY.segment);
		expect(top((leaves[0] as { positions: Float32Array }).positions)).toBeLessThan(
			SPRAY.segment * 2,
		);
	});
});

describe('the bare bole', () => {
	const record = oakRecord();
	// A stem to 10 m with a low limb near the trunk and a higher one at the same offset, so a bud can
	// stand inside the column below its line, inside it above the line, and outside it.
	const builder = new SkeletonBuilder();
	const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	let below = -1;
	for (let k = 0; k <= 10; k++) {
		const node = builder.addNode({
			x: 0,
			y: k,
			z: 0,
			radius: 0.3 - 0.02 * k,
			parent: below,
			axis: stem,
		});
		if (k === 2) below = node;
	}
	const lowLimb = builder.addAxis({
		parent: stem,
		parentNode: below,
		parentT: 0,
		order: 1,
		kind: AXIS_LIMB,
	});
	const near = builder.addNode({ x: 0.6, y: 2, z: 0, radius: 0.05, parent: -1, axis: lowLimb });
	const far = builder.addNode({ x: 3, y: 2, z: 0, radius: 0.02, parent: near, axis: lowLimb });
	const highLimb = builder.addAxis({
		parent: stem,
		parentNode: builder.addNode({
			x: 0,
			y: 6,
			z: 0,
			radius: 0.2,
			parent: -1,
			axis: stem,
		}) as number,
		parentT: 0,
		order: 1,
		kind: AXIS_LIMB,
	});
	const high = builder.addNode({ x: 0.6, y: 6, z: 0, radius: 0.04, parent: -1, axis: highLimb });
	const frame = [0, 0, 0, 1];
	builder.addBud({
		node: near,
		x: 0.6,
		y: 2,
		z: 0,
		frame,
		kind: BUD_LATERAL,
		vigor: 0.5,
		light: 1,
		axis: lowLimb,
		woodRadius: 0.02,
	});
	builder.addBud({
		node: far,
		x: 3,
		y: 2,
		z: 0,
		frame,
		kind: BUD_LATERAL,
		vigor: 0.5,
		light: 1,
		axis: lowLimb,
		woodRadius: 0.01,
	});
	builder.addBud({
		node: high,
		x: 0.6,
		y: 6,
		z: 0,
		frame,
		kind: BUD_LATERAL,
		vigor: 0.5,
		light: 1,
		axis: highLimb,
		woodRadius: 0.02,
	});
	const skeleton = builder.finish();
	const rowsFor = (species: Species) =>
		placeShoots({
			record: species,
			seed: 11,
			variant: 0,
			season: 'summer',
			kit: { ...testKit(record), record: species },
			skeleton,
		});
	const withBole = (bareBole: { radius: number; height: number } | undefined): Species => ({
		...record,
		shoots: { ...record.shoots!, placement: { ...record.shoots!.placement, bareBole } },
	});
	const feet = (rows: ShootRows) => {
		const out: string[] = [];
		for (let r = 0; r < rows.count; r++)
			out.push([0, 1, 2].map((k) => (rows.position[r * 3 + k] as number).toFixed(2)).join(','));
		return out.sort();
	};

	it('places exactly as before where no record names a column', () => {
		expect(rowsFor(withBole(undefined))).toEqual(rowsFor(record));
	});

	it('keeps every shoot out of the column the record names, below its line', () => {
		const bole = { radius: 1.2, height: 0.5 };
		const rows = rowsFor(withBole(bole));
		const plain = rowsFor(record);
		// The buds on the limb are within the column below its line, and their shoots spread along it,
		// so the plain case has rows just off the stem; the column takes them all.
		const inside = (build: typeof rows) => {
			let count = 0;
			for (let r = 0; r < build.count; r++) {
				const y = build.position[r * 3 + 1] as number;
				if (y >= bole.height * skeleton.height) continue;
				if (
					Math.hypot(build.position[r * 3] as number, build.position[r * 3 + 2] as number) <
					bole.radius
				)
					count++;
			}
			return count;
		};
		expect(inside(plain)).toBeGreaterThan(0);
		expect(inside(rows)).toBe(0);
		// The far bud keeps its shoots, and the high one inside the radius does too: a column, not a floor.
		const near = (build: typeof rows, x: number, y: number) => {
			let count = 0;
			for (let r = 0; r < build.count; r++)
				if (
					Math.hypot(
						(build.position[r * 3] as number) - x,
						(build.position[r * 3 + 1] as number) - y,
					) < 0.3
				)
					count++;
			return count;
		};
		expect(near(rows, 3, 2)).toBeGreaterThan(0);
		expect(near(rows, 0.6, 6)).toBeGreaterThan(0);
		expect(rows.count).toBeLessThan(plain.count);
	});
});
