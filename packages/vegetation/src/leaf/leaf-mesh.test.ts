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
import { compoundLeaf, leafletPlaces } from './compound';
import {
	type CoverageRuns,
	intersectionOverUnion,
	maskFromRuns,
	rasteriseTriangles,
} from './coverage.test-support';
import { bladeMesh, leafTriangles } from './leaf-mesh';
import { OAK_MANIFEST } from './oak.test-support';
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
		expect(figures.low).toBeGreaterThanOrEqual(0.8);
	});

	it('keeps the triangles of a leaf within each tier', () => {
		const limits: Record<Detail, number> = { low: 24, medium: 44, high: 110, ultra: 300 };
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
