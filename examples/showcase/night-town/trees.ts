// The night town's trees: snow-laden pines that ring the clearing, and bare trees beside the square
// strung with fairy lights. Pines and branches are made in code; the fairy lights are one sprite
// batch of small warm dots that twinkle. The pines thin out by the preset, so a phone draws few.
import { defineFeature, mat4, type QualityPreset, quat, type SketchContext } from '@null3d/engine';
import { markEffect } from '../../lib/layers';
import { random } from '../../lib/procedural';
import { groundHeight, offRoad } from './land';

/** Pines at each preset. */
const PINES: Record<QualityPreset, number> = { low: 90, medium: 200, high: 320, ultra: 400 };
/** Bare trees with fairy lights, near the square. */
const BARE = 6;
/** Dots of light on one bare tree. */
const LIGHTS_PER_TREE = 26;

/**
 * The pines' material: the standard surface, unchanged, so a pine that the GPU counts looks as it
 * did in a batch.
 */
const DEFAULT_SURFACE = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    return defaultSurface(input);
}
`;

/**
 * The compute shader that counts the pines: the count word takes the preset's share, which the page
 * gives in the first number of the pass's values.
 */
const PINE_COUNT = /* wgsl */ `
struct ComputeBlock {
    size: vec4f,
    clock: vec4f,
    inverseProjection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    drawn: vec4f,
    bloom: vec4f,
}

@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var<storage, read_write> counts: atomic<u32>;

