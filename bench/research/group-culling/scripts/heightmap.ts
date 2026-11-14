// Writes a top-down height map of a model's base levels, to pick camera views: each pixel the
// highest point in its cell of the ground plane, in meters after the scale, with a grid line every
// 10 meters. `bun heightmap.ts <model.glb> <scale> <out.png> [cell meters]`.
import { writeFileSync } from 'node:fs';
import { encode } from '../../../../packages/cli/node_modules/fast-png/lib/index.js';
import { loadModel } from './scene.ts';

const [path, scaleText, out, cellText] = process.argv.slice(2);
const scale = Number(scaleText);
const cell = Number(cellText ?? 0.25);
const { nodes } = await loadModel(path);
let x0 = Infinity,
	x1 = -Infinity,
	z0 = Infinity,
	z1 = -Infinity,
	y0 = Infinity,
	y1 = -Infinity;
const points: number[] = [];
for (const { mesh, world } of nodes) {
	const p = mesh.levels[0].positions;
	for (let i = 0; i < p.length; i += 3) {
		const x = (world[0] * p[i] + world[4] * p[i + 1] + world[8] * p[i + 2] + world[12]) * scale;
		const y = (world[1] * p[i] + world[5] * p[i + 1] + world[9] * p[i + 2] + world[13]) * scale;
		const z = (world[2] * p[i] + world[6] * p[i + 1] + world[10] * p[i + 2] + world[14]) * scale;
		points.push(x, y, z);
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		y0 = Math.min(y0, y);
		y1 = Math.max(y1, y);
		z0 = Math.min(z0, z);
		z1 = Math.max(z1, z);
	}
}
const W = Math.ceil((x1 - x0) / cell) + 1;
const H = Math.ceil((z1 - z0) / cell) + 1;
const top = new Float32Array(W * H).fill(-Infinity);
for (let i = 0; i < points.length; i += 3) {
	const u = Math.floor((points[i] - x0) / cell);
	const v = Math.floor((points[i + 2] - z0) / cell);
	top[v * W + u] = Math.max(top[v * W + u], points[i + 1]);
}
const data = new Uint8Array(W * H * 3);
for (let k = 0; k < W * H; k++) {
	const h = top[k];
	const g = h === -Infinity ? 0 : Math.round(40 + (215 * (h - y0)) / (y1 - y0));
	data[k * 3] = data[k * 3 + 1] = data[k * 3 + 2] = g;
	const u = k % W;
	const v = Math.floor(k / W);
	const wx = x0 + u * cell;
	const wz = z0 + v * cell;
	if (
		Math.abs(wx - Math.round(wx / 10) * 10) < cell / 2 ||
		Math.abs(wz - Math.round(wz / 10) * 10) < cell / 2
	) {
		data[k * 3] = 200;
		data[k * 3 + 1] = 0;
		data[k * 3 + 2] = 0;
	}
	if (Math.abs(wx) < cell || Math.abs(wz) < cell) data[k * 3 + 2] = 255;
}
writeFileSync(out, encode({ width: W, height: H, data, channels: 3, depth: 8 }));
console.log(
	`x ${x0.toFixed(1)}..${x1.toFixed(1)}, y ${y0.toFixed(1)}..${y1.toFixed(1)}, z ${z0.toFixed(1)}..${z1.toFixed(1)}; ${W} x ${H} px, ${cell} m each, x to the right, z down; red lines every 10 m, blue at 0`,
);
