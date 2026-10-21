// The creek's trees, plants and leaves. Trees stand on the banks, hostas at the water's edge,
// ferns over the banks and shrubs at the trees' feet: models built in Blender, which cast and
// receive the sun's shadows. Fallen leaves float down the stream on its current, each one an
// instance batch row that turns slowly as it drifts. Fireflies hover over the banks at night.
import {
	type InstanceBatch,
	type MeshArrays,
	quat,
	type SketchContext,
	type SpriteBatch,
} from '@null3d/engine';
import { markEffect } from '../../lib/layers';
import { random, within } from '../../lib/procedural';
import type { Crown } from './air';
import { groundHeight, streamHalf, streamZ, UNREFLECTED_LAYER, WATER } from './land';
import { type Models, PLANT_KINDS, type PlantKind, placed, type TreeKind } from './models';
import { CAVE } from './stones';

/** Floating leaves in each of the three colors. */
const FLOATING = 24;
/** The length of stream that the leaves float along, before they start again upstream. */
const RUN = 56;
/** Fireflies at night. */
const FIREFLIES = 90;
/** Ferns over the banks, before the ones at the cave's mouth. */
const FERNS = 30;
/** Clumps of wildflowers over the banks, in patches. */
const FLOWERS = 90;
/** How far each plant's leaves reach from its middle, in meters at its own size: grass stays out. */
const PLANT_REACH: Record<PlantKind, number> = {
	fern: 0.45,
	hosta: 0.55,
	shrub: 0.6,
	flowers: 0.2,
};
/**
 * The trees: each one's place along the stream, its distance from the stream's middle, its kind
 * and its size. Groves stand on the far bank behind the cave, with young trees among them, and a
 * few trees on the near bank frame the view.
 */
export const TREES: readonly (readonly [number, number, TreeKind, number])[] = [
	[-3, -8.5, 'oak', 0.85],
	[5.5, -10, 'beech', 0.85],
	[15, -7.5, 'birch', 0.8],
	[-16, -9, 'beech', 0.9],
	[13, 8.5, 'oak', 0.85],
	[-9, -12, 'birch', 0.75],
	[21, -10, 'oak', 0.9],
	[1, -13.5, 'beech', 1],
	[8.5, -14, 'oak', 0.95],
	[18, -13, 'beech', 0.9],
	[24, -6, 'birch', 0.7],
	[-20, -6, 'oak', 0.8],
	[2, -6.8, 'birch', 0.5],
	[17, 6.5, 'birch', 0.65],
	[22, 9, 'beech', 0.85],
	[8, 9.5, 'oak', 0.75],
	[-14, 7.5, 'birch', 0.7],
];

/** A plant's place, its turn about y and its size. */
interface Spot {
	x: number;
	z: number;
	yaw: number;
	size: number;
}

/**
 * A leaf about a meter long, along +z, with its stem at the origin: a fold along the midrib, and
 * edges that curl up a little. Its colors run from a lighter midrib to darker edges.
 */
function leaf(): MeshArrays {
	const steps = 8;
	const positions: number[] = [];
	const colors: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const half = 0.32 * Math.sin(Math.PI * t) ** 0.8 * (1 - 0.25 * t);
		const z = t;
		const droop = -0.12 * t * t;
		for (const side of [-1, 0, 1]) {
			const edge = Math.abs(side);
			positions.push(side * half, droop + 0.05 * (1 - edge) + 0.04 * edge * half * 3, z);
			const shade = edge ? 0.8 : 1.1;
			colors.push(shade, shade, shade);
			uvs.push((side + 1) / 2, t);
		}
	}
	for (let i = 0; i < steps; i++) {
		const a = i * 3;
		indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
	}
	return { positions, colors, uvs, indices, computeNormals: true };
}

/** A turn about y, then a tilt about x, written into a batch's rotations at a row's place. */
const turn = quat.create();
function yawTilt(yaw: number, tilt: number, out: Float32Array, at: number): void {
	out.set(quat.fromEuler(turn, tilt, yaw, 0, 'YXZ'), at);
}

