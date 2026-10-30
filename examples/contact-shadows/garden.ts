// The stone garden's scenery, all made in code. The sand is raked in rings around each rock and
// in straight furrows between them, and its normal map catches the low sun. Granite rocks with moss
// on their tops, stepping stones, pebbles, tufts of grass and a stone lantern stand on it, inside a
// granite curb on a moss lawn. A plaster wall closes the back and the left side, with bamboo and
// pines beyond it. Each object in the garden casts and receives shadows, so contact shadows show
// wherever things touch.
import { type Camera, type MeshArrays, math, quat, type SketchContext } from '@null3d/engine';
import { icosahedron } from '@null3d/geometry';
import {
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	leafCellFor,
	type PlantMaterial,
	plantMaterial,
	plantWind,
	setWindLayer,
	swayDistanceFor,
	treeValues,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import { TURN } from '../lib/pines';
import { random } from '../lib/procedural';

/** The sand bed's side in meters, its texels along each side, and the rake's spacing in meters. */
const BED = 10;
const SIZE = 512;
const RAKE = 0.14;
/** Texels along each side of the granite texture. */
const GRANITE = 256;
/** The rocks: place on the sand, radius, how tall each is against its width, and a warmth. */
const ROCKS = [
	[-1.8, -1.1, 0.95, 0.75, 0.1],
	[1.4, -1.9, 0.6, 1, -0.05],
	[0.5, 1.5, 0.45, 0.65, 0.05],
	[2.7, 0.9, 0.35, 1.2, -0.1],
	[-3, 1.7, 0.3, 0.8, 0.15],
] as const;
/** The pines beyond the wall: place and height, in meters. */
const PINES = [
	[-16, -17, 5],
	[-10, -19, 6.5],
	[-5, -17.5, 4.5],
	[0, -20, 6],
	[5, -18, 5],
	[10, -19.5, 6],
	[-20, -10, 5.5],
	[-21, -3, 6.5],
	[-19, 4, 4.5],
] as const;
/**
 * The wall's two runs, behind the garden and along its left side: middle x and z, width, depth
 * and height. The low sun stands on the left, so the left run is low enough to leave the bed lit.
 */
const WALLS = [
	[0, -6.4, 13, 0.3, 1.2],
	[-6.4, -0.6, 0.3, 11.9, 0.5],
] as const;
/** Bamboo stalks in the grove beyond the left wall, and the leaves on each. */
const STALKS = 72;
const LEAVES = 30;
/** Where the lantern stands. */
const LANTERN = [1.2, -3.8] as const;
/** A bright, quiet rise and fall in 0..1 along a coordinate. */
const wave = (d: number) => 0.5 + 0.5 * Math.cos((d / RAKE) * Math.PI * 2);

/** The rake's height at (x, z), 0..1: rings around the nearest rock, straight furrows elsewhere. */
function rake(x: number, z: number): number {
	let ring = Number.POSITIVE_INFINITY;
	for (const [rx, rz, r] of ROCKS) ring = Math.min(ring, Math.hypot(x - rx, z - rz) - r * 1.15);
	return math.lerp(wave(ring), wave(z), math.smoothstep(ring, 0.75, 0.95));
}

/** Value noise in 0..1 on `size` x `size` texels, from `cells` random points per side. It tiles. */
function noise(size: number, cells: number): Float32Array {
	const points = Float32Array.from({ length: cells * cells }, math.random);
	const out = new Float32Array(size * size);
	const at = (i: number, j: number) => points[(j % cells) * cells + (i % cells)];
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const [fx, fy] = [(x / size) * cells, (y / size) * cells];
			const [i, j] = [Math.floor(fx), Math.floor(fy)];
			const [tx, ty] = [math.smoothstep(fx - i, 0, 1), math.smoothstep(fy - j, 0, 1)];
			const top = math.lerp(at(i, j), at(i + 1, j), tx);
			out[y * size + x] = math.lerp(top, math.lerp(at(i, j + 1), at(i + 1, j + 1), tx), ty);
		}
	return out;
}

