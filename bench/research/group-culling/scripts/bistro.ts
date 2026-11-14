// The Bistro street scene in the CPU model: each view of `bistro-views.js`, what null3D draws now
// per kind, and what groups of 64 and 128 triangles would drop per test. Every mesh is drawn once,
// so slots per mesh cover every copy; the N heaviest copies of the scene stand for a budget of
// slots. `--views a,b` picks views, `--depth-images` writes each view's depth image.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BISTRO_SCALE, BISTRO_VIEWS, FAR, FOV_DEGREES, NEAR } from '../pages/bistro-views.js';
import { SHADOWS, SUN } from '../pages/desert.js';
import { type Copy, copyOf } from './model.ts';
import { analyse } from './run-model.ts';
import { ensureGroups, loadModel } from './scene.ts';

const args = process.argv.slice(2);
const opt = (name: string, d: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : d;
};
const model = opt(
	'--model',
	join(import.meta.dirname, '../../../../target/group-culling/models/bistro/null3d/bistro.glb'),
);
const names = opt('--views', Object.keys(BISTRO_VIEWS).join(',')).split(',');
const sizes = [64, 128];
const { meshes, nodes } = await loadModel(model);
for (const size of sizes) await ensureGroups(model, meshes, size);

/** The kind a node counts under, by its name. */
function kindOf(name: string): string {
	const n = name.toLowerCase();
	if (n.includes('building')) return 'building';
	if (/^paris_street_\d/.test(n)) return 'street';
	if (/flower|hedge|ivy|plant|tree|leaf|bush/.test(n)) return 'foliage';
	return 'prop';
}

const copies: Copy[] = nodes.map(({ mesh, world, name }) =>
	copyOf(
		mesh,
		kindOf(name),
		world.map((v, i) => (i < 12 ? v * BISTRO_SCALE : i < 15 ? v * BISTRO_SCALE : v)),
	),
);
console.log(
	`${meshes.length} meshes, ${copies.length} copies, ${(meshes.reduce((s, m) => s + m.levels[0].triangles, 0) / 1e6).toFixed(2)} M base triangles`,
);
for (const name of names) {
	const v = (BISTRO_VIEWS as Record<string, { position: number[]; target: number[] }>)[name];
	const result = analyse({
		name: `bistro-${name}`,
		copies,
		views: [{ label: name, eye: v.position, target: v.target }],
		lens: {
			fovDegrees: FOV_DEGREES,
			near: NEAR,
			far: FAR,
			width: 1920,
			height: 1080,
			threshold: 1,
		},
		sun: SUN.direction,
		shadows: {
			count: SHADOWS.cascades,
			mapSize: SHADOWS.mapSize,
			distance: SHADOWS.distance,
			blend: 0.1,
		},
		sizes,
		ks: [1],
		globalKs: [16, 32, 64, 128, 256],
		...(args.includes('--depth-images') && {
			depthImages: join(import.meta.dirname, '../../../../target/group-culling/results'),
		}),
	});
	const out = join(import.meta.dirname, `../results/model-bistro-${name}.json`);
	writeFileSync(out, JSON.stringify(result, null, '\t'));
	console.log(`wrote ${out}`);
}
