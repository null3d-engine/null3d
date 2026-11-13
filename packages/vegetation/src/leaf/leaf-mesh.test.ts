// The blade leaf mesh: its texture footprint covers the oak leaf's coverage at every tier, its shape
// in space follows the record's fold, curl and droop, and its compound form places its leaflets.
//
// The oak's outline and coverage are the textures tool's own, from slot 24 of the reference set: the
// manifest's 64-point outline, and the upper layer's coverage at the half cutoff, 512 texels a side,
// held as runs of covered texels per row with row 0 at the stalk end.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { LeafShape } from '../core/record';
import { DETAILS, type Detail } from '../core/types';
import { compoundLeaf, leafletPlaces, RACHIS_TIP_SHARE, rachisWidth } from './compound';
import {
	type CoverageRuns,
	intersectionOverUnion,
	maskFromRuns,
	rasteriseTriangles,
} from './coverage.test-support';
import { bladeMesh, builder, leafTriangles } from './leaf-mesh';
import { OAK_MANIFEST, oakRecord } from './oak.test-support';
import { parametricOutline, signedArea, textureOutline } from './outline';

/** The oak leaf's coverage beside its manifest in the textures package. */
const COVERAGE = new URL(
	'../../../vegetation-textures/textures/pedunculate-oak/leaf-coverage.json',
	import.meta.url,
);

const mask = maskFromRuns(JSON.parse(readFileSync(COVERAGE, 'utf8')) as CoverageRuns);
const oak = textureOutline(OAK_MANIFEST.leaf as NonNullable<typeof OAK_MANIFEST.leaf>);

/** A leaf with no bend at all, so its mesh lies flat. */
const FLAT: LeafShape = {
	length: 0.1,
	outline: 'texture',
	petiole: { length: 0.005, radius: 0.0008, flat: 0, droop: 0 },
	fold: 0,
	curl: 0,
	crossCurl: 0,
	twist: 0,
	wave: [0, 0],
	optics: {
		reflectance: [0.05, 0.1, 0.03],
		reflectanceBack: [0.08, 0.12, 0.06],
		transmittance: [0.06, 0.12, 0.02],
		roughness: [0.45, 0.6],
	},
};

/** The overlap of a tier's flat leaf with the oak's coverage. */
function overlap(detail: Detail): number {
	const { points, triangles } = leafTriangles(oak, detail);
	return intersectionOverUnion(mask, rasteriseTriangles(mask.size, points, triangles));
}

