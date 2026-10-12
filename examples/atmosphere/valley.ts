// The atmosphere demo's scenery: a valley of ridges with a winding lake. Ridged noise of five
// scales makes the land, colored meadow, forest, rock and snow by height, slope and smooth patches.
// The lake mirrors the sky's environment. Pines made in code at four levels of detail stand in
// groves on the valley's floor and its gentle lower slopes.
import { type MeshArrays, math, type SketchContext } from '@null3d/engine';
import { pineWithLevels } from '../lib/pines';

/** Quads along each side of the land, its width in metres, and the lake's height. */
const QUADS = 320;
const WIDTH = 24000;
const LAKE = 40;
/** Linear colors of the land: meadow, forest, rock and snow, three numbers each. */
const LAND = [0.2, 0.3, 0.07, 0.05, 0.11, 0.04, 0.28, 0.25, 0.22, 0.85, 0.88, 0.92];
/** Pines at each preset. */
const TREES = { low: 3000, medium: 9000, high: 9000, ultra: 9000 } as const;

/** A ridge of noise: sharp crests where a wave of `x` and `z` turns, in about -1 to 1. */
const ridge = (x: number, z: number) => 1 - 2 * Math.abs(Math.sin(x) * Math.cos(z));
/** Smooth patches some hundreds of metres across, in about -1 to 1, for meadows and groves. */
const patches = (x: number, z: number) =>
	0.6 * Math.sin(x / 610 + Math.cos(z / 830)) * Math.cos(z / 540 - 0.7) +
	0.4 * Math.sin((x + z) / 260) * Math.cos((x - z) / 330);

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

/** The land's slope at a point: its rise per metre. */
function slopeAt(x: number, z: number): number {
	const y = heightAt(x, z);
	return Math.hypot(heightAt(x + 30, z) - y, heightAt(x, z + 30) - y) / 30;
}

/** The land as a grid of quads, with a color at each vertex from its height and slope. */
function land(): MeshArrays {
	const row = QUADS + 1;
	const positions = new Float32Array(row * row * 3);
	const colors = new Float32Array(row * row * 3);
	for (let v = 0; v < row * row; v++) {
		const [x, z] = [((v % row) / QUADS - 0.5) * WIDTH, (Math.floor(v / row) / QUADS - 0.5) * WIDTH];
		const y = heightAt(x, z);
		positions.set([x, y, z], v * 3);
		const grain = math.randFloat(-0.15, 0.15);
		const forest =
			math.smoothstep(patches(x, z) + grain, -0.3, 0.4) * (1 - math.smoothstep(y, 600, 800));
		const rock = math.smoothstep(slopeAt(x, z) + grain, 0.45, 0.7);
		const snow = math.smoothstep(y + 120 * math.randFloat(-1, 1), 900, 1050) * (1 - rock * 0.6);
		for (let c = 0; c < 3; c++) {
			const green = math.lerp(LAND[c], LAND[3 + c], forest);
			colors[v * 3 + c] = math.lerp(math.lerp(green, LAND[6 + c], rock), LAND[9 + c], snow);
		}
	}
	const indices = new Uint32Array(QUADS * QUADS * 6);
	for (let q = 0; q < QUADS * QUADS; q++) {
		const a = Math.floor(q / QUADS) * row + (q % QUADS);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	return { positions, colors, indices, computeNormals: true };
}

/** Adds the land, the lake and the pines to the scene, with fewer pines on the Low preset. */
export function valley({ scene, geometry, materials, quality }: SketchContext): void {
	math.seed(11);
	const lit = (roughness: number) => materials.standard({ vertexColors: true, roughness });
	scene.createMesh({
		mesh: geometry.fromArrays(land()),
		material: lit(0.95),
		receiveShadows: true,
	});
	// The lake: smooth and dark, so that it mirrors the sky.
	scene.createMesh({
		mesh: geometry.plane({ width: WIDTH, height: WIDTH }),
		material: materials.standard({ color: '#0b1a22', roughness: 0.06, metalness: 0.1 }),
		position: [0, LAKE, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	// Each pine is 14 to 26 m tall, turned its own way, and picks its level of detail in every frame.
	const pines = scene.createInstances(pineWithLevels(geometry), TREES.high, {
		material: lit(0.85),
		castShadows: true,
		receiveShadows: true,
	});
	const { positions, rotations, scales } = pines;
	for (let k = 0; k < TREES.high; ) {
		const [x, z] = [math.randFloat(-4500, 4500), math.randFloat(-3500, 5000)];
		const y = heightAt(x, z);
		const grove = math.smoothstep(patches(x, z), -0.4, 0.3);
		if (y < LAKE + 6 || y > 650 || slopeAt(x, z) > 0.5 || math.randFloat(0, 1) > grove) continue;
		positions.set([x, y - 0.5, z], k * 3);
		const turn = math.randFloat(0, Math.PI);
		rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], k * 4);
		scales.fill(math.randFloat(14, 26), k * 3, k * 3 + 3);
		k++;
	}
	pines.markDirty(0, TREES.high);
	const fit = () => pines.setActiveCount(TREES[quality.preset]);
	fit();
	quality.onChange(fit);
}
