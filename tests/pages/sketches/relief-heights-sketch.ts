// Relief that null3D draws its own way (decision record D-136), with no three.js twin: displaced
// terrain and a displaced rock without normal maps, whose normals follow the map's slope, casting and
// taking the sun's shadows; a wireframe torus, whose shadow is its lines; and a brick wall of few
// vertices with parallax, beside the same wall without it. ?parallax=off turns
// parallax off with the quality setting, as the Low preset does, so those materials draw their
// displacement alone. The shadow filter is 3 texels, so every GPU tier draws the same image.
import { defineSketch, type Texture } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** False when the sketch module's ?parallax=off switch turns parallax off. */
const PARALLAX = params.get('parallax') !== 'off';

/** Texels along each side of each map. */
const SIZE = 128;

/** A height field's texels as a linear gray map, from `height` at u and v from 0 to 1. */
function heights(height: (u: number, v: number) => number): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++)
			data.fill(
				Math.round(height((x + 0.5) / SIZE, (y + 0.5) / SIZE) * 255),
				(y * SIZE + x) * 4,
				(y * SIZE + x) * 4 + 3,
			);
	return data;
}

/** Rolling hills: a sum of waves along three directions, from 0 to 1. */
const hills = (u: number, v: number) => {
	const t = Math.PI * 2;
	const wave =
		Math.sin(u * t * 2) * Math.cos(v * t * 3) +
		0.6 * Math.sin((u + v) * t * 5) +
		0.3 * Math.cos((u - 2 * v) * t * 7);
	return Math.min(Math.max(0.5 + wave * 0.26, 0), 1);
};

/** Lumps of rock: the product of waves around a sphere's coordinates, from 0 to 1. */
const lumps = (u: number, v: number) =>
	0.5 +
	0.25 * Math.sin(u * Math.PI * 14) * Math.sin(v * Math.PI * 9) +
	0.25 * Math.sin(u * Math.PI * 30 + v * 11);

/** Bricks of 4 by 8 to the map, in running bond, with bevelled edges and sunken mortar. */
const bricks = (u: number, v: number) => {
	const row = Math.floor(v * 8);
	const along = u * 4 + (row % 2) * 0.5;
	const x = along - Math.floor(along);
	const y = v * 8 - row;
	const edge = Math.min(x * 4, (1 - x) * 4, y * 2, (1 - y) * 2);
	return Math.min(Math.max(edge * 3 - 0.15, 0), 1);
};

/** The color of the bricks map: red bricks, a shade each, and gray mortar. */
function brickColors(): Uint8Array {
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const height = bricks((x + 0.5) / SIZE, (y + 0.5) / SIZE);
			const row = Math.floor(((y + 0.5) / SIZE) * 8);
			const shade =
				0.8 + 0.2 * Math.sin(row * 12.9 + Math.floor((x / SIZE) * 4 + (row % 2) * 0.5) * 7.1);
			const color = height > 0.05 ? [170 * shade, 70 * shade, 50 * shade] : [150, 145, 135];
			data.set(color, (y * SIZE + x) * 4);
		}
	return data;
}

export default defineSketch(({ scene, materials, geometry, textures, quality }) => {
	quality.set({ shadowFilter: 3, parallax: PARALLAX });
	scene.setBackground('#8aa4c0');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, position: [0, 3.2, 6.5], target: [0, 0.4, 0] }),
	);
	scene.createDirectionalLight({
		direction: [-0.6, -1, -0.5],
		intensity: 3,
		castShadows: true,
		shadow: { distance: 20 },
	});
	scene.createAmbientLight({ color: '#b0c4ff', intensity: 0.5 });

	const map = (data: Uint8Array, colorSpace: 'linear' | 'srgb' = 'linear'): Texture =>
		textures.fromData({
			width: SIZE,
			height: SIZE,
			data,
			colorSpace,
			mipmaps: true,
			wrap: 'repeat',
		});
	const hillMap = map(heights(hills));
	const rockMap = map(heights(lumps));
	const brickMap = map(heights(bricks));
	const brickColor = map(brickColors(), 'srgb');

	// Terrain of dense vertices whose normals come from the hills' slope.
	scene.createMesh({
		mesh: geometry.plane({ width: 8, height: 8, widthSegments: 160, heightSegments: 160 }),
		material: materials.standard({
			color: '#7c9a58',
			roughness: 0.9,
			displacementMap: hillMap,
			displacementScale: 0.8,
			displacementBias: -0.4,
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		castShadows: true,
		receiveShadows: true,
	});
	// A rock that casts its lumpy shadow on the hills.
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.5, widthSegments: 96, heightSegments: 48 }),
		material: materials.standard({
			color: '#9a9088',
			roughness: 0.8,
			displacementMap: rockMap,
			displacementScale: 0.25,
			displacementBias: -0.1,
		}),
		position: [-1.6, 1.0, 0.6],
		castShadows: true,
		receiveShadows: true,
	});
	// A wireframe torus, whose shadow is its lines.
	scene.createMesh({
		mesh: geometry.torus({ radius: 0.45, tube: 0.16 }),
		material: materials.standard({ color: '#ffd060', wireframe: true }),
		position: [1.7, 1.3, 0.8],
		rotation: [0.5, 0, 0, Math.sqrt(0.75)],
		castShadows: true,
	});
	// Brick walls of four cells each: parallax on the left, the displacement alone on the right.
	for (const [x, parallax] of [
		[-0.9, true],
		[0.9, false],
	] as const)
		scene.createMesh({
			mesh: geometry.plane({ width: 1.6, height: 1.2, widthSegments: 2, heightSegments: 2 }),
			material: materials.standard({
				map: brickColor,
				roughness: 0.85,
				displacementMap: brickMap,
				displacementScale: 0.06,
				parallax,
			}),
			position: [x, 1.0, -1.2],
			castShadows: true,
			receiveShadows: true,
		});
});
