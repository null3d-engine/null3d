// The standard material's texture maps, for their image test, each made in code. Top row: a base
// color map, a metal-rough map in stripes of smooth metal and rough paint, and a normal map on a
// quad without tangents and on one with them.
// Bottom row: an occlusion map, an emissive map, a light map on the second texture coordinates, a
// base color map through a texture coordinate transform, and an unlit map through the same.
import { defineSketch, type Texture, type Textures } from '@null3d/engine';

/** Texels on each side of every map. */
const SIZE = 32;

/** A map whose texels `texel` gives, as four numbers from 0 to 255 at column x and row y. */
function map(
	textures: Textures,
	texel: (x: number, y: number) => readonly number[],
	colorSpace: 'srgb' | 'linear',
	uvSet: 0 | 1 = 0,
): Texture {
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) data.set(texel(x, y), (y * SIZE + x) * 4);
	return textures.fromData({
		width: SIZE,
		height: SIZE,
		data,
		colorSpace,
		uvSet,
		mipmaps: true,
		wrap: 'repeat',
	});
}

/** True on the dark squares of a 4 x 4 checkerboard. */
const checker = (x: number, y: number) => ((x >> 3) + (y >> 3)) % 2 === 0;

/** Ridges along u: a normal that leans with the slope of a sine, in tangent space. */
function ridge(x: number): number[] {
	const slope = Math.cos((x / SIZE) * Math.PI * 4) * 1.5;
	const length = Math.hypot(slope, 1);
	return [(-slope / length) * 127.5 + 127.5, 127.5, (1 / length) * 127.5 + 127.5, 255];
}

export default defineSketch(({ scene, materials, geometry, textures }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({
		fov: 35,
		near: 0.1,
		far: 50,
		position: [0, 0, 12],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.6, -0.5, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.6 });

	const checks = map(
		textures,
		(x, y) => (checker(x, y) ? [200, 40, 40, 255] : [240, 240, 240, 255]),
		'srgb',
	);
	const stripes = map(
		textures,
		(x) => ((x >> 3) % 2 === 0 ? [0, 60, 255, 255] : [0, 255, 0, 255]),
		'linear',
	);
	const ridges = map(textures, ridge, 'linear');
	const shadow = map(
		textures,
		(x, y) => (Math.hypot(x - 15.5, y - 15.5) < 9 ? [60, 0, 0, 255] : [255, 0, 0, 255]),
		'linear',
	);
	const glow = map(
		textures,
		(x, y) => (checker(x, y) ? [255, 160, 40, 255] : [0, 0, 0, 255]),
		'srgb',
	);
	const baked = map(textures, (x) => [x * 8, 40, 255 - x * 8, 255], 'srgb', 1);

	const sphere = geometry.sphere({ radius: 0.7, widthSegments: 48, heightSegments: 24 });
	const quad = geometry.plane({ width: 1.4, height: 1.4, widthSegments: 4, heightSegments: 4 });
	const plane = {
		positions: [-0.7, -0.7, 0, 0.7, -0.7, 0, 0.7, 0.7, 0, -0.7, 0.7, 0],
		normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
		uvs: [0, 0, 1, 0, 1, 1, 0, 1],
		indices: [0, 1, 2, 0, 2, 3],
	};
	const tangentQuad = geometry.fromArrays({ ...plane, computeTangents: true });
	// The light map reads a second set of coordinates that runs the other way along u.
	const lightQuad = geometry.fromArrays({ ...plane, uvs1: [1, 0, 0, 0, 0, 1, 1, 1] });

	const place = (
		mesh: typeof sphere,
		material: Parameters<typeof scene.createMesh>[0]['material'],
		x: number,
		y: number,
		turn = 0,
	) => scene.createMesh({ mesh, material, position: [x, y, 0] }).setRotationEuler(turn, 0, 0);
	place(sphere, materials.standard({ map: checks, roughness: 0.6 }), -3.6, 1.4);
	place(
		sphere,
		materials.standard({ color: '#e0b060', metalnessRoughnessMap: stripes, metalness: 1 }),
		-1.2,
		1.4,
	);
	const bumpy = { color: '#b0b8c8', normalMap: ridges, roughness: 0.4 };
	place(quad, materials.standard(bumpy), 1.2, 1.4, -0.3);
	place(tangentQuad, materials.standard(bumpy), 3.6, 1.4, -0.3);

	place(quad, materials.standard({ color: '#d0d0d0', aoMap: shadow }), -4.2, -1.4);
	place(
		quad,
		materials.standard({ color: '#303440', emissive: '#ffffff', emissiveMap: glow }),
		-2.1,
		-1.4,
	);
	place(
		lightQuad,
		materials.standard({ color: '#d0d0d0', lightMap: baked, lightMapIntensity: 2 }),
		0,
		-1.4,
	);
	const uvTransform = { repeat: [3, 2] as const, offset: [0.25, 0] as const, rotation: 0.3 };
	place(quad, materials.standard({ map: checks, uvTransform }), 2.1, -1.4);
	place(quad, materials.unlit({ map: checks, uvTransform }), 4.2, -1.4);
});
