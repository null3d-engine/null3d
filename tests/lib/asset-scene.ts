// A small glTF scene made in code, which tests the asset tool's every step: a smooth ball with
// color, normal and occlusion-roughness-metalness maps, a stand whose node has a child, so its mesh
// moves to a node of its own, four posts with vertex colors drawn by one instancing node, and a
// floor whose texture coordinates run past 1, which keep their floats. The color map's sides are
// not powers of two, so the tool resizes it. The image test draws the scene and the tool's output,
// which must look alike (tests/pages/sketches/asset-scene-sketch.ts).
import { encodePng } from '../../packages/cli/src/png.js';
import { boxArrays, GltfBuilder, type GltfJson } from '../pages/lib/gltf-files.ts';

/** The scene's file and its outputs, from the repository's root. */
export const ASSET_SCENE = {
	source: 'tests/pages/assets/models/asset-scene.glb',
	/** The tool's output with its defaults. */
	optimized: 'tests/pages/assets/models/optimized/asset-scene.glb',
	/** The tool's output with levels of detail and meshopt compression. */
	lodMeshopt: 'tests/pages/assets/models/optimized/asset-scene-lod-meshopt.glb',
	/** The tool's output with a stored tree for every part (`--bvh 1`). */
	trees: 'tests/pages/assets/models/optimized/asset-scene-trees.glb',
	/** The texture files of the outputs. */
	textures: 'tests/pages/assets/models/optimized/textures',
} as const;

/** An image of `width` x `height` whose pixels `pixel` gives, as a PNG file. */
function png(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
	return encodePng({ width, height, data });
}

/** Stripes of four colors across a dark-to-light ramp, 96 x 48 texels. */
function colorMap(): Uint8Array {
	const stripes: [number, number, number][] = [
		[220, 60, 40],
		[240, 200, 60],
		[60, 160, 90],
		[50, 90, 200],
	];
	return png(96, 48, (x, y) => {
		const [r, g, b] = stripes[Math.floor((x + y) / 12) % 4] as [number, number, number];
		const shade = 0.55 + (0.45 * y) / 47;
		return [Math.round(r * shade), Math.round(g * shade), Math.round(b * shade), 255];
	});
}

/** A normal map of round bumps in rows, 64 x 64 texels. */
function normalMap(): Uint8Array {
	return png(64, 64, (x, y) => {
		const u = ((x % 16) - 7.5) / 8;
		const v = ((y % 16) - 7.5) / 8;
		const d = u * u + v * v;
		const [nx, ny] = d < 1 ? [u * 0.6, -v * 0.6] : [0, 0];
		const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
		return [
			Math.round((nx * 0.5 + 0.5) * 255),
			Math.round((ny * 0.5 + 0.5) * 255),
			Math.round((nz * 0.5 + 0.5) * 255),
			255,
		];
	});
}

/** Full occlusion, roughness from smooth at the top to rough at the bottom, metal checks. */
function ormMap(): Uint8Array {
	return png(32, 32, (x, y) => [
		255,
		Math.round(40 + (y / 31) * 200),
		(Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 255 : 0,
		255,
	]);
}

/** A ball of radius 1: 48 segments around and 24 from pole to pole. */
function ballArrays() {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const around = 48;
	const rings = 24;
	for (let r = 0; r <= rings; r++) {
		const theta = (r / rings) * Math.PI;
		for (let s = 0; s <= around; s++) {
			const phi = (s / around) * Math.PI * 2;
			const n = [
				Math.sin(theta) * Math.cos(phi),
				Math.cos(theta),
				-Math.sin(theta) * Math.sin(phi),
			];
			positions.push(...n);
			normals.push(...n);
			uvs.push(s / around, r / rings);
		}
	}
	for (let r = 0; r < rings; r++)
		for (let s = 0; s < around; s++) {
			const a = r * (around + 1) + s;
			const b = a + around + 1;
			indices.push(a, b, a + 1, a + 1, b, b + 1);
		}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		uvs: new Float32Array(uvs),
		indices: new Uint16Array(indices),
	};
}

/** Adds an image file's bytes and a texture of it, and returns the texture's index. */
function texture(builder: GltfBuilder, bytes: Uint8Array, name: string): number {
	const source =
		builder.json.images.push({
			name,
			mimeType: 'image/png',
			bufferView: builder.view(bytes),
		}) - 1;
	return builder.json.textures.push({ source, sampler: 0 }) - 1;
}

