// The body surface, read on the Italian cypress's inner body: the model's ring count is the
// surface's, the sides follow the level and its coarsening, and every edge closes on two triangles.
// The axis's own rings and the drawn surface's rings are stated apart: the surface draws one ring
// for each step the model states.
import { describe, expect, it } from 'bun:test';
import { emitConifer } from '../grow/conifer';
import { directed as cypress } from '../species/italian-cypress/directed';
import { bodySurface } from './body-surface';

const model = emitConifer({
	record: cypress,
	seed: 11,
	variant: 0,
	season: cypress.seasons.default,
});
const body = model.axes.find((axis) => axis.body === true);

/** The ladder the allocator coarsens the wood by: a coarseness and a section sparsity each. */
const RUNGS: readonly (readonly [number, number])[] = [
	[0, 0],
	[0.5, 0],
	[1, 0],
	[1, 0.25],
	[1, 0.5],
	[1, 0.75],
	[1, 1],
];

describe('the body surface', () => {
	it('draws the cypress body’s stated rings at each level', () => {
		const nodes = body?.nodes;
		const segments = body?.segments;
		if (!nodes || segments === undefined) throw new Error('the cypress has no body');
		expect(nodes.length).toBe(44);
		expect(segments).toBe(43);
		const at = [
			bodySurface(nodes, segments, 0, 'high'),
			bodySurface(nodes, segments, 1, 'high'),
			bodySurface(nodes, segments, 2, 'high'),
		];
		for (const surface of at) {
			expect(surface.rings).toBe(43);
			expect(surface.positions.length / 3).toBe(43 * surface.sides + 2);
			expect(surface.triangles).toBe(2 * surface.sides * surface.rings);
			expect(surface.indices.length / 3).toBe(surface.triangles);
		}
		expect(at.map((surface) => surface.sides)).toEqual([96, 48, 24]);
		expect(at.map((surface) => surface.triangles)).toEqual([8256, 4128, 2064]);
	});

	it('coarsens its sides by the allocator’s ladder, with the triangles pinned', () => {
		const nodes = body?.nodes;
		const segments = body?.segments;
		if (!nodes || segments === undefined) throw new Error('the cypress has no body');
		const drawn = RUNGS.map(([coarseness, sections]) =>
			bodySurface(nodes, segments, 1, 'high', coarseness, sections),
		);
		expect(drawn.map((surface) => surface.sides)).toEqual([48, 48, 33, 12, 7, 5, 3]);
		expect(drawn.map((surface) => surface.triangles)).toEqual([
			4128, 4128, 2838, 1032, 602, 430, 258,
		]);
	});

	it('closes every edge on two triangles', () => {
		const nodes = body?.nodes;
		const segments = body?.segments;
		if (!nodes || segments === undefined) throw new Error('the cypress has no body');
		const surface = bodySurface(nodes, segments, 1, 'high', 1, 1);
		const edges = new Map<number, number>();
		const vertices = surface.positions.length / 3;
		for (let t = 0; t < surface.triangles; t++) {
			for (let k = 0; k < 3; k++) {
				const a = surface.indices[t * 3 + k] as number;
				const b = surface.indices[t * 3 + ((k + 1) % 3)] as number;
				const key = Math.min(a, b) * vertices + Math.max(a, b);
				edges.set(key, (edges.get(key) ?? 0) + 1);
			}
		}
		let open = 0;
		for (const count of edges.values()) if (count !== 2) open++;
		expect(open).toBe(0);
	});

	it('stands its ring vertices on the axis’s own radius', () => {
		const nodes = body?.nodes;
		const segments = body?.segments;
		if (!nodes || segments === undefined) throw new Error('the cypress has no body');
		const surface = bodySurface(nodes, segments, 1, 'high');
		const least = Math.min(...nodes.map((node) => node.radius));
		const most = Math.max(...nodes.map((node) => node.radius));
		let off = 0;
		for (let ring = 0; ring < surface.rings; ring++) {
			const cx = surface.centres[ring * 3] as number;
			const cy = surface.centres[ring * 3 + 1] as number;
			const cz = surface.centres[ring * 3 + 2] as number;
			let radius = 0;
			for (let j = 0; j < surface.sides; j++) {
				const i = (ring * surface.sides + j) * 3;
				const dx = (surface.positions[i] as number) - cx;
				const dy = (surface.positions[i + 1] as number) - cy;
				const dz = (surface.positions[i + 2] as number) - cz;
				const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (j === 0) radius = r;
				else if (Math.abs(r - radius) > 1e-3) off++;
			}
			// A ring is a circle at the axis's own radius for its place.
			if (radius < least - 1e-6 || radius > most + 1e-6) off++;
		}
		expect(off).toBe(0);
		// Every normal is a unit vector.
		for (let v = 0; v < surface.normals.length / 3; v++) {
			const x = surface.normals[v * 3] as number;
			const y = surface.normals[v * 3 + 1] as number;
			const z = surface.normals[v * 3 + 2] as number;
			expect(Math.abs(Math.sqrt(x * x + y * y + z * z) - 1)).toBeLessThan(1e-4);
		}
	});
});
