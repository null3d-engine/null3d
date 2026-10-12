// The light shafts demo's scenery: a pine wood on gently rolling ground, with an earthen path down
// the middle. The pines stand tall on bare trunks, with their crowns high up, so a low sun shines
// between the trunks. The forest floor, the bark and the rocks wear maps made in code from seeded
// noise, and the floor's vertex colors lay the needles, the moss and the path's bare earth.
import { type MeshGeometry, math, type SketchContext } from '@null3d/engine';
import { Noise, rock, type TexelSample, terrain, textureSet } from '../lib/procedural';
import { crownWithLevels } from './crowns';

const [TREES, ROCKS] = [150, 24];
/** Linear colors of the forest floor: fallen needles, moss and the path's bare earth. */
const NEEDLES = [0.13, 0.07, 0.035];
const MOSS = [0.045, 0.085, 0.02];
const EARTH = [0.17, 0.11, 0.06];

const noise = new Noise(7);
const { smoothstep, lerp, randFloat } = math;

/** The x of the path's middle at z. */
export const pathX = (z: number) => Math.sin(z * 0.15) * 0.6;

/** The ground's height at a point: gentle rolls that flatten toward the path. */
const height = (x: number, z: number) =>
	1.2 * noise.fbm2(x * 0.06, z * 0.06, 3) * smoothstep(Math.abs(x - pathX(z)), 1.2, 6);

/** The floor's color at a point: needles and moss in patches, and bare earth along the path. */
function floorColor(x: number, z: number, _y: number, _slope: number, out: number[]) {
	const path = 1 - smoothstep(Math.abs(x - pathX(z)), 0.6, 1.4);
	const moss = smoothstep(noise.fbm2(x * 0.15, z * 0.15, 3), -0.2, 0.35);
	for (let c = 0; c < 3; c++)
		out[c] = lerp(lerp(NEEDLES[c] as number, MOSS[c] as number, moss), EARTH[c] as number, path);
}

/** The floor's texel: clods and fallen twigs in a near-white tone, which the vertex colors tint. */
function floorTexel(u: number, v: number, out: TexelSample) {
	const clods = noise.fbm2(u * 16, v * 16, 5, 16);
	const twigs = 0.8 * (1 - smoothstep(Math.abs(noise.fbm2(u * 32 + 5, v * 32, 3, 32)), 0, 0.06));
	out.height = clods * 5 + twigs * 2;
	out.r = out.g = out.b = 0.8 + 0.25 * clods + 0.2 * twigs;
	out.roughness = 0.95;
	out.occlusion = 0.75 + 0.25 * smoothstep(clods, -0.3, 0.2);
}

/** Pine bark: deep furrows up the trunk that wander a little, between plates of scaly bark. */
function barkTexel(u: number, v: number, out: TexelSample) {
	const wander = noise.fbm2(u * 8, v * 8, 3, 8);
	const plates = Math.abs(Math.sin((u * 6 + 0.25 * wander) * Math.PI * 2));
	const scales = noise.fbm2(u * 32, v * 32, 3, 32);
	out.height = plates * 8 + scales * 2;
	out.r = out.g = out.b = 0.45 + 0.55 * plates + 0.1 * scales;
	out.roughness = 0.9;
	out.occlusion = 0.4 + 0.6 * plates;
}

/** Makes the wood: the floor, the pines and the rocks. Gives the bark's maps for wooden parts. */
export function createWood({ scene, geometry, materials, textures }: SketchContext) {
	const solid = { castShadows: true, receiveShadows: true };
	const floorMaps = textureSet(textures, 256, floorTexel);
	const bark = {
		...textureSet(textures, 128, barkTexel),
		uvTransform: { repeat: [1, 6] },
	} as const;
	const land = terrain({ size: 160, quads: 180, tile: 2, middle: 0.3, height, color: floorColor });
	scene.createMesh({
		mesh: geometry.fromArrays(land),
		material: materials.standard({ vertexColors: true, roughness: 1, ...floorMaps }),
		...solid,
	});

	// Each pine is a bare trunk and a crown of tiers above it, with its levels of detail.
	const trunk = geometry.cylinder({ radiusTop: 0.1, radiusBottom: 0.34, radialSegments: 14 });
	const trunks = scene.createInstances(trunk, TREES, {
		material: materials.standard({ color: '#8c7666', roughness: 1, ...bark }),
		...solid,
	});
	const crowns = scene.createInstances(crownWithLevels(geometry), TREES, {
		material: materials.standard({ color: '#ffffff', roughness: 0.85, vertexColors: true }),
		...solid,
	});
	math.seed(11);
	for (let k = 0; k < TREES; k++) {
		const [x, z] = [randFloat(2.6, 26) * (k % 2 ? 1 : -1), randFloat(-60, 14)];
		const [tall, y, turn] = [randFloat(11, 17), height(x, z) - 0.1, randFloat(0, Math.PI)];
		trunks.positions.set([x, y + tall * 0.3, z], k * 3);
		trunks.scales.set([1, tall * 0.6, 1], k * 3);
		crowns.positions.set([x, y + tall * 0.42, z], k * 3);
		crowns.scales.fill(tall * 0.58, k * 3, k * 3 + 3);
		for (const batch of [trunks, crowns])
			batch.rotations.set([0, Math.sin(turn), 0, Math.cos(turn)], k * 4);
	}
	trunks.markDirty(0, TREES);
	crowns.markDirty(0, TREES);

	// Mossy rocks beside the path, in three shapes.
	const shapes = [0, 1, 2].map((s) => geometry.fromArrays(rock(20 + s, 2, [1, 0.55, 0.8])));
	const stone = materials.standard({ color: '#7d786c', roughness: 0.9, ...floorMaps });
	for (let k = 0; k < ROCKS; k++) {
		const z = randFloat(-45, 12);
		const [x, size] = [pathX(z) + randFloat(2, 7) * (k % 2 ? 1 : -1), randFloat(0.3, 1)];
		scene.createMesh({
			mesh: shapes[k % 3] as MeshGeometry,
			material: stone,
			position: [x, height(x, z) - 0.15 * size, z],
			scale: [size, size, size],
			...solid,
		});
	}
	return bark;
}
