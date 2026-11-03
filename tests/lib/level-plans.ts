// The levels that the asset tool's planner gives for a test mesh in this process, through the npm
// package of meshoptimizer at the version that the engine pins. The tests compare them with the
// levels that the engine's task gives on a job worker. Node only: the test pages import
// level-meshes.ts instead.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Meshopt } from '../../packages/engine/levels/planner.js';
import type { LevelArrays } from './level-meshes.ts';

/** What the test reads of meshoptimizer's npm package. */
interface NpmMeshopt {
	MeshoptSimplifier: {
		ready: Promise<void>;
		simplifyWithAttributes: Meshopt['simplifyWithAttributes'];
	};
	MeshoptEncoder: {
		ready: Promise<void>;
		reorderMesh(indices: Uint32Array, triangles: boolean, optsize: boolean): [Uint32Array, number];
	};
}

/** The levels that the asset tool's planner gives in this process, through the npm package. */
export async function nodeLevels(arrays: LevelArrays, cards: boolean, maxLevels: number) {
	const { meshoptPackage } = await import('../../tools/lib/meshopt-wasm.ts');
	const { MeshoptEncoder, MeshoptSimplifier } = (await import(
		pathToFileURL(join(meshoptPackage(), 'index.js')).href
	)) as NpmMeshopt;
	const planner = await import('../../packages/engine/levels/planner.js');
	await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);
	const meshopt: Meshopt = {
		simplifyWithAttributes: MeshoptSimplifier.simplifyWithAttributes,
		cacheOrder(indices) {
			// The tool's order: meshoptimizer's reorder, with its vertex numbering turned back.
			const work = indices.slice();
			const [remap] = MeshoptEncoder.reorderMesh(work, true, false);
			const back = new Uint32Array(remap.length);
			for (let i = 0; i < remap.length; i++) {
				const to = remap[i] as number;
				if (to !== 0xffffffff) back[to] = i;
			}
			return work.map((index) => back[index] as number);
		},
	};
	const side = planner.longestSide(arrays.positions);
	const list = planner.weldList(
		{
			positions: arrays.positions,
			normal: { values: arrays.normals, size: 3 },
			color: arrays.colors ? { values: arrays.colors, size: 4 } : null,
			tangent: null,
			texcoords: arrays.uvs ? [{ values: arrays.uvs, size: 2 }] : [],
			indices: arrays.indices.slice(),
		},
		false,
		side,
		cards,
	);
	return planner.planMeshLevels(
		meshopt,
		[list],
		arrays.indices.length / 3,
		side,
		planner.simplifierFlags(false),
		maxLevels,
	);
}