/** The leaves, plants, trees and fireflies, with what moves them in each frame. */
export async function createFlora(
	{ scene, geometry, materials, textures }: SketchContext,
	models: Models,
): Promise<{
	update(t: number): void;
	/** Lights the share, from 0 to 1, of the fireflies that the hour's look calls for. */
	nightLights(share: number): void;
	clear(x: number, z: number): boolean;
	crowns: Crown[];
}> {
	const next = random(61);
	const leafMesh = geometry.fromArrays(leaf());
	const leafLook = (color: string) =>
		materials.standard({ color, vertexColors: true, roughness: 0.6, doubleSided: true });

	// Floating leaves: each has a start along the run, a speed, a lane across the stream and a spin.
	const floating = ['#c8782a', '#a8461f', '#d6a63a'].map((color) =>
		scene.createInstances(leafMesh, FLOATING, {
			material: leafLook(color),
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
			layers: UNREFLECTED_LAYER,
		}),
	);
	const drift = Float32Array.from({ length: FLOATING * 3 * 4 }, () => next());

	const shadow = { castShadows: true, receiveShadows: true };
	// Trees on the banks, away from the water, each turned and sized a little differently.
	const treeSpots = TREES.map(([x, dz, kind, grown]) => {
		const z = streamZ(x) + dz;
		const ground = groundHeight(x, z);
		const at = [x, ground - 0.1, z] as const;
		const yaw = next() * Math.PI * 2;
		const size = grown * (0.92 + 0.16 * next());
		const { wood, leaves } = models.trees[kind];
		for (const part of [wood, leaves])
			scene.createMesh({
				mesh: part.mesh,
				material: part.material,
				...placed(part, at, yaw, size),
				...shadow,
			});
		return { x, z, top: ground + 6.5 * size, reach: 2.6 * size };
	});

	// Plants: hostas at the water's edge, ferns over the banks and at the cave's mouth, and shrubs
	// at the trees' feet. Each kind is one instance batch.
	const plantSpots: Record<PlantKind, Spot[]> = { fern: [], hosta: [], shrub: [], flowers: [] };
	const add = (kind: PlantKind, x: number, z: number, size: number) => {
		if (groundHeight(x, z) > WATER + 0.05)
			plantSpots[kind].push({ x, z, yaw: next() * Math.PI * 2, size });
	};
	[-11, -6.5, -1.5, 4, 8.5, 15].forEach((x, k) => {
		const side = k % 2 === 0 ? 1 : -1;
		add('hosta', x, streamZ(x) + side * streamHalf(x) * 1.4, 0.9 + 0.4 * next());
	});
	for (let k = 0; k < FERNS; k++) {
		const x = -20 + 40 * next();
		const side = next() < 0.5 ? -1 : 1;
		add('fern', x, streamZ(x) + side * streamHalf(x) * (1.3 + 2.4 * next()), 0.8 + 0.5 * next());
	}
	// Ferns flank the cave's mouth and grow among its boulders.
	const [ax, az] = [Math.sin(CAVE.yaw), Math.cos(CAVE.yaw)];
	for (const [out, across] of [
		[2.6, -3.4],
		[2.6, -2.6],
		[2.6, 2.5],
		[2.6, 3.3],
		[3.6, -4.2],
		[3.8, 4.0],
		[1.2, -4.4],
		[1.0, 4.4],
	] as const)
		add(
			'fern',
			CAVE.x + out * ax + across * az,
			CAVE.z + out * az - across * ax,
			0.9 + 0.4 * next(),
		);
	// Wildflowers in patches: a spot joins a patch where a slow wave over the banks runs high.
	for (let k = 0, tries = 0; k < FLOWERS && tries < FLOWERS * 20; tries++) {
		const x = -18 + 36 * next();
		const side = next() < 0.5 ? -1 : 1;
		const z = streamZ(x) + side * streamHalf(x) * (1.3 + 3.5 * next());
		if (Math.sin(x * 0.45 + 1.7) + Math.sin(z * 0.6 - x * 0.2) < 0.6) continue;
		add('flowers', x, z, 1.1 + 0.5 * next());
		k++;
	}
	// A patch on the near bank, in the camera's usual view.
	for (let k = 0; k < 24; k++) {
		const x = -3 + 9 * next();
		add('flowers', x, streamZ(x) + streamHalf(x) * (1.25 + 1.6 * next()), 1.1 + 0.5 * next());
	}
	for (const { x, z } of treeSpots)
		for (let k = 0; k < 2; k++) {
			const a = next() * Math.PI * 2;
			const r = 1.3 + 1.2 * next();
			add('shrub', x + r * Math.cos(a), z + r * Math.sin(a), 0.8 + 0.5 * next());
		}
	for (const kind of PLANT_KINDS) {
		const spots = plantSpots[kind];
		const part = models.plants[kind];
		const batch = scene.createInstances(part.mesh, spots.length, {
			material: part.material,
			...shadow,
		});
		spots.forEach(({ x, z, yaw, size }, row) => {
			const { position, rotation, scale } = placed(
				part,
				[x, groundHeight(x, z) - 0.03, z],
				yaw,
				size,
			);
			batch.positions.set(position, row * 3);
			batch.rotations.set(rotation, row * 4);
			batch.scales.set(scale, row * 3);
		});
		batch.markDirty();
	}

	// Fireflies: soft dots of light, made in code, which glow through bloom.
	const dot = new Uint8Array(32 * 32 * 4);
	for (let i = 0; i < 32 * 32; i++) {
		const r = Math.hypot((i % 32) - 15.5, Math.floor(i / 32) - 15.5) / 16;
		dot.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - r) ** 2)], i * 4);
	}
	const fireflies: SpriteBatch = await scene.createSprites({
		count: FIREFLIES,
		map: textures.fromData({ width: 32, height: 32, data: dot }),
		blending: 'additive',
		depthWrite: false,
		dynamic: true,
	});
	markEffect(fireflies);
	const hover = Float32Array.from({ length: FIREFLIES * 4 }, () => next());
	for (let f = 0; f < FIREFLIES; f++) {
		fireflies.sizes.set([0.06, 0.06], f * 2);
		fireflies.colors.set([6, 5, 1.2, 1], f * 4);
	}
	fireflies.setActiveCount(0);
	let lit = false;

	const footprints = [
		...treeSpots.map(({ x, z }) => ({ x, z, r: 0.7 })),
		...PLANT_KINDS.flatMap((kind) =>
			plantSpots[kind].map(({ x, z, size }) => ({ x, z, r: PLANT_REACH[kind] * size })),
		),
	];
	return {
		crowns: treeSpots,
		clear: within(footprints),
		nightLights(share) {
			const count = Math.round(FIREFLIES * Math.min(1, Math.max(0, share)));
			lit = count > 0;
			fireflies.setActiveCount(count);
		},
		update(t) {
			// Read the arrays in each frame: they are views of engine memory, which moves when it grows.
			for (let b = 0; b < floating.length; b++) {
				const { positions, rotations, scales } = floating[b] as InstanceBatch;
				for (let k = 0; k < FLOATING; k++) {
					const d = (b * FLOATING + k) * 4;
					const speed = drift[d + 1] as number;
					const spin = drift[d + 3] as number;
					const along = ((drift[d] as number) * RUN + t * (0.25 + 0.2 * speed)) % RUN;
					const x = -RUN / 2 + along;
					const z = streamZ(x) + ((drift[d + 2] as number) * 2 - 1) * 0.7 * streamHalf(x);
					positions[k * 3] = x;
					positions[k * 3 + 1] = WATER + 0.02 + 0.012 * Math.sin(t * 2.1 + spin * 20 + x * 2.3);
					positions[k * 3 + 2] = z;
					yawTilt(
						spin * 6.3 + t * (spin - 0.5) * 0.6,
						0.05 * Math.sin(t * 1.7 + x),
						rotations,
						k * 4,
					);
					const size = 0.15 + 0.07 * speed;
					scales[k * 3] = size;
					scales[k * 3 + 1] = size;
					scales[k * 3 + 2] = size;
				}
			}
			if (!lit) return;
			const { positions } = fireflies;
			for (let f = 0; f < FIREFLIES; f++) {
				const a = hover[f * 4] as number;
				const b = hover[f * 4 + 1] as number;
				const c = hover[f * 4 + 2] as number;
				const d = hover[f * 4 + 3] as number;
				const x = -14 + 28 * a + 0.6 * Math.sin(t * 0.4 + d * 9);
				const side = b < 0.5 ? -1 : 1;
				const z =
					streamZ(x) + side * (streamHalf(x) * 1.1 + 5 * c) + 0.5 * Math.cos(t * 0.33 + a * 7);
				positions[f * 3] = x;
				positions[f * 3 + 1] =
					groundHeight(x, z) + 0.4 + 0.6 * d + 0.15 * Math.sin(t * 0.9 + b * 13);
				positions[f * 3 + 2] = z;
			}
		},
	};
}
