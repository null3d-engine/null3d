// The deterministic simulation demo's scenery: a court of flagstones made in code, a ring wall of
// stones around it, pillars that carry lanterns, and turf beyond. None of it takes part in the run:
// the simulation's wall is a radius, and the stones stand just outside it.
import type { Material, SketchContext, Vec3 } from '@null3d/engine';
import { math } from '@null3d/engine';
import { ARENA } from './sim';

/** The wall's stones, the lanterns on their pillars, and the radius that the wall stands at. */
const STONES = 36;
const LANTERNS = 8;
const WALL = ARENA + 0.7;
/** The flagstone texture's size, and the size of a slab in it, in texels. */
const SIZE = 128;
const SLAB = 32;

/** Builds the court around the arena. */
export function buildCourt({ scene, geometry, materials, textures }: SketchContext): void {
	// Flagstones: a grid of slabs, each its own shade, with darker joints.
	math.seed(11);
	const data = new Uint8Array(SIZE * SIZE * 4);
	const shades = Array.from({ length: (SIZE / SLAB) * (SIZE / SLAB) }, () =>
		math.randFloat(0.7, 1.12),
	);
	for (let i = 0; i < SIZE * SIZE; i++) {
		const [u, v] = [i % SIZE, Math.floor(i / SIZE)];
		const joint = u % SLAB < 2 || v % SLAB < 2;
		const slab = shades[Math.floor(u / SLAB) + Math.floor(v / SLAB) * (SIZE / SLAB)] as number;
		const shade = (joint ? 0.45 : slab) * math.randFloat(0.92, 1);
		data.set([128 * shade, 118 * shade, 108 * shade, 255], i * 4);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: SIZE, height: SIZE, data, ...look });
	const flags = materials.standard({ map, roughness: 0.75, uvTransform: { repeat: [9, 9] } });
	const solid = { castShadows: true, receiveShadows: true };
	const box = geometry.box();
	const block = (material: Material, position: Vec3, scale: Vec3, turn = 0) =>
		scene
			.createMesh({ mesh: box, material, position, scale, ...solid })
			.setRotationEuler(0, turn, 0);
	const court = geometry.cylinder({
		radiusTop: WALL,
		radiusBottom: WALL,
		height: 0.2,
		radialSegments: 64,
	});
	scene.createMesh({ mesh: court, material: flags, position: [0, -0.1, 0], ...solid });
	block(materials.standard({ color: '#2d3324', roughness: 0.95 }), [0, -0.25, 0], [400, 0.2, 400]);

	// The wall: a ring of stones, and pillars that carry lanterns between them.
	const stone = materials.standard({ color: '#7d746a', roughness: 0.85 });
	for (let k = 0; k < STONES; k++) {
		const turn = (k / STONES) * Math.PI * 2;
		const tall = 0.8 + 0.25 * math.random();
		block(stone, [Math.sin(turn) * WALL, tall / 2, Math.cos(turn) * WALL], [1.7, tall, 0.5], turn);
	}
	const flame = materials.standard({ color: '#000000', emissive: '#ffb066', emissiveIntensity: 9 });
	for (let k = 0; k < LANTERNS; k++) {
		const turn = ((k + 0.5) / LANTERNS) * Math.PI * 2;
		const [x, z] = [Math.sin(turn) * (WALL + 0.4), Math.cos(turn) * (WALL + 0.4)];
		block(stone, [x, 1.4, z], [0.6, 2.8, 0.6], turn);
		block(flame, [x, 3, z], [0.32, 0.38, 0.32], turn);
		scene.createPointLight({ position: [x, 3.1, z], color: '#ffae5e', intensity: 18, range: 7 });
	}
}
