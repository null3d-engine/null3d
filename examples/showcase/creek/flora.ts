// The creek's leaves and plants. Fallen leaves float down the stream on its current, each one an
// instance batch row that turns slowly as it drifts. Simple stand-ins mark where the organic models
// go: leafy plants of large leaves at the water's edge, and trees on the banks. Fireflies hover over
// the banks at night.
import {
	type InstanceBatch,
	type MeshArrays,
	quat,
	type SketchContext,
	type SpriteBatch,
} from '@null3d/engine';
import { random, within } from '../../lib/procedural';
import { groundHeight, streamHalf, streamZ, WATER } from './land';

/** Floating leaves in each of the three colors. */
const FLOATING = 24;
/** The length of stream that the leaves float along, before they start again upstream. */
const RUN = 56;
/** Fireflies at night. */
const FIREFLIES = 90;

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
export async function createFlora({
	scene,
	geometry,
	materials,
	textures,
}: SketchContext): Promise<{
	update(t: number): void;
	nightLights(on: boolean): void;
	clear(x: number, z: number): boolean;
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
		}),
	);
	const drift = Float32Array.from({ length: FLOATING * 3 * 4 }, () => next());

	// Leafy plants at the water's edge: seven large leaves around a stem, each tilted up and out.
	const plantSpots = [-11, -6.5, -1.5, 4, 8.5, 15].map((x, k) => {
		const side = k % 2 === 0 ? 1 : -1;
		return { x, z: streamZ(x) + side * streamHalf(x) * 1.18 };
	});
	const plants = scene.createInstances(leafMesh, plantSpots.length * 7, {
		material: leafLook('#3f7a2a'),
		castShadows: true,
		receiveShadows: true,
	});
	plantSpots.forEach(({ x, z }, p) => {
		const y = groundHeight(x, z);
		for (let k = 0; k < 7; k++) {
			const row = p * 7 + k;
			const size = 0.45 + 0.2 * next();
			plants.positions.set([x, y + 0.02, z], row * 3);
			yawTilt((k / 7) * Math.PI * 2 + next() * 0.4, -0.5 - 0.4 * next(), plants.rotations, row * 4);
			plants.scales.set([size, size, size], row * 3);
		}
	});
	plants.markDirty();

	// Trees: a trunk and a canopy of three blobs each, on both banks, away from the water.
	const bark = materials.standard({ color: '#4a3a2c', roughness: 0.9 });
	const foliage = materials.standard({ color: '#2f5a24', roughness: 0.8 });
	const trunk = geometry.cylinder({
		radiusTop: 0.14,
		radiusBottom: 0.24,
		height: 4,
		radialSegments: 10,
	});
	const blob = geometry.sphere({ radius: 1, widthSegments: 16, heightSegments: 10 });
	const treeSpots = [
		[-3, -8.5],
		[5.5, -10],
		[15, -7.5],
		[-16, -9],
		[13, 8.5],
	] as const;
	for (const [x, dz] of treeSpots) {
		const z = streamZ(x) + dz;
		const y = groundHeight(x, z);
		const shadow = { castShadows: true, receiveShadows: true };
		scene.createMesh({ mesh: trunk, material: bark, position: [x, y + 2, z], ...shadow });
		for (const [ox, oy, oz, r] of [
			[0, 4.6, 0, 1.6],
			[0.9, 4.0, 0.4, 1.2],
			[-0.8, 4.2, -0.5, 1.3],
		] as const)
			scene.createMesh({
				mesh: blob,
				material: foliage,
				position: [x + ox, y + oy, z + oz],
				scale: [r, r * 0.85, r],
				...shadow,
			});
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
	const hover = Float32Array.from({ length: FIREFLIES * 4 }, () => next());
	for (let f = 0; f < FIREFLIES; f++) {
		fireflies.sizes.set([0.06, 0.06], f * 2);
		fireflies.colors.set([6, 5, 1.2, 1], f * 4);
	}
	fireflies.setActiveCount(0);
	let lit = false;

	const treeFootprints = treeSpots.map(([x, dz]) => ({ x, z: streamZ(x) + dz, r: 0.6 }));
	const plantFootprints = plantSpots.map(({ x, z }) => ({ x, z, r: 0.5 }));
	const footprints = [...treeFootprints, ...plantFootprints];
	return {
		clear: within(footprints),
		nightLights(on) {
			lit = on;
			fireflies.setActiveCount(on ? FIREFLIES : 0);
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