describe('the blade leaf mesh', () => {
	it('reads the oak outline counter-clockwise, in 24 to 64 points', () => {
		expect(oak.points.length / 2).toBeGreaterThanOrEqual(24);
		expect(oak.points.length / 2).toBeLessThanOrEqual(64);
		expect(signedArea(oak.points)).toBeGreaterThan(0);
	});

	it("covers the oak leaf's coverage with an overlap of 0.95 at the high and ultra tiers", () => {
		const figures = Object.fromEntries(DETAILS.map((detail) => [detail, overlap(detail)]));
		expect(figures.high).toBeGreaterThanOrEqual(0.95);
		expect(figures.ultra).toBeGreaterThanOrEqual(0.95);
		expect(figures.medium).toBeGreaterThanOrEqual(0.9);
	});

	it('draws the low tier leaf as one cut-out card that holds every covered texel', () => {
		const { points, triangles } = leafTriangles(oak, 'low');
		expect(triangles.length / 3).toBe(2);
		const card = rasteriseTriangles(mask.size, points, triangles);
		let covered = 0;
		let held = 0;
		for (let i = 0; i < mask.covered.length; i++) {
			covered += mask.covered[i] as number;
			held += (mask.covered[i] as number) & (card.covered[i] as number);
		}
		expect(held / covered).toBeGreaterThanOrEqual(0.999);
		expect(bladeMesh(FLAT, oak, 'low').indices.length / 3).toBe(2);
	});

	it('keeps the triangles of a leaf within each tier', () => {
		const limits: Record<Detail, number> = { low: 2, medium: 44, high: 110, ultra: 300 };
		let previous = 0;
		for (const detail of DETAILS) {
			const triangles = bladeMesh(FLAT, oak, detail).indices.length / 3;
			expect(triangles).toBeLessThanOrEqual(limits[detail]);
			expect(triangles).toBeGreaterThan(previous);
			previous = triangles;
		}
	});

	it('lies flat facing +Z with no bend, the blade as long as the record says', () => {
		const leaf = bladeMesh({ ...FLAT, petiole: { ...FLAT.petiole, radius: 0 } }, oak, 'high');
		let top = 0;
		for (let i = 0; i < leaf.positions.length / 3; i++) {
			if ((leaf.colors[i * 4 + 2] as number) !== 0) continue;
			expect(Math.abs(leaf.normals[i * 3 + 2] as number)).toBeGreaterThan(0.999);
			top = Math.max(top, leaf.positions[i * 3 + 1] as number);
		}
		const scale = 0.1 / (oak.tip[1] - oak.base[1]);
		// The blade's top stands its length above the base, plus the drawn stalk below it.
		// The blade, the drawn stalk below it and the outline's margin, within the outline's reach past
		// the manifest's tip point.
		const expected = 0.1 + (oak.base[1] - oak.petiole[1]) * scale + (3 / 1024) * scale;
		expect(Math.abs(top - expected)).toBeLessThan(0.0015);
	});

	it('narrows across its midrib by its breadth, keeping its length and its texture places', () => {
		const whole = bladeMesh({ ...FLAT, petiole: { ...FLAT.petiole, radius: 0 } }, oak, 'high');
		const slim = bladeMesh(
			{ ...FLAT, breadth: 0.6, petiole: { ...FLAT.petiole, radius: 0 } },
			oak,
			'high',
		);
		expect(slim.positions.length).toBe(whole.positions.length);
		expect([...slim.uvs]).toEqual([...whole.uvs]);
		for (let i = 0; i < whole.positions.length / 3; i++) {
			expect(slim.positions[i * 3] as number).toBeCloseTo(
				0.6 * (whole.positions[i * 3] as number),
				6,
			);
			expect(slim.positions[i * 3 + 1] as number).toBeCloseTo(
				whole.positions[i * 3 + 1] as number,
				6,
			);
		}
	});

	it('folds its halves into a V and curls its tip down', () => {
		const leaf = bladeMesh({ ...FLAT, fold: 20, curl: 40 }, oak, 'high');
		let left = 0;
		let right = 0;
		let tipZ = 0;
		let tipY = 0;
		for (let i = 0; i < leaf.positions.length / 3; i++) {
			const x = leaf.positions[i * 3] as number;
			const y = leaf.positions[i * 3 + 1] as number;
			const nx = leaf.normals[i * 3] as number;
			if (y > tipY) {
				tipY = y;
				tipZ = leaf.positions[i * 3 + 2] as number;
			}
			if (y > 0.03 && y < 0.04) {
				if (x < -0.005) left = Math.max(left, nx);
				if (x > 0.005) right = Math.min(right, nx);
			}
		}
		// Each half tilts toward the midrib by the fold: its normal leans in by the fold's sine.
		expect(left).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 1);
		expect(right).toBeCloseTo(-Math.sin((20 * Math.PI) / 180), 1);
		expect(tipZ).toBeLessThan(-0.01);
	});

	it('meshes a parametric outline where a species has no texture leaf', () => {
		const outline = parametricOutline({
			width: [
				[0, 0.1],
				[0.5, 0.3],
				[1, 0.1],
			],
			tip: 'acuminate',
			base: 'cordate',
		});
		expect(signedArea(outline.points)).toBeGreaterThan(0);
		const leaf = bladeMesh(
			{ ...FLAT, outline: { width: 0.3, tip: 'acute', base: 'rounded' } },
			outline,
			'medium',
		);
		expect(leaf.indices.length).toBeGreaterThan(0);
	});
});