/** Builds the garden in the scene of `ctx`, with its plants swaying in the field of `camera`. */
export function garden(ctx: SketchContext, camera: Camera): { update(): void } {
	const { scene, geometry, materials, textures, quality } = ctx;
	const solid = { castShadows: true, receiveShadows: true } as const;
	const flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

	// The sand: its color and its normal map from the rake's height, with a little grain.
	math.seed(5);
	const color = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const normal = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const step = BED / SIZE;
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const [wx, wz] = [(x + 0.5) * step - BED / 2, BED / 2 - (y + 0.5) * step];
			const h = rake(wx, wz);
			const i = (y * SIZE + x) * 4;
			color.fill((0.86 + 0.14 * h) * math.randFloat(0.9, 1) * 255, i, i + 3);
			const dx = (rake(wx + step, wz) - h) * 0.6;
			const dz = (rake(wx, wz + step) - h) * 0.6;
			const n = 1 / Math.hypot(dx, dz, 1);
			normal.set(
				[(0.5 - 0.5 * dx * n) * 255, (0.5 + 0.5 * dz * n) * 255, (0.5 + 0.5 * n) * 255],
				i,
			);
		}
	const map = { width: SIZE, height: SIZE, mipmaps: true, anisotropy: 8 } as const;
	scene.createMesh({
		mesh: geometry.plane({ width: BED, height: BED }),
		material: materials.standard({
			map: textures.fromData({ ...map, data: color, colorSpace: 'srgb' }),
			normalMap: textures.fromData({ ...map, data: normal, colorSpace: 'linear' }),
			color: '#e8d6b6',
			roughness: 0.95,
		}),
		rotation: flat,
		receiveShadows: true,
	});
	// The moss lawn around the bed.
	scene.createMesh({
		mesh: geometry.plane({ width: 400, height: 400 }),
		material: materials.standard({ color: '#2c3a1a', roughness: 1 }),
		position: [0, -0.02, 0],
		rotation: flat,
		receiveShadows: true,
	});

	// Granite: broad patches, finer mottling and dark and light grains, which tiles over the stone.
	const [broad, fine] = [noise(GRANITE, 6), noise(GRANITE, 40)];
	const stone = new Uint8Array(GRANITE * GRANITE * 4).fill(255);
	for (let i = 0; i < GRANITE * GRANITE; i++) {
		const grain = math.random();
		const speck = grain > 0.93 ? 0.35 : grain < 0.05 ? -0.25 : 0;
		const shade = math.clamp(0.45 + 0.25 * broad[i] + 0.2 * fine[i] + speck, 0, 1) * 255;
		stone.set([shade, shade * 0.97, shade * 0.93], i * 4);
	}
	const tile = { width: GRANITE, height: GRANITE, colorSpace: 'srgb', wrap: 'repeat' } as const;
	const granite = textures.fromData({ ...tile, data: stone, mipmaps: true, anisotropy: 8 });
	const paving = materials.standard({ map: granite, color: '#8a847d', roughness: 0.8 });
	for (const [x, z, w, d] of [
		[0, -5.1, 10.4, 0.2],
		[0, 5.1, 10.4, 0.2],
		[-5.1, 0, 0.2, 10],
		[5.1, 0, 0.2, 10],
	])
		scene.createMesh({
			mesh: geometry.box({ width: w, height: 0.14, depth: d }),
			material: paving,
			position: [x, 0.05, z],
			...solid,
		});

	// A plaster wall behind the garden and along its left side, with faint streaks of rain, under
	// a cap of dark tiles, and bamboo and pines beyond it.
	const clay = new Uint8Array(GRANITE * GRANITE * 4).fill(255);
	for (let y = 0; y < GRANITE; y++)
		for (let x = 0; x < GRANITE; x++) {
			const i = y * GRANITE + x;
			const shade = 0.86 + 0.1 * broad[i] - 0.1 * fine[(y >> 4) * GRANITE + x] ** 3;
			clay.set([shade * 255, shade * 0.92 * 255, shade * 0.8 * 255], i * 4);
		}
	const plaster = materials.standard({
		map: textures.fromData({ ...tile, data: clay, mipmaps: true }),
		color: '#e6d6bc',
		roughness: 0.95,
		uvTransform: { repeat: [6, 1] },
	});
	const tiles = materials.standard({ color: '#3a3b3e', roughness: 0.55 });
	for (const [x, z, w, d, h] of WALLS) {
		scene.createMesh({
			mesh: geometry.box({ width: w, height: h, depth: d }),
			material: plaster,
			position: [x, h / 2, z],
			...solid,
		});
		scene.createMesh({
			mesh: geometry.box({ width: w + 0.3, height: 0.12, depth: d + 0.3 }),
			material: tiles,
			position: [x, h + 0.06, z],
			...solid,
		});
	}
	// The pines beyond the wall are the add-on's conifers, at its three levels and in the scene's
	// one wind field: one variant, each copy its own height and turn.
	const conifer = builtInSpecies('conifer');
	if (!conifer) throw new Error('the vegetation add-on has no conifer');
	const atlases = bakePlantAtlases(ctx);
	const wind = createWind(ctx, { camera, box: 32, grid: 64 });
	const swayDistance = swayDistanceFor(quality.preset);
	const plantMaterials: PlantMaterial[] = [];
	const pineAsset = generatePlant(conifer, { seed: 5, variant: 0, levels: conifer.levels });
	const pineField = plantWind(ctx, pineAsset, wind.field, { swayDistance });
	const pineBark = plantMaterial(ctx, {
		atlases,
		part: 'wood',
		color: conifer.color.bark,
		wind: pineField,
	});
	const pineLeaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(conifer),
		color: conifer.color.leaf,
		transmission: conifer.color.transmission,
		// The needle cards carry thin sprays, so a lower cut keeps the crown closed at a distance.
		alphaCutoff: 0.25,
		wind: pineField,
	});
	plantMaterials.push(pineBark, pineLeaves);
	for (const part of pineAsset.levels[0]?.parts ?? []) {
		const base = geometry.fromArrays(part.arrays);
		base.setLevels(
			pineAsset.levels.slice(1).map((level) => {
				const coarser = level.parts.find((other) => other.name === part.name);
				if (!coarser) throw new Error(`a ${part.name} part has no level at ${level.error} m`);
				return { mesh: geometry.fromArrays(coarser.arrays), error: level.error };
			}),
			{ fade: false },
		);
		const batch = scene.createInstances(base, PINES.length, {
			material: part.name === 'wood' ? pineBark : pineLeaves,
			values: true,
			...solid,
		});
		PINES.forEach(([x, z, height], i) => {
			batch.positions.set([x, 0, z], i * 3);
			batch.scales.fill(height / conifer.height, i * 3, i * 3 + 3);
			batch.rotations.set([0, Math.sin(i), 0, Math.cos(i)], i * 4);
			batch.values?.set(treeValues(x, z, 5, 0), i * 4);
		});
		batch.markDirty();
	}
	// Bamboo: tall jointless stalks that lean a little, with narrow leaves that hang from their
	// upper halves.
	const next = random(3);
	const stalks = scene.createInstances(
		geometry.cylinder({ radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 6 }),
		STALKS,
		{ material: materials.standard({ color: '#ffffff', roughness: 0.45 }), colors: true },
	);
	const leaves = scene.createInstances(
		geometry.cone({ radius: 1, height: 1, radialSegments: 4 }),
		STALKS * LEAVES,
		{
			material: materials.standard({ color: '#ffffff', roughness: 0.7, doubleSided: true }),
			colors: true,
		},
	);
	const [turn, twist] = [quat.create(), quat.create()];
	for (let i = 0; i < STALKS; i++) {
		const [x, z, h] = [-7.2 - 2 * next() ** 2, -8 + 11 * next(), 3.5 + 2.5 * next()];
		const [lean, heading] = [0.04 + 0.1 * next(), next() * TURN];
		const tip = [
			Math.sin(lean) * Math.cos(heading),
			Math.cos(lean),
			Math.sin(lean) * Math.sin(heading),
		];
		quat.setAxisAngle(turn, [Math.sin(heading), 0, -Math.cos(heading)], lean);
		stalks.positions.set([x + (tip[0] * h) / 2, (tip[1] * h) / 2, z + (tip[2] * h) / 2], i * 3);
		stalks.rotations.set(turn, i * 4);
		stalks.scales.set([0.028, h, 0.028], i * 3);
		const green = 0.8 + 0.3 * next();
		stalks.colors?.set([0.16 * green, 0.36 * green, 0.06 * green, 1], i * 4);
		for (let k = 0; k < LEAVES; k++) {
			const j = i * LEAVES + k;
			const up = h * (0.55 + 0.45 * next());
			const [spin, droop, length] = [next() * TURN, 1.9 + 0.8 * next(), 0.3 + 0.2 * next()];
			// A leaf points out from the stalk and hangs down, twisted about its length.
			quat.fromEuler(turn, 0, spin, -droop, 'YXZ');
			quat.multiply(turn, turn, quat.setAxisAngle(twist, [0, 1, 0], next() * Math.PI));
			const out = [
				Math.cos(spin) * Math.sin(droop),
				Math.cos(droop),
				-Math.sin(spin) * Math.sin(droop),
			];
			leaves.positions.set(
				[
					x + tip[0] * up + (out[0] * length) / 2,
					tip[1] * up + (out[1] * length) / 2,
					z + tip[2] * up + (out[2] * length) / 2,
				],
				j * 3,
			);
			leaves.rotations.set(turn, j * 4);
			leaves.scales.set([0.006, length, 0.045], j * 3);
			const shade = 0.7 + 0.4 * next();
			leaves.colors?.set([0.08 * shade, 0.3 * shade, 0.04 * shade, 1], j * 4);
		}
	}
	stalks.markDirty();
	leaves.markDirty();

	// Rocks: rough polyhedra, flat underneath, each its own shape and shade, with moss on top.
	const rockLook = materials.standard({
		map: granite,
		vertexColors: true,
		roughness: 0.85,
		flatShading: true,
		uvTransform: { repeat: [3, 2] },
	});
	ROCKS.forEach(([x, z, radius, height, warmth], k) => {
		const { positions, uvs } = icosahedron({ radius: 1, detail: 3 });
		const colors = new Float32Array(positions.length);
		for (let i = 0; i < positions.length; i += 3) {
			const [px, py, pz] = positions.subarray(i, i + 3);
			const bump =
				1 +
				0.14 * Math.sin(px * 3.1 + k) * Math.sin(pz * 2.7 + 2 * k) +
				0.06 * Math.sin(py * 9 + px * 7 + k) +
				0.03 * Math.sin(px * 17 + pz * 13);
			positions.set([px * bump, Math.max(py * bump, -0.3), pz * bump], i);
			const moss = math.smoothstep(py + 0.15 * Math.sin(px * 5 + pz * 4 + k), 0.45, 0.7);
			const grey = [0.62 * (1 + warmth), 0.62, 0.62 * (1 - warmth)];
			colors.set(
				[0, 1, 2].map((c) => math.lerp(grey[c], [0.08, 0.16, 0.03][c], moss)),
				i,
			);
		}
		scene.createMesh({
			mesh: geometry.fromArrays({ positions, uvs, colors, computeNormals: true }),
			material: rockLook,
			position: [x, radius * height * 0.3, z],
			scale: [radius, radius * height, radius * 0.85],
			rotation: [0, Math.sin(x), 0, Math.cos(x)],
			...solid,
		});
	});
	// Stepping stones along a curve across the garden, each its own size and turn.
	for (let i = 0; i < 7; i++) {
		const t = i / 6 - 0.5;
		const r = math.randFloat(0.24, 0.34);
		scene.createMesh({
			mesh: geometry.cylinder({
				radiusTop: r,
				radiusBottom: r * 1.05,
				height: 0.08,
				radialSegments: 7,
			}),
			material: paving,
			position: [t * 6, 0.04, 1.3 * Math.sin(t * 3) + 0.4],
			rotation: [0, Math.sin(i), 0, Math.cos(i)],
			...solid,
		});
	}
	// Pebbles in drifts around the rocks, then moss clumps against their feet, in one batch.
	const PEBBLES = 640;
	const pebbles = scene.createInstances(geometry.sphere({ radius: 1 }), PEBBLES, {
		material: materials.standard({ color: '#ffffff', roughness: 0.7 }),
		colors: true,
		...solid,
	});
	for (let i = 0; i < PEBBLES; i++) {
		const [x, z, radius] = ROCKS[i % ROCKS.length];
		const clump = i >= 560;
		const angle = math.randFloat(0, Math.PI * 2);
		const out = radius * (clump ? math.randFloat(0.85, 1) : math.randFloat(1, 2.4));
		const size = clump ? math.randFloat(0.06, 0.12) : math.randFloat(0.02, 0.065);
		const squash = math.randFloat(0.45, 0.7);
		pebbles.positions.set(
			[x + Math.cos(angle) * out, size * squash * 0.6, z + Math.sin(angle) * out],
			i * 3,
		);
		pebbles.scales.set([size * math.randFloat(1, 1.5), size * squash, size], i * 3);
		pebbles.rotations.set([0, Math.sin(angle), 0, Math.cos(angle)], i * 4);
		const grey = math.randFloat(0.2, 0.7);
		pebbles.colors?.set(
			clump ? [0.05, math.randFloat(0.1, 0.16), 0.02, 1] : [grey, grey * 0.95, grey * 0.9, 1],
			i * 4,
		);
	}
	pebbles.markDirty();
	// Tufts of grass at the rocks and the lantern are the add-on's meadow-grass rosettes, one to a
	// root, each its own size and turn, in the same wind field. The rosettes' costs are measured
	// with the demo's budget, since M3-V8's GPU grass is not built.
	const grassSpecies = builtInSpecies('meadow-grass');
	if (!grassSpecies) throw new Error('the vegetation add-on has no meadow grass');
	const roots: (readonly [number, number])[] = [
		...ROCKS.map(([x, z, r]) => [x + r * 0.9, z + r * 0.5] as const),
		[LANTERN[0] - 0.3, LANTERN[1] + 0.3] as const,
	];
	const grassAsset = generatePlant(grassSpecies, {
		seed: 5,
		variant: 0,
		levels: grassSpecies.levels,
	});
	const grassField = plantWind(ctx, grassAsset, wind.field, { swayDistance });
	const grassLeaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(grassSpecies),
		color: grassSpecies.color.leaf,
		transmission: grassSpecies.color.transmission,
		wind: grassField,
	});
	plantMaterials.push(grassLeaves);
	for (const part of grassAsset.levels[0]?.parts ?? []) {
		const base = geometry.fromArrays(part.arrays);
		base.setLevels(
			grassAsset.levels.slice(1).map((level) => {
				const coarser = level.parts.find((other) => other.name === part.name);
				if (!coarser) throw new Error(`a ${part.name} part has no level at ${level.error} m`);
				return { mesh: geometry.fromArrays(coarser.arrays), error: level.error };
			}),
			{ fade: false },
		);
		const batch = scene.createInstances(base, roots.length, {
			material: grassLeaves,
			values: true,
			...solid,
		});
		roots.forEach(([x, z], i) => {
			batch.positions.set([x, 0, z], i * 3);
			// A tuft stands about a hand high at the rocks: tall enough to read against the sand at
			// the camera's distance, and low enough to stay under the pines beyond the wall.
			batch.scales.fill(math.randFloat(1.1, 1.9), i * 3, i * 3 + 3);
			const turn = math.randFloat(0, Math.PI * 2);
			batch.rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], i * 4);
			batch.values?.set(treeValues(x, z, 5, 0), i * 4);
		});
		batch.markDirty();
	}
	// A stone lantern with a warm light in its fire box.
	const [lx, lz] = LANTERN;
	const parts = [
		[
			geometry.cylinder({ radiusTop: 0.2, radiusBottom: 0.24, height: 0.1, radialSegments: 6 }),
			0.05,
		],
		[
			geometry.cylinder({ radiusTop: 0.08, radiusBottom: 0.1, height: 0.5, radialSegments: 6 }),
			0.35,
		],
		[geometry.box({ width: 0.42, height: 0.08, depth: 0.42 }), 0.64],
		[geometry.cone({ radius: 0.38, height: 0.24, radialSegments: 4 }), 1.06],
		[geometry.sphere({ radius: 0.06 }), 1.21],
	] as const;
	for (const [mesh, y] of parts)
		scene.createMesh({ mesh, material: paving, position: [lx, y, lz], ...solid });
	scene.createMesh({
		mesh: geometry.box({ width: 0.28, height: 0.26, depth: 0.28 }),
		material: materials.standard({ color: '#000000', emissive: '#ffb066', emissiveIntensity: 3 }),
		position: [lx, 0.81, lz],
	});
	scene.createPointLight({
		position: [lx, 0.81, lz + 0.3],
		color: '#ffb066',
		intensity: 1.5,
		range: 3,
	});
	// A preset change gives the plants the new preset's distance, as M3-E6 asks.
	quality.onChange(() => {
		const distance = swayDistanceFor(quality.preset);
		for (const material of plantMaterials) material.setUniform('swayDistance', distance);
	});
	return {
		update() {
			// The field's box follows the camera, and a gust and a push fade, so it steps every frame.
			wind.update();
			// The field keeps two states, so the plants read the one that this frame's run wrote.
			setWindLayer(plantMaterials, wind.field);
		},
	};
}
