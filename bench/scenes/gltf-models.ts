// The glTF model scenes, defined once for null3D's image tests and for their three.js twin, which
// the parity test compares them with. It is plain data with no engine imports. Each scene loads one
// Khronos sample model from the sample content (.dev/sample-content.md), and frames it with a
// camera that both engines place from the model's bounds: on +Z of the bounds' center, at the
// distance that fits the bounding sphere in the view. Scenes of models with lights of their own
// add only a dim ambient light; the others take the benchmark scenes' sun and ambient light.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, SUN } from './spec';

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const MODELS_IMAGE = PARITY_CANVAS;

/** The clear color: a mid gray, as in the texture maps scene, which keeps edges alike in both engines. */
export const MODELS_BACKGROUND = '#60666e';

/** The camera's vertical field of view in degrees. */
export const MODELS_FOV = 40;

/** The ambient light of a model with lights of its own. */
export const DIM_AMBIENT = { color: '#ffffff', intensity: 0.1 } as const;

/**
 * The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives
 * it. Pages cannot import that module, and the sample check reads the names given here.
 */
const sampleUrl = (path: string) => `/samples/${path}`;

/** A model scene: the file, and whether its own lights light it. */
export interface ModelScene {
	/** The model's address on the dev server. */
	url: string;
	/** True when the file's lights light the model, with the dim ambient light alone besides. */
	ownLights?: boolean;
	/** The camera's direction from the bounds' center, which the distance scales. The default is +Z. */
	view?: readonly [number, number, number];
	/**
	 * The scene of the same model without compression, whose reference images this scene's image
	 * test must match.
	 */
	uncompressed?: string;
}

/**
 * The model scenes by name. Each names a feature of the loader: metal-rough materials with their
 * texture maps, texture transforms in a .gltf file whose buffers and images are files of their
 * own, unlit materials, emissive strength, lights, a node with instancing of its own, KTX2 textures
 * in a .gltf file, alpha modes, vertex colors, the second texture coordinates, and meshopt
 * compression under each of its two names. The vendor name's file is the instancing model as
 * gltfpack compresses it (tests/lib/meshopt-fixtures.ts), which the repository keeps. The Khronos
 * name's file covers every mode and filter.
 */
export const MODEL_SCENES = {
	'metal-rough': {
		url: sampleUrl('sources/khronos/MetalRoughSpheres/glTF-Binary/MetalRoughSpheres.glb'),
	},
	'texture-transform': {
		url: sampleUrl('sources/khronos/TextureTransformTest/glTF/TextureTransformTest.gltf'),
	},
	unlit: { url: sampleUrl('sources/khronos/UnlitTest/glTF-Binary/UnlitTest.glb') },
	'emissive-strength': {
		url: sampleUrl('sources/khronos/EmissiveStrengthTest/glTF-Binary/EmissiveStrengthTest.glb'),
	},
	lights: {
		url: sampleUrl(
			'sources/khronos/PointLightIntensityTest/glTF-Binary/PointLightIntensityTest.glb',
		),
		ownLights: true,
	},
	instancing: {
		url: sampleUrl('sources/khronos/SimpleInstancing/glTF-Binary/SimpleInstancing.glb'),
	},
	ktx2: {
		url: sampleUrl('sources/khronos/StainedGlassLamp/glTF-KTX-BasisU/StainedGlassLamp.gltf'),
	},
	'alpha-modes': {
		url: sampleUrl('sources/khronos/AlphaBlendModeTest/glTF-Binary/AlphaBlendModeTest.glb'),
	},
	'vertex-colors': {
		url: sampleUrl('sources/khronos/VertexColorTest/glTF-Binary/VertexColorTest.glb'),
	},
	'texture-coordinates': {
		url: sampleUrl('sources/khronos/TextureCoordinateTest/glTF-Binary/TextureCoordinateTest.glb'),
	},
	'meshopt-ext': {
		// An address from this module, so the benchmark pages' build ships the file too.
		url: new URL('../../tests/pages/assets/models/simple-instancing-meshopt.glb', import.meta.url)
			.href,
		uncompressed: 'instancing',
	},
	'meshopt-khr': {
		url: sampleUrl('sources/khronos/MeshoptCubeTest/glTF-Meshopt/MeshoptCubeTest.gltf'),
	},
} as const satisfies Record<string, ModelScene>;

export type ModelName = keyof typeof MODEL_SCENES;

/** The names of the model scenes. */
export const MODEL_NAMES = Object.keys(MODEL_SCENES) as ModelName[];

/**
 * The camera's position and the point it looks at, for a model whose bounds have `center` and
 * `radius`: the sphere fits the view's height and width, with a margin of a tenth.
 */
export function modelCamera(
	center: readonly [number, number, number],
	radius: number,
	view: readonly [number, number, number] = [0, 0, 1],
): {
	position: [number, number, number];
	target: [number, number, number];
	near: number;
	far: number;
} {
	const half = (MODELS_FOV * Math.PI) / 360;
	const aspect = MODELS_IMAGE.width / MODELS_IMAGE.height;
	const fit = Math.min(Math.tan(half), Math.tan(half) * aspect);
	const distance = (radius * 1.1) / Math.sin(Math.atan(fit));
	const length = Math.hypot(...view) || 1;
	const position = view.map((v, k) => (center[k] as number) + (v / length) * distance) as [
		number,
		number,
		number,
	];
	return {
		position,
		target: [center[0], center[1], center[2]],
		near: Math.max(distance - radius * 2, distance / 100),
		far: distance + radius * 2,
	};
}
