// The desert's walk view in the CPU model: what null3D draws now per kind, and what groups of 64 and
// 128 triangles would drop, per test, for all copies and for the K heaviest copies of each mesh, in
// the camera's pass and in each shadow cascade. `--samples <n>` sets how many times of the lap it
// takes (default 20), `--out <file>` where it writes the JSON.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	cameraAt,
	FAR,
	FOV_DEGREES,
	MESHES,
	NEAR,
	placements,
	SHADOWS,
	SUN,
} from '../pages/desert.js';
import { type Copy, copyOf } from './model.ts';
import { analyse, type SceneInput } from './run-model.ts';
import { ensureGroups, loadModel } from './scene.ts';

const args = process.argv.slice(2);
const opt = (name: string, d: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : d;
};
const samples = Number(opt('--samples', '20'));
const view = opt('--view', 'walk');
const models = join(import.meta.dirname, '../../../../target/group-culling/models/null3d-final');
const out = opt('--out', join(import.meta.dirname, `../results/model-desert-${view}.json`));

const props = join(models, 'props/props.glb');
const { meshes } = await loadModel(props);
const sizes = [64, 128];
for (const size of sizes) await ensureGroups(props, meshes, size);
const byName = new Map(meshes.map((m) => [m.name, m]));

// Each row is the placement applied after the node's own transform, as the null3D sketch does.
const copies: Copy[] = [];
const rows = placements() as Record<string, Float32Array>;
for (const [name, list] of Object.entries(rows)) {
	const mesh = byName.get(name);
	if (!mesh) throw new Error(`no mesh ${name}`);
	const [nx, ny, nz] = mesh.node.t;
	const [sx] = mesh.node.s;
	const kind = name.replace(/-\d+$/, '');
	for (let o = 0; o < list.length; o += 8) {
		const s = list[o + 7];
		const q = [list[o + 3], list[o + 4], list[o + 5], list[o + 6]];
		const t = rotate(q, nx * s, ny * s, nz * s);
		const world = trs([list[o] + t[0], list[o + 1] + t[1], list[o + 2] + t[2]], q, sx * s);
		copies.push(copyOf(mesh, kind, world));
	}
}
const ground = MESHES.find((m) => m.name === 'ground')?.build();

const input: SceneInput = {
	name: `desert-${view}`,
	copies,
	views: (args.includes('--times')
		? opt('--times', '').split(',').map(Number)
		: Array.from({ length: samples }, (_, i) => 8 + (i + 0.5) * (40 / samples))
	).map((t) => {
		// The page warms up for 8 seconds, then measures one 40-second lap.
		const { position, target } = cameraAt(view, t);
		return { label: `t=${t.toFixed(1)}`, eye: position, target };
	}),
	lens: { fovDegrees: FOV_DEGREES, near: NEAR, far: FAR, width: 1920, height: 1080, threshold: 1 },
	sun: SUN.direction,
	shadows: {
		count: SHADOWS.cascades,
		mapSize: SHADOWS.mapSize,
		distance: SHADOWS.distance,
		blend: 0.1,
	},
	sizes,
	extraDepth: [{ positions: ground.positions, indices: ground.indices }],
	...(args.includes('--depth-images') && {
		depthImages: join(import.meta.dirname, '../../../../target/group-culling/results'),
	}),
};
const result = analyse(input);
writeFileSync(out, JSON.stringify(result, null, '\t'));
console.log(`wrote ${out}`);

function rotate(q: number[], x: number, y: number, z: number): number[] {
	const [qx, qy, qz, qw] = q;
	const tx = 2 * (qy * z - qz * y);
	const ty = 2 * (qz * x - qx * z);
	const tz = 2 * (qx * y - qy * x);
	return [
		x + qw * tx + (qy * tz - qz * ty),
		y + qw * ty + (qz * tx - qx * tz),
		z + qw * tz + (qx * ty - qy * tx),
	];
}

/** A column-major matrix from a translation, a unit quaternion and a uniform scale. */
function trs(t: number[], q: number[], s: number): number[] {
	const [x, y, z, w] = q;
	return [
		(1 - 2 * (y * y + z * z)) * s,
		2 * (x * y + z * w) * s,
		2 * (x * z - y * w) * s,
		0,
		2 * (x * y - z * w) * s,
		(1 - 2 * (x * x + z * z)) * s,
		2 * (y * z + x * w) * s,
		0,
		2 * (x * z + y * w) * s,
		2 * (y * z - x * w) * s,
		(1 - 2 * (x * x + y * y)) * s,
		0,
		t[0],
		t[1],
		t[2],
		1,
	];
}
