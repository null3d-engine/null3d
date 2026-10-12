// The atmosphere demo's scenery: a valley of ridges with a winding lake. Ridged noise of five
// scales makes the land. Its height, its slope, smooth patches and the clumps of pines color it
// meadow, dry grass, forest floor, rock and snow, and a tiling grass texture gives it clumps up
// close. A dirt path winds from the camera down to the lake, boulders lie beside it and on the
// shore, and the lake mirrors the sky's environment. Pines with drooping tiers stand in clumps of
// many sizes with open meadow between, more of them toward the valley's slopes, and a few alone.
import { type MeshArrays, math, type SketchContext } from '@null3d/engine';
import { Noise, rock, type TexelSample, textureSet } from '../lib/procedural';
import { pineWithLevels } from './pine';

/** Quads along each side of the land, its width in metres, and the lake's height. */
const QUADS = 320;
const WIDTH = 24000;
const LAKE = 40;
/** Linear colors of the land: meadow, dry grass, forest, rock and snow, three numbers each. */
const LAND = [0.2, 0.3, 0.07, 0.32, 0.3, 0.1, 0.05, 0.11, 0.04, 0.26, 0.25, 0.2, 0.85, 0.88, 0.92];
/** Metres across one tile of the grass texture, and how much the land's colors make up for its dark. */
const TILE = 40;
const LIFT = 1.45;
/** The path's width in metres, and its dirt's linear color. */
const PATH = 7;
const DIRT = [0.36, 0.25, 0.13];
/** Pines and boulders at each preset. */
const TREES = { low: 3000, medium: 9000, high: 9000, ultra: 9000 } as const;
const BOULDERS = 260;
/** Clumps of pines, and the share of pines that stand alone in the meadow. */
const CLUMPS = 220;
const LONE = 0.05;
/** A clump of pines: its middle's x and z and its radius, in metres. */
type Clump = readonly [number, number, number];
/** Two clumps in the foreground, one on each side of the path. */
const NEAR_CLUMPS: Clump[] = [
	[-300, 4480, 150],
	[290, 4330, 170],
];
/** Large boulders beside the path: z along it, the side offset and the size, in metres. */
const PATH_ROCKS = [
	[4820, 11, 7],
	[4690, -13, 9],
	[4500, 12, 6],
	[4250, -10, 8],
] as const;
/** Large boulders on the lake's shore: the angle from the lake's middle toward the camera, and size. */
const SHORE_ROCKS = [
	[-0.5, 7],
	[0.15, 10],
	[0.6, 8],
] as const;
const noise = new Noise(5);

/** A ridge of noise: sharp crests where a wave of `x` and `z` turns, in about -1 to 1. */
const ridge = (x: number, z: number) => 1 - 2 * Math.abs(Math.sin(x) * Math.cos(z));
/** Smooth patches some hundreds of metres across, in about -1 to 1, for meadows and groves. */
const patches = (x: number, z: number) =>
	0.6 * Math.sin(x / 610 + Math.cos(z / 830)) * Math.cos(z / 540 - 0.7) +
	0.4 * Math.sin((x + z) / 260) * Math.cos((x - z) / 330);
/** How much a point lies in a clump of pines, from 0 in open meadow to 1 in the clump's middle. */
function grove(clumps: readonly Clump[], x: number, z: number): number {
	let most = 0;
	for (const [cx, cz, r] of clumps) {
		if (Math.abs(x - cx) > r * 1.15 || Math.abs(z - cz) > r * 1.15) continue;
		most = Math.max(most, math.smoothstep(Math.hypot(x - cx, z - cz), r * 1.15, r * 0.6));
	}
	return most;
}

