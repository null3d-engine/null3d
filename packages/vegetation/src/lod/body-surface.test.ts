// The body surface, read on the Italian cypress's inner body: the model states the axis's steps,
// and the surface draws the family's own adaptive rings, so its mesh is the family's mesh to the
// byte. The rings, the triangles and the mesh's digest are pinned at each level.
import { beforeAll, describe, expect, it } from 'bun:test';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { AXIS_LIMB, SkeletonBuilder } from '../core/graph';
import { hashBytes } from '../core/hash';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { emitConifer } from '../grow/conifer';
import { species as cypressModule } from '../species/italian-cypress';
import { directed as cypress } from '../species/italian-cypress/directed';
import type { MeshInput } from '../stages';
import { meshWoodReport } from '../wood/wood-mesh';
import { type BodyNode, bodySurface } from './body-surface';

let kit: SpeciesKitData;
let asset: PlantAsset;
let input: MeshInput;

/** A hash of a mesh's arrays, so two draws of the same body compare byte for byte. */
function digest(arrays: readonly ArrayBufferView[]): string {
	let hash = 0;
	for (const view of arrays)
		hash = hashBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), hash);
	return String(hash);
}

beforeAll(async () => {
	await loadPlantCode(cypressModule.record);
	kit = buildKitNow(cypressModule, { detail: 'high', placeholders: 'missing' });
	asset = growPlantNow(kit, { seed: 11, variant: 0, season: 'summer', near: true });
	const { min, max } = asset.skeleton.bounds;
	input = {
		record: kit.record,
		seed: asset.seed,
		variant: asset.variant,
		season: asset.season,
		kit,
		skeleton: asset.skeleton,
		coarseness: asset.coarseness,
		rows: asset.shoots,
		crown: {
			cells: [1, 1, 1],
			min,
			cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
			sky: new Float32Array([1]),
		},
		detail: 'high',
	};
});

/** The cypress's inner body as the model states it. */
function body(): { readonly nodes: readonly BodyNode[]; readonly segments: number } {
	const model = emitConifer({
		record: cypress,
		seed: 11,
		variant: 0,
		season: cypress.seasons.default,
	});
	const axis = model.axes.find((one) => one.body === true);
	if (!axis?.nodes || axis.segments === undefined) throw new Error('the cypress has no body');
	return { nodes: axis.nodes, segments: axis.segments };
}

describe('the body surface', () => {
	it('draws the family’s adaptive rings from the stated steps', () => {
		const { nodes, segments } = body();
		expect(nodes.length).toBe(44);
		expect(segments).toBe(43);
		const drawn = ([0, 1, 2] as const).map((level) => bodySurface(nodes, segments, input, level));
		// The mesher adapts the 44 nodes: the rings it draws, not the steps the model states.
		expect(drawn.map((surface) => surface.rings)).toEqual([19, 18, 18]);
		expect(drawn.map((surface) => surface.triangles)).toEqual([3340, 1574, 787]);
	});

	it('draws the body the family’s own mesh draws, to the byte', () => {
		const { nodes, segments } = body();
		for (const level of [0, 1, 2] as const) {
			const surface = bodySurface(nodes, segments, input, level);
			// The same axis, meshed as the family's grower writes it: a parentless limb, unlit.
			const builder = new SkeletonBuilder();
			const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 1, kind: AXIS_LIMB });
			let previous = -1;
			for (const node of nodes)
				previous = builder.addNode({
					x: node.at[0],
					y: node.at[1],
					z: node.at[2],
					radius: node.radius,
					parent: previous,
					axis,
					light: 0,
				});
			const family = meshWoodReport({ ...input, skeleton: builder.finish(0) }, level);
			expect(digest([surface.mesh.positions, surface.mesh.normals, surface.mesh.indices])).toBe(
				digest([family.mesh.positions, family.mesh.normals, family.mesh.indices]),
			);
			expect(surface.mesh.uvs).toEqual(family.mesh.uvs);
		}
	});

	it('refuses a step count the axis does not hold', () => {
		const { nodes } = body();
		expect(() => bodySurface(nodes, 42, input, 1)).toThrow();
	});
});