describe("a branch piece's leaf", () => {
	const record = oakRecord();
	const foliage = record.foliage;
	if (foliage.kind !== 'blade') throw new Error('the test oak has blade leaves');
	/** The oak with a stalk no longer than the texture's own, so a card draws no stalk of its own. */
	const stubby = {
		...record,
		foliage: {
			...foliage,
			leaf: { ...foliage.leaf, petiole: { ...foliage.leaf.petiole, length: 0 } },
		},
	};
	const pieceLeaves = builder.pieceLeaves;
	if (!pieceLeaves) throw new Error('the blade builder cuts piece leaves');
	const triangles = (detail: Detail) =>
		(pieceLeaves(stubby, OAK_MANIFEST, detail)[0]?.indices.length ?? 0) / 3;

	it('is a cut-out card at the low and medium tiers, folded along its midrib at the high tier', () => {
		expect(triangles('low')).toBe(2);
		expect(triangles('medium')).toBe(2);
		expect(triangles('high')).toBe(4);
	});

	it("keeps the crown's meshed outline at the ultra tier", () => {
		const own = pieceLeaves(record, OAK_MANIFEST, 'ultra')[0];
		const crown = builder.leaves(record, OAK_MANIFEST, 'ultra')[0];
		expect(own?.indices.length).toBe(crown?.indices.length);
		expect([...(own?.positions ?? [])]).toEqual([...(crown?.positions ?? [])]);
	});

	it("draws a ribbon stalk on a card where the leaf's stalk runs past the texture's", () => {
		const long = {
			...record,
			foliage: {
				...foliage,
				leaf: { ...foliage.leaf, petiole: { ...foliage.leaf.petiole, length: 0.03 } },
			},
		};
		expect((pieceLeaves(long, OAK_MANIFEST, 'high')[0]?.indices.length ?? 0) / 3).toBe(8);
		expect((pieceLeaves(long, OAK_MANIFEST, 'low')[0]?.indices.length ?? 0) / 3).toBe(2);
	});
});