@compute @workgroup_size(1)
fn main() {
    atomicStore(&counts, u32(block.u0.x));
}
`;

type V3 = readonly [number, number, number];
interface Build {
	positions: number[];
	colors: number[];
	uvs: number[];
	indices: number[];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};

/** Adds a ring of `sides` vertices about `center`, in the plane of `u` and `v`, and returns its first index. */
function ring(
	b: Build,
	center: V3,
	r: number,
	u: V3,
	v: V3,
	sides: number,
	color: V3,
	uv1: number,
): number {
	const first = b.positions.length / 3;
	for (let k = 0; k < sides; k++) {
		const ang = (k / sides) * Math.PI * 2;
		b.positions.push(
			center[0] + (u[0] * Math.cos(ang) + v[0] * Math.sin(ang)) * r,
			center[1] + (u[1] * Math.cos(ang) + v[1] * Math.sin(ang)) * r,
			center[2] + (u[2] * Math.cos(ang) + v[2] * Math.sin(ang)) * r,
		);
		b.colors.push(color[0], color[1], color[2]);
		b.uvs.push(k / sides, uv1);
	}
	return first;
}

/** Adds a tapered tube from `a` to `to`, with a color at each end. */
function tube(
	b: Build,
	a: V3,
	to: V3,
	r0: number,
	r1: number,
	sides: number,
	color0: V3,
	color1: V3,
): void {
	const axis = norm(sub(to, a));
	const helper: V3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const u = norm(cross(axis, helper));
	const v = cross(axis, u);
	const a0 = ring(b, a, r0, u, v, sides, color0, 0);
	const b0 = ring(b, to, r1, u, v, sides, color1, 1);
	for (let k = 0; k < sides; k++) {
		const k1 = (k + 1) % sides;
		b.indices.push(a0 + k, b0 + k, a0 + k1, a0 + k1, b0 + k, b0 + k1);
	}
}

/** A pine, 1 unit high: a trunk and five tiers of needles, green below and snow-white on top. */
function snowPine(): Build {
	const b: Build = { positions: [], colors: [], uvs: [], indices: [] };
	const dark: V3 = [0.12, 0.08, 0.05];
	tube(b, [0, 0, 0], [0, 0.22, 0], 0.045, 0.03, 5, dark, dark);
	const tiers = 5;
	const green: V3 = [0.04, 0.11, 0.06];
	const white: V3 = [0.82, 0.87, 0.98];
	for (let t = 0; t < tiers; t++) {
		const f = t / tiers;
		const r = 0.44 * (1 - f) + 0.04;
		const y0 = 0.15 + f * 0.74;
		const y1 = y0 + 0.32 * (1 - f * 0.5);
		const first = ring(b, [0, y0, 0], r, [1, 0, 0], [0, 0, 1], 9, green, 0);
		b.positions.push(0, y1, 0);
		b.colors.push(white[0], white[1], white[2]);
		b.uvs.push(0.5, 1);
		const tip = b.positions.length / 3 - 1;
		for (let k = 0; k < 9; k++) b.indices.push(first + k, tip, first + ((k + 1) % 9));
	}
	return b;
}

/** A bare tree, 1 unit high, with its branch tips, where the fairy lights hang. */
function bareTree(seed: number): { mesh: Build; tips: V3[] } {
	const b: Build = { positions: [], colors: [], uvs: [], indices: [] };
	const next = random(seed);
	const bark: V3 = [0.17, 0.13, 0.1];
	const tips: V3[] = [];
	const grow = (from: V3, dir: V3, len: number, r: number, depth: number): void => {
		const to: V3 = [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len];
		tube(b, from, to, r, r * 0.62, 5, bark, [bark[0] * 1.15, bark[1] * 1.15, bark[2] * 1.15]);
		if (depth === 0) {
			tips.push(to);
			return;
		}
		const count = depth > 2 ? 3 : 2;
		for (let k = 0; k < count; k++) {
			const a = next() * Math.PI * 2;
			const spread = 0.5 + 0.4 * next();
			const child = norm([
				dir[0] + Math.cos(a) * spread,
				dir[1] * (0.72 + 0.2 * next()) - 0.04,
				dir[2] + Math.sin(a) * spread,
			]);
			grow(to, child, len * (0.62 + 0.12 * next()), r * 0.62, depth - 1);
		}
	};
	grow([0, 0, 0], [0, 1, 0], 0.44, 0.05, 3);
	return { mesh: b, tips };
}

/** The pines, the bare trees and their fairy lights, with a way to thin the pines by the preset. */
export async function createTrees(
	{ scene, geometry, materials, textures, render, engine }: SketchContext,
	clear: (x: number, z: number) => boolean,
): Promise<{ fit(preset: QualityPreset): void }> {
	const next = random(149);
	const pineArrays = snowPine();
	const spots: { x: number; z: number; size: number; yaw: number }[] = [];
	for (let k = 0; k < 2000 && spots.length < PINES.ultra; k++) {
		const a = next() * Math.PI * 2;
		const r = 31 + 40 * next() ** 0.7;
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		if (!offRoad(x, z, 2) || clear(x, z)) continue;
		spots.push({ x, z, size: 6 + 7 * next(), yaw: next() * Math.PI * 2 });
	}
	// The pines are the demo's user of the GPU-written draw count: the page writes each pine's world
	// matrix once, and a compute pass writes the count that the preset draws. The pines' place and
	// look are the material's, as they were in a batch, so the picture does not move.
	const pines = await scene.addComputeInstances(
		defineFeature({
			name: 'night-town-pines',
			frame: 'opaque',
			kind: 'draw',
			band: 'normal',
			views: ['main'],
		}),
		{
			shader: DEFAULT_SURFACE,
			vertices: { ...pineArrays, computeNormals: true },
			capacity: spots.length,
			count: spots.length,
			color: '#ffffff',
			roughness: 0.9,
			vertexColors: true,
		},
	);
	const rows = new Float32Array(spots.length * 16);
	const matrix = mat4.create();
	const turn = quat.create();
	spots.forEach((s, k) => {
		const at = k * 16;
		quat.fromEuler(turn, 0, s.yaw, 0);
		mat4.compose(matrix, [s.x, groundHeight(s.x, s.z) - 0.2, s.z], turn, [
			s.size * 0.55,
			s.size,
			s.size * 0.55,
		]);
		// A row of the engine's instance buffer: the matrix's three rows, each translation in its
		// fourth number, then the row's ids.
		rows.set(
			[
				matrix[0] as number,
				matrix[4] as number,
				matrix[8] as number,
				matrix[12] as number,
				matrix[1] as number,
				matrix[5] as number,
				matrix[9] as number,
				matrix[13] as number,
				matrix[2] as number,
				matrix[6] as number,
				matrix[10] as number,
				matrix[14] as number,
				0,
				0,
				0,
				0,
			],
			at,
		);
	});
	pines.setInstances(rows, spots.length);
	pines.object.setCastShadows(true);
	pines.object.setReceiveShadows(true);
	// WebGL2 has no compute pass, so the page's count draws the pines there. On WebGPU the pass
	// writes the count word every frame, and the frame draws that: the page leaves its own count at
	// the capacity, so the pines on screen can only be the ones that the GPU counted.
	const pineCount =
		engine.capabilities.tier === 'webgl2'
			? undefined
			: render.addPass({
					kind: 'compute',
					description: defineFeature({
						name: 'night-town-pine-count',
						frame: 'opaque',
						kind: 'compute',
						band: 'before',
					}),
					wgsl: PINE_COUNT,
					buffers: [pines.counts, pines.instances],
					dispatch: [1, 1, 1],
					values: [spots.length],
				});

	// The bare trees beside the square, each with fairy lights on its branches.
	const tree = bareTree(211);
	const treeMesh = geometry.fromArrays({ ...tree.mesh, computeNormals: true });
	const barkMat = materials.standard({ color: '#8a8078', roughness: 0.95, vertexColors: true });
	const bareSpots = [
		{ x: -8.2, z: 9.6, size: 4.4, yaw: 0.4 },
		{ x: 8.6, z: 9.8, size: 4.2, yaw: 2.1 },
		{ x: -8.6, z: -9.4, size: 4.6, yaw: 1.2 },
		{ x: 9.0, z: -9.0, size: 4.0, yaw: 3.4 },
		{ x: -13.5, z: 9.0, size: 4.8, yaw: 0.9 },
		{ x: 14.2, z: -8.6, size: 4.5, yaw: 2.7 },
	].slice(0, BARE);
	const bare = scene.createInstances(treeMesh, bareSpots.length, {
		material: barkMat,
		castShadows: true,
		receiveShadows: true,
	});
	bareSpots.forEach((s, k) => {
		bare.positions.set([s.x, groundHeight(s.x, s.z), s.z], k * 3);
		bare.rotations.set(quat.fromEuler(quat.create(), 0, s.yaw, 0), k * 4);
		bare.scales.set([s.size, s.size, s.size], k * 3);
	});
	bare.markDirty();

	// The fairy lights: a soft dot at each branch tip, warm, which the bloom swells.
	const dot = new Uint8Array(32 * 32 * 4);
	for (let i = 0; i < 32 * 32; i++) {
		const r = Math.hypot((i % 32) - 15.5, Math.floor(i / 32) - 15.5) / 16;
		dot.set([255, 240, 210, Math.round(255 * Math.max(0, 1 - r) ** 2.2)], i * 4);
	}
	const count = LIGHTS_PER_TREE * bareSpots.length;
	const lights = await scene.createSprites({
		count,
		map: textures.fromData({ width: 32, height: 32, data: dot }),
		blending: 'additive',
		depthWrite: false,
		dynamic: true,
	});
	markEffect(lights);
	const seeds = Float32Array.from({ length: count * 2 }, () => next());
	let row = 0;
	for (const spot of bareSpots) {
		const cos = Math.cos(spot.yaw);
		const sin = Math.sin(spot.yaw);
		const y = groundHeight(spot.x, spot.z);
		for (let k = 0; k < LIGHTS_PER_TREE; k++) {
			const tip = tree.tips[
				Math.floor(((k + 0.5) / LIGHTS_PER_TREE) * tree.tips.length) % tree.tips.length
			] as V3;
			const jitter = 0.9 + 0.2 * (seeds[row * 2] as number);
			const lx = tip[0] * jitter * spot.size;
			const ly = tip[1] * jitter * spot.size;
			const lz = tip[2] * jitter * spot.size;
			lights.positions.set(
				[spot.x + lx * cos + lz * sin, y + ly, spot.z - lx * sin + lz * cos],
				row * 3,
			);
			lights.sizes.set([0.15, 0.15], row * 2);
			lights.colors.set([2.2, 1.7, 1.0, 1], row * 4);
			row++;
		}
	}
	lights.markDirty();

	return {
		fit(preset) {
			const drawn = Math.min(PINES[preset], spots.length);
			// On WebGL2 the page's count draws the pines. On WebGPU only the pass's count does: the
			// page's stays at the capacity, so a picture that shows the preset's pines shows that the
			// GPU's count reached the draw.
			if (pineCount === undefined) pines.setCount(drawn);
			else render.setPassUniforms(pineCount, [drawn]);
		},
	};
}