/** The land's height in metres: ridges of five scales, a valley along z, and the lake's basin. */
function heightAt(x: number, z: number): number {
	let h = 0;
	let amplitude = 1;
	let f = 1 / 2600;
	for (let o = 0; o < 5; o++) {
		const a = 0.6 + o * 1.3;
		const [u, v] = [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
		h += amplitude * ridge(u * f, v * f * 0.7);
		amplitude *= 0.48;
		f *= 2.05;
	}
	const valley = math.smoothstep(Math.abs(x), 600, 4500);
	// The lake's shore winds in bays and points.
	const shore = Math.hypot(x, z - 2600) * (1 + 0.2 * patches(x * 2.3, z * 2.3));
	const basin = 1 - math.smoothstep(shore, 300, 1500);
	return 120 + valley * (420 + 520 * h) - basin * 180;
}

/** The path's middle across the valley at a distance `z` along it: it winds in two waves. */
const pathX = (z: number) => 140 * Math.sin(z / 310 + 1) + 50 * Math.sin(z / 113);

/** The land's slope at a point: its rise per metre. */
function slopeAt(x: number, z: number): number {
	const y = heightAt(x, z);
	return Math.hypot(heightAt(x + 30, z) - y, heightAt(x, z + 30) - y) / 30;
}

/** Whether a pine can stand at a point: above the lake, below the tree line, not too steep. */
const treeGround = (x: number, z: number, y: number) =>
	y > LAKE + 6 && y < 650 && slopeAt(x, z) < 0.5;

/**
 * Clumps of pines from 20 to 170 m across, most of them small, with open meadow between. More of
 * them lie toward the valley's slopes than in its middle.
 */
function clumps(): Clump[] {
	const out = [...NEAR_CLUMPS];
	while (out.length < CLUMPS) {
		const [x, z] = [math.randFloat(-4500, 4500), math.randFloat(-3500, 4900)];
		if (!treeGround(x, z, heightAt(x, z))) continue;
		if (math.randFloat(0, 1) > 0.2 + 0.8 * math.smoothstep(Math.abs(x), 300, 2500)) continue;
		out.push([x, z, 10 + 75 * math.randFloat(0, 1) ** 2]);
	}
	return out;
}

/** The heights at the land's grid points, which `groundAt` reads. */
const heights = new Float32Array((QUADS + 1) ** 2);

/** The land's height at a point as its mesh draws it: on the flat triangle over the point. */
function groundAt(x: number, z: number): number {
	const [gx, gz] = [(x / WIDTH + 0.5) * QUADS, (z / WIDTH + 0.5) * QUADS];
	const [i, j] = [Math.floor(gx), Math.floor(gz)];
	const [fx, fz] = [gx - i, gz - j];
	const at = (di: number, dj: number) => heights[(j + dj) * (QUADS + 1) + i + di] as number;
	if (fx + fz <= 1) return at(0, 0) + fx * (at(1, 0) - at(0, 0)) + fz * (at(0, 1) - at(0, 0));
	return at(1, 1) + (1 - fx) * (at(0, 1) - at(1, 1)) + (1 - fz) * (at(1, 0) - at(1, 1));
}

/** The grass texture's texel: clumps and blades in a near-white tone, warmer in broad patches. */
function grassTexel(u: number, v: number, out: TexelSample): void {
	const clumps = noise.fbm2(u * 16, v * 16, 5, 16);
	const blades = noise.value2(u * 128, v * 128, 128);
	const warm = noise.fbm2(u * 4, v * 4, 3, 4);
	out.height = clumps * 5 + blades;
	const tone = 0.8 + 0.22 * clumps + 0.06 * blades;
	out.r = tone * (0.95 + 0.12 * warm);
	out.g = tone;
	out.b = tone * (0.9 - 0.05 * warm);
	out.roughness = 0.95;
	out.occlusion = 0.85 + 0.15 * math.smoothstep(clumps, -0.3, 0.3);
}

/** The land as a grid of quads, with a color at each vertex from its height and slope. */
function land(groves: readonly Clump[]): MeshArrays {
	const row = QUADS + 1;
	const positions = new Float32Array(row * row * 3);
	const colors = new Float32Array(row * row * 3);
	const uvs = new Float32Array(row * row * 2);
	for (let v = 0; v < row * row; v++) {
		const [x, z] = [((v % row) / QUADS - 0.5) * WIDTH, (Math.floor(v / row) / QUADS - 0.5) * WIDTH];
		const y = heightAt(x, z);
		heights[v] = y;
		positions.set([x, y, z], v * 3);
		uvs.set([x / TILE, z / TILE], v * 2);
		const grain = math.randFloat(-0.15, 0.15);
		const dry = math.smoothstep(patches(x * 1.7 + 900, z * 1.7) + grain, 0, 0.6);
		const forest =
			math.clamp(grove(groves, x, z) + grain, 0, 1) * (1 - math.smoothstep(y, 600, 800));
		const rock = math.smoothstep(slopeAt(x, z) + grain, 0.45, 0.7);
		const snow = math.smoothstep(y + 120 * math.randFloat(-1, 1), 900, 1050) * (1 - rock * 0.6);
		// Each vertex a little lighter or darker, so the meadow is mottled.
		const shade = LIFT * (1 + grain);
		for (let c = 0; c < 3; c++) {
			const grass = math.lerp(math.lerp(LAND[c], LAND[3 + c], dry), LAND[6 + c], forest);
			const ground = math.lerp(math.lerp(grass, LAND[9 + c], rock), LAND[12 + c], snow);
			colors[v * 3 + c] = ground * shade;
		}
	}
	const indices = new Uint32Array(QUADS * QUADS * 6);
	for (let q = 0; q < QUADS * QUADS; q++) {
		const a = Math.floor(q / QUADS) * row + (q % QUADS);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	return { positions, colors, uvs, indices, computeNormals: true };
}

/**
 * The path as a strip just above the land, from the camera's feet down to the lake's shore. Its
 * edges are worn grass and its middle bare dirt.
 */
function path(): MeshArrays {
	const [positions, colors, uvs, indices]: number[][] = [[], [], [], []];
	const across = [-0.5 - 0.25, -0.3, 0.3, 0.5 + 0.25];
	for (let z = 5150, k = 0; groundAt(pathX(z), z) > LAKE + 1; z -= 4, k++) {
		const [x, next] = [pathX(z), pathX(z - 4)];
		// The strip's sideways step, square to the path's way.
		const [sx, sz] = [4, next - x].map((n) => n / Math.hypot(4, next - x));
		for (const [n, side] of across.entries()) {
			const [px, pz] = [x + side * PATH * (sx as number), z + side * PATH * (sz as number)];
			positions.push(px, groundAt(px, pz) + 0.3, pz);
			uvs.push(px / TILE, pz / TILE);
			const wear = n === 0 || n === 3 ? 0.45 : 1;
			colors.push(...DIRT.map((d, c) => LIFT * math.lerp(LAND[c] as number, d, wear)));
		}
		if (k > 0)
			for (let n = 0; n < 3; n++) {
				const [a, b] = [(k - 1) * 4 + n, k * 4 + n];
				indices.push(a, a + 1, b, a + 1, b + 1, b);
			}
	}
	return { positions, colors, uvs, indices, computeNormals: true };
}

/** Adds the land, the path, the lake, the boulders and the pines to the scene. */
export function valley({ scene, geometry, materials, textures, quality }: SketchContext): void {
	math.seed(11);
	const groves = clumps();
	const grass = textureSet(textures, 512, grassTexel);
	const ground = materials.standard({ vertexColors: true, ...grass, roughness: 1 });
	for (const arrays of [land(groves), path()])
		scene.createMesh({ mesh: geometry.fromArrays(arrays), material: ground, receiveShadows: true });
	// The lake: smooth and dark, so that it mirrors the sky.
	scene.createMesh({
		mesh: geometry.plane({ width: WIDTH, height: WIDTH }),
		material: materials.standard({ color: '#0b1a22', roughness: 0.06, metalness: 0.1 }),
		position: [0, LAKE, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	// Boulders: large ones beside the path and on the lake's shore, sunk to about half their
	// height, and many smaller ones in the meadow near the camera. Each is its own gray.
	const places: [number, number, number][] = PATH_ROCKS.map(([z, side, size]) => [
		pathX(z) + side,
		z,
		size,
	]);
	for (const [angle, size] of SHORE_ROCKS) {
		let reach = 300;
		while (groundAt(Math.sin(angle) * reach, 2600 + Math.cos(angle) * reach) < LAKE + 1) reach += 5;
		places.push([Math.sin(angle) * reach, 2600 + Math.cos(angle) * reach, size]);
	}
	while (places.length < BOULDERS) {
		const [x, z] = [math.randFloat(-1200, 1200), math.randFloat(3700, 5000)];
		if (groundAt(x, z) < LAKE + 2 || Math.abs(x - pathX(z)) < PATH * 1.5) continue;
		places.push([x, z, 1.5 + 5 * math.randFloat(0, 1) ** 2]);
	}
	const boulders = scene.createInstances(
		geometry.fromArrays(rock(17, 2, [1, 0.6, 0.85])),
		BOULDERS,
		{
			material: materials.standard({ color: '#77736c', roughness: 0.9 }),
			colors: true,
			castShadows: true,
			receiveShadows: true,
		},
	);
	places.forEach(([x, z, size], k) => {
		boulders.positions.set([x, groundAt(x, z) - size * 0.3, z], k * 3);
		boulders.scales.set([size, size, size], k * 3);
		const turn = math.randFloat(0, Math.PI);
		boulders.rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], k * 4);
		const shade = math.randFloat(0.75, 1.2);
		boulders.colors?.set([shade * math.randFloat(0.95, 1.08), shade, shade * 0.95, 1], k * 4);
	});
	boulders.markDirty(0, BOULDERS);

	// Each pine is 14 to 26 m tall, turned its own way, a little lighter, darker, bluer or more
	// yellow than the next, and picks its level of detail in every frame. Most stand in the clumps,
	// more of them in the larger ones and toward each clump's middle, and a few stand alone.
	const pines = scene.createInstances(pineWithLevels(geometry), TREES.high, {
		material: materials.standard({ vertexColors: true, roughness: 0.85 }),
		colors: true,
		castShadows: true,
		receiveShadows: true,
	});
	const { positions, rotations, scales, colors } = pines;
	const areas = groves.map(([, , r]) => r * r);
	const total = areas.reduce((sum, area) => sum + area, 0);
	for (let k = 0; k < TREES.high; ) {
		let [x, z] = [math.randFloat(-4500, 4500), math.randFloat(-3500, 5000)];
		if (math.randFloat(0, 1) > LONE) {
			let pick = math.randFloat(0, total);
			let c = 0;
			while (pick > (areas[c] as number) && c < areas.length - 1) pick -= areas[c++] as number;
			const [cx, cz, r] = groves[c] as Clump;
			const [angle, reach] = [math.randFloat(0, Math.PI * 2), r * math.randFloat(0, 1) ** 0.75];
			[x, z] = [cx + Math.cos(angle) * reach, cz + Math.sin(angle) * reach];
		}
		const y = groundAt(x, z);
		if (!treeGround(x, z, y) || (Math.abs(x - pathX(z)) < PATH * 2 && z > 3300)) continue;
		positions.set([x, y - 0.3, z], k * 3);
		const turn = math.randFloat(0, Math.PI);
		rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], k * 4);
		scales.fill(math.randFloat(14, 26), k * 3, k * 3 + 3);
		const [shade, hue] = [math.randFloat(0.8, 1.2), math.randFloat(-1, 1)];
		colors?.set([shade * (1 + 0.15 * hue), shade, shade * (1 - 0.1 * hue), 1], k * 4);
		k++;
	}
	pines.markDirty(0, TREES.high);
	const fit = () => pines.setActiveCount(TREES[quality.preset]);
	fit();
	quality.onChange(fit);
}