describe('the compound leaf', () => {
	it('places pinnate leaflets in opposite pairs with a terminal one', () => {
		const places = leafletPlaces(
			{ kind: 'pinnate', leaflets: 9, rachis: 2.5, terminal: true },
			0.05,
			0.2,
		);
		expect(places).toHaveLength(9);
		expect(places.filter((p) => p.angle < 0)).toHaveLength(4);
		expect(places.at(-1)?.angle).toBe(0);
	});

	it('fans palmate leaflets from one point, the middle one longest', () => {
		const places = leafletPlaces(
			{ kind: 'palmate', leaflets: 7, rachis: 1, terminal: false },
			0.1,
			0.12,
		);
		expect(new Set(places.map((p) => p.at)).size).toBe(1);
		expect(places[3]?.scale).toBe(Math.max(...places.map((p) => p.scale)));
	});

	it('cuts its leaflets coarser than the leaf, one tier a step unless the record asks otherwise', () => {
		const leaf = (leafletStep?: number) => ({
			kind: 'blade' as const,
			leaf: { ...FLAT, length: { mean: 0.05, spread: 0 } },
			compound: {
				kind: 'pinnate' as const,
				leaflets: { mean: 9, spread: 0 },
				rachis: 3,
				terminal: true,
				...(leafletStep === undefined ? {} : { leafletStep }),
			},
		});
		const vertices = (leafletStep?: number): number => {
			const record = oakRecord({ foliage: leaf(leafletStep) });
			return builder.leaves(record, OAK_MANIFEST, 'ultra')[0]?.positions.length ?? 0;
		};
		const finest = vertices(0);
		const one = vertices(1);
		const two = vertices(2);
		expect(one).toBeLessThan(finest);
		expect(two).toBeLessThan(one);
		// A record that names no step cuts its leaflets one tier below its own leaf.
		expect(vertices()).toBe(one);
	});

	it('spreads its leaflets by the record angle, and by the builder own when it names none', () => {
		const spread = (angle?: number): number => {
			const places = leafletPlaces(
				{
					kind: 'pinnate',
					leaflets: 9,
					rachis: 2.5,
					terminal: true,
					...(angle === undefined ? {} : { angle }),
				},
				0.05,
				0.2,
			);
			return Math.max(...places.map((p) => Math.abs(p.angle)));
		};
		expect(spread()).toBe(spread(62));
		expect(spread(74)).toBeGreaterThan(spread());
		expect(spread(30)).toBeLessThan(spread());
	});

	it('meets the rachis with its leaflet blade when the record asks for no stalk', () => {
		const leaf = (leafletStalk?: number) => ({
			kind: 'blade' as const,
			leaf: { ...FLAT, length: { mean: 0.05, spread: 0 } },
			compound: {
				kind: 'pinnate' as const,
				leaflets: { mean: 9, spread: 0 },
				rachis: 3,
				terminal: true,
				...(leafletStalk === undefined ? {} : { leafletStalk }),
			},
		});
		const vertices = (leafletStalk?: number): number =>
			builder.leaves(oakRecord({ foliage: leaf(leafletStalk) }), OAK_MANIFEST, 'ultra')[0]
				?.positions.length ?? 0;
		// A leaflet's stalk is drawn from the texture's own stalk band, so a sessile leaflet draws
		// none and its blade begins where it meets the rachis.
		expect(vertices(0)).toBeLessThan(vertices());
		// A shortened stalk still draws, and a record that names no share keeps the whole of it.
		expect(vertices(0.5)).toBe(vertices());
		expect(vertices(1)).toBe(vertices());
	});

	it('holds its rachis to a named share of its base width at the tip', () => {
		// A leaf's outline runs to nothing at its tip, but the rachis carries the last pair, so a
		// rachis that tapered with the outline would leave those leaflets on a thread the coverage
		// mask cannot follow. The tip therefore keeps a share of the base width.
		const base = 0.002;
		expect(rachisWidth(base, 0)).toBeCloseTo(base, 12);
		expect(rachisWidth(base, 1)).toBeCloseTo(base * RACHIS_TIP_SHARE, 12);
		expect(rachisWidth(base, 0.5)).toBeGreaterThan(rachisWidth(base, 1));
		// Under a half the rachis reads as a thread rather than a line, so the share stays above it.
		expect(RACHIS_TIP_SHARE).toBeGreaterThanOrEqual(0.5);
	});

	it('draws its last rachis ring at that share of the first', () => {
		const leaf = compoundLeaf(
			FLAT,
			{ kind: 'pinnate', leaflets: 9, rachis: 2, terminal: true },
			oak,
			bladeMesh(FLAT, oak, 'high'),
			'high',
		);
		// The rachis comes first, five rings of a triangle plus its centre, so four vertices a ring.
		const ring = 4;
		const radius = (r: number): number => {
			let cx = 0;
			let cy = 0;
			let cz = 0;
			for (let k = 0; k < ring; k++) {
				cx += leaf.positions[(r * ring + k) * 3] as number;
				cy += leaf.positions[(r * ring + k) * 3 + 1] as number;
				cz += leaf.positions[(r * ring + k) * 3 + 2] as number;
			}
			cx /= ring;
			cy /= ring;
			cz /= ring;
			let total = 0;
			for (let k = 0; k < ring; k++) {
				const dx = (leaf.positions[(r * ring + k) * 3] as number) - cx;
				const dy = (leaf.positions[(r * ring + k) * 3 + 1] as number) - cy;
				const dz = (leaf.positions[(r * ring + k) * 3 + 2] as number) - cz;
				total += Math.sqrt(dx * dx + dy * dy + dz * dz);
			}
			return total / ring;
		};
		expect(radius(4) / radius(0)).toBeCloseTo(RACHIS_TIP_SHARE, 3);
	});

	it('leaves a simple leaf unchanged, because only a compound leaf draws a rachis', () => {
		const simple = oakRecord({ foliage: { kind: 'blade', leaf: FLAT } });
		for (const detail of DETAILS) {
			const built = builder.leaves(simple, OAK_MANIFEST, detail)[0];
			const blade = bladeMesh(FLAT, oak, detail);
			expect(built?.positions.length).toBe(blade.positions.length);
			expect(built?.indices.length).toBe(blade.indices.length);
		}
	});

	it('builds one mesh with every leaflet', () => {
		const leaflet = bladeMesh(FLAT, oak, 'low');
		const leaf = compoundLeaf(
			FLAT,
			{ kind: 'pinnate', leaflets: 7, rachis: 2, terminal: true },
			oak,
			leaflet,
			'low',
		);
		expect(leaf.indices.length).toBeGreaterThanOrEqual(leaflet.indices.length * 7);
	});
});