/** The scene as a binary glTF file. */
export function assetSceneGlb(): Uint8Array {
	const b = new GltfBuilder();
	b.json.asset.generator = 'null3D asset tool tests';
	b.json.images = [];
	b.json.textures = [];
	b.json.samplers = [{ wrapS: 10497, wrapT: 10497, minFilter: 9987, magFilter: 9729 }];
	const color = texture(b, colorMap(), 'stripes');
	const normal = texture(b, normalMap(), 'bumps');
	const orm = texture(b, ormMap(), 'orm');
	const painted = b.material({
		name: 'painted',
		pbrMetallicRoughness: {
			baseColorTexture: { index: color },
			metallicRoughnessTexture: { index: orm },
		},
		normalTexture: { index: normal },
		occlusionTexture: { index: orm },
	});
	const gray = b.material({
		name: 'stand',
		pbrMetallicRoughness: {
			baseColorFactor: [0.5, 0.5, 0.52, 1],
			metallicFactor: 0,
			roughnessFactor: 0.7,
		},
	});
	const posts = b.material({
		name: 'posts',
		pbrMetallicRoughness: {
			baseColorFactor: [1, 1, 1, 1],
			metallicFactor: 0,
			roughnessFactor: 0.5,
		},
	});
	const tiles = b.material({
		name: 'tiles',
		pbrMetallicRoughness: {
			baseColorTexture: { index: color },
			metallicFactor: 0,
			roughnessFactor: 0.9,
		},
	});

	const ball = ballArrays();
	const ballMesh = b.mesh(
		[
			{
				attributes: {
					POSITION: b.positions(ball.positions),
					NORMAL: b.accessor(ball.normals, 3),
					TEXCOORD_0: b.accessor(ball.uvs, 2),
				},
				indices: b.accessor(ball.indices, 1),
				material: painted,
			},
		],
		'ball',
	);
	const box = boxArrays(1);
	const boxPrimitive = (material: number, extra: GltfJson = {}): GltfJson => ({
		attributes: {
			POSITION: b.positions(box.positions),
			NORMAL: b.accessor(box.normals, 3),
			TEXCOORD_0: b.accessor(box.uvs, 2),
			...extra,
		},
		indices: b.accessor(box.indices, 1),
		material,
	});
	const standMesh = b.mesh([boxPrimitive(gray)], 'stand');
	const colors = new Float32Array(24 * 4);
	for (let v = 0; v < 24; v++) colors.set(v < 12 ? [0.9, 0.3, 0.2, 1] : [0.2, 0.5, 0.9, 1], v * 4);
	const postMesh = b.mesh([boxPrimitive(posts, { COLOR_0: b.accessor(colors, 4) })], 'post');
	const floor = {
		positions: new Float32Array([-3, 0, 3, 3, 0, 3, 3, 0, -3, -3, 0, -3]),
		normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
		uvs: new Float32Array([0, 3, 3, 3, 3, 0, 0, 0]),
		indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
	};
	const floorMesh = b.mesh(
		[
			{
				attributes: {
					POSITION: b.positions(floor.positions),
					NORMAL: b.accessor(floor.normals, 3),
					TEXCOORD_0: b.accessor(floor.uvs, 2),
				},
				indices: b.accessor(floor.indices, 1),
				material: tiles,
			},
		],
		'floor',
	);

	b.node({ name: 'Floor', mesh: floorMesh });
	b.node({ name: 'Ball', mesh: ballMesh, translation: [0, 1.6, 0] });
	const badge = b.node(
		{ name: 'Badge', mesh: postMesh, translation: [0, 0.35, 0.8], scale: [0.3, 0.3, 0.1] },
		true,
	);
	b.node({
		name: 'Stand',
		mesh: standMesh,
		translation: [0, 0.3, 0],
		scale: [1.6, 0.6, 1.6],
		children: [badge],
	});
	const s = Math.SQRT1_2;
	b.uses('EXT_mesh_gpu_instancing');
	b.node({
		name: 'Posts',
		mesh: postMesh,
		extensions: {
			EXT_mesh_gpu_instancing: {
				attributes: {
					TRANSLATION: b.accessor(
						new Float32Array([-2, 0.5, -2, 2, 0.5, -2, -2, 0.5, 2, 2, 0.5, 2]),
						3,
					),
					ROTATION: b.accessor(
						new Float32Array([0, 0, 0, 1, 0, s, 0, s, 0, 0, 0, 1, 0, s, 0, s]),
						4,
					),
					SCALE: b.accessor(
						new Float32Array([0.3, 1, 0.3, 0.3, 1, 0.3, 0.3, 1.4, 0.3, 0.3, 1.4, 0.3]),
						3,
					),
				},
			},
		},
	});
	return b.glb();
}
