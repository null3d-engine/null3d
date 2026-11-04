// Plans the desert props' levels with null3D's planner at several weights of the normals in the
// level error, to see how much of each level's stored error is the normals' and how the chain
// would change. The planner's shipped weight is 1: a normal's change of 1 counts like a distance
// of the mesh's whole size. three.js's meshlet levels weigh normals at 0.2 at the first level, down
// to 0.02 at its coarsest. Prints each level's triangles and error in millimeters.
// Run from the repository's root:
//   bun bench/research/triangle-budget/scripts/plan-weights.ts [mesh names, default pebble-0 boulder-0 column-0]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptSimplifier } from '../../../../packages/cli/node_modules/meshoptimizer/index.js';
import { cacheOrder } from '../../../../packages/cli/src/assets/geometry.js';
import {
	longestSide,
	planMeshLevels,
	simplifierFlags,
	weldList,
} from '../../../../packages/engine/levels/planner.js';
import { DESERT_MESHES } from '../../../scenes/desert.ts';

await MeshoptSimplifier.ready;
const names = process.argv.slice(2);
const wanted = names.length > 0 ? names : ['pebble-0', 'boulder-0', 'column-0'];
const WEIGHTS = [1, 0.25, 0.05, 0];
const meshopt = { simplifyWithAttributes: MeshoptSimplifier.simplifyWithAttributes, cacheOrder };
const results: Record<string, Record<string, { triangles: number; error: number }[]>> = {};
for (const mesh of DESERT_MESHES.filter((m) => wanted.includes(m.name))) {
	const data = mesh.build();
	const side = longestSide(data.positions);
	results[mesh.name] = {};
	for (const weight of WEIGHTS) {
		const started = performance.now();
		const list = weldList(
			{
				positions: data.positions,
				normal: { values: data.normals, size: 3 },
				color: null,
				tangent: null,
				texcoords: [],
				indices: Uint32Array.from(data.indices),
			},
			false,
			side,
		);
		list.weights = list.weights.map(() => weight);
		const levels = planMeshLevels(
			meshopt,
			[list],
			data.indices.length / 3,
			side,
			simplifierFlags(false),
		);
		const chain = levels.map((l) => ({ triangles: l.triangles, error: l.error }));
		(results[mesh.name] as Record<string, unknown>)[String(weight)] = chain;
		console.log(
			`${mesh.name} normals ${weight} (${((performance.now() - started) / 1000).toFixed(1)} s): ${chain
				.map((l) => `${l.triangles}@${(l.error * 1000).toFixed(1)}`)
				.join(' ')}`,
		);
	}
}
// Each run adds its meshes to the results of earlier runs.
const out = join(import.meta.dirname, '../results/plan-weights.json');
const earlier = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
writeFileSync(out, `${JSON.stringify({ ...earlier, ...results }, null, '\t')}\n`);
