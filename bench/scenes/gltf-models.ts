// The glTF model scenes, defined once for null3D's image tests and for their three.js twin, which
// the parity test compares them with. It is plain data with no engine imports. Each scene loads one
// Khronos sample model from the sample content (.dev/sample-content.md), or a small file that the
// tests make in code (tests/pages/lib/gltf-files.ts), and frames it with a
// camera that both engines place from the model's bounds: on +Z of the bounds' center, at the
// distance that fits the bounding sphere in the view. Scenes of models with lights of their own
// add only a dim ambient light; the others take the benchmark scenes' sun and ambient light.
import {
	anisotropyBuilder,
	colorMorphBuilder,
	iorBuilder,
	iridescenceBuilder,
	specularBuilder,
} from '../../tests/pages/lib/gltf-files';
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
	/** The model's address on the dev server, for a scene whose file is not made in code. */
	url?: string;
	/** Makes the scene's .glb file in code, for a scene with no file on the server. */
	file?: () => Uint8Array;
	/** True when the file's lights light the model, with the dim ambient light alone besides. */
	ownLights?: boolean;
	/** The camera's direction from the bounds' center, which the distance scales. The default is +Z. */
	view?: readonly [number, number, number];
	/**
	 * The scene of the same model without compression, whose reference images this scene's image
	 * test must match.
	 */
	uncompressed?: string;
	/** A clip that both engines play from the start, and the time in seconds that they draw. */
	clip?: { name: string; time: number };
	/**
	 * A frame that both engines place the camera from, in place of their bounds. three.js's bounds
	 * of a mesh with morph targets hold every target's shape, and null3D's the shape at rest. Its
	 * bounds of a skinned mesh hold the pose, and null3D's the bind pose.
	 */
	frame?: { center: readonly [number, number, number]; radius: number };
	/**
	 * True when the HDR environment of the backgrounds scene lights the model too, as
	 * `scene.environment` in three.js: a clear coat and a sheen show their reflections there.
	 */
	environment?: boolean;
	/**
	 * The seconds that the scene's image test waits for its frame, when a software GPU takes longer
	 * than the default to build its shaders, as for a clear coat or a sheen.
	 */
	timeoutSeconds?: number;
}

/** The wait of a scene with a clear coat or a sheen, whose builds a software GPU makes slowly. */
const LAYERS_SECONDS = 60;

/** The wait of a scene with hundreds of materials, whose pipeline setup a software GPU makes slowly. */
const GRID_SECONDS = 150;

/** The HDR file of the model scenes' environment: the backgrounds scene's, at full intensity. */
export const MODELS_HDR = sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr');

/**
 * The model scenes by name. Each names a feature of the loader: metal-rough materials with their
 * texture maps, texture transforms in a .gltf file whose buffers and images are files of their
 * own, unlit materials, emissive strength, lights, a node with instancing of its own, KTX2 textures
 * in a .gltf file, alpha modes, vertex colors, the second texture coordinates, meshopt
 * compression under each of its two names, Draco compression, and morph targets: weights that a
 * clip animates, eight
 * targets on two primitives, a file's default weight on primitives that share targets, and targets
 * that move vertex colors. Five scenes make their files in code: the color targets, and small
 * equivalents of four Khronos test models whose originals need an environment map, transmission or
 * lights of their own: KHR_materials_specular's factors and textures, KHR_materials_ior's indices
 * with the specular values, KHR_materials_iridescence's films, and KHR_materials_anisotropy's
 * stretched highlights. Those scenes' own lights light them. The vendor name's file is the instancing model as
 * gltfpack compresses it (tests/lib/meshopt-fixtures.ts), which the repository keeps. The Khronos
 * name's file covers every mode and filter. The Draco scenes draw the sample content's skinned
 * Draco model, and the coordinates test model as Draco's encoder compresses it
 * (tests/lib/draco-fixtures.ts), each against its uncompressed scene. The Khronos models of
 * KHR_materials_clearcoat and KHR_materials_sheen draw under the sun, and two of them also under the
 * HDR environment, whose light the coat reflects and the sheen gathers. The toy car has a coat, a
 * sheen and glass in one model. The Khronos grids of anisotropy and iridescence draw beside the
 * code-built scenes, so a strict comparison covers the real files too.
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
		timeoutSeconds: LAYERS_SECONDS,
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
	rigged: {
		url: sampleUrl('sources/khronos/RiggedSimple/glTF-Binary/RiggedSimple.glb'),
		clip: { name: 'animation_0', time: 1 },
		frame: { center: [0, 0, 0], radius: 4.8 },
	},
	'draco-rigged': {
		url: sampleUrl('sources/khronos/RiggedSimple/glTF-Draco/RiggedSimple.gltf'),
		clip: { name: 'animation_0', time: 1 },
		frame: { center: [0, 0, 0], radius: 4.8 },
		uncompressed: 'rigged',
	},
	'draco-texture-coordinates': {
		// An address from this module, so the benchmark pages' build ships the file too.
		url: new URL('../../tests/pages/assets/models/texture-coordinates-draco.glb', import.meta.url)
			.href,
		uncompressed: 'texture-coordinates',
	},
	'morph-cube': {
		url: sampleUrl('sources/khronos/AnimatedMorphCube/glTF-Binary/AnimatedMorphCube.glb'),
		clip: { name: 'Square', time: 2.4 },
		frame: { center: [0, 0, 0], radius: 3 },
		view: [1, 0.6, 1.4],
	},
	'morph-stress': {
		url: sampleUrl('sources/khronos/MorphStressTest/glTF-Binary/MorphStressTest.glb'),
		clip: { name: 'TheWave', time: 0.5 },
		frame: { center: [0, 0.6, 0], radius: 2.3 },
		view: [0, 0.6, 1],
	},
	specular: { file: () => specularBuilder().glb(), ownLights: true },
	ior: { file: () => iorBuilder().glb(), ownLights: true },
	iridescence: {
		file: () => iridescenceBuilder().glb(),
		ownLights: true,
		timeoutSeconds: LAYERS_SECONDS,
	},
	anisotropy: {
		file: () => anisotropyBuilder().glb(),
		ownLights: true,
		timeoutSeconds: LAYERS_SECONDS,
	},
	'morph-primitives': {
		url: sampleUrl('sources/khronos/MorphPrimitivesTest/glTF-Binary/MorphPrimitivesTest.glb'),
		frame: { center: [0, 0.1, 0], radius: 0.8 },
		view: [0, 1, 1],
	},
	'morph-colors': {
		file: () => colorMorphBuilder().glb(),
		frame: { center: [0, 0.05, 0.1], radius: 1.05 },
		view: [0.3, 0.35, 1],
	},
	clearcoat: {
		url: sampleUrl('sources/khronos/ClearCoatTest/glTF-Binary/ClearCoatTest.glb'),
		timeoutSeconds: LAYERS_SECONDS,
	},
	'clearcoat-env': {
		url: sampleUrl('sources/khronos/ClearCoatTest/glTF-Binary/ClearCoatTest.glb'),
		environment: true,
		timeoutSeconds: LAYERS_SECONDS,
	},
	'clearcoat-car-paint': {
		url: sampleUrl('sources/khronos/ClearCoatCarPaint/glTF-Binary/ClearCoatCarPaint.glb'),
		environment: true,
		timeoutSeconds: LAYERS_SECONDS,
	},
	'clearcoat-wicker': {
		url: sampleUrl('sources/khronos/ClearcoatWicker/glTF-Binary/ClearcoatWicker.glb'),
		view: [0.4, 0.5, 1],
		timeoutSeconds: LAYERS_SECONDS,
	},
	'sheen-chair': {
		url: sampleUrl('sources/khronos/SheenChair/glTF-Binary/SheenChair.glb'),
		view: [0.6, 0.35, 1],
		timeoutSeconds: LAYERS_SECONDS,
	},
	'sheen-cloth': {
		url: sampleUrl('sources/khronos/SheenCloth/glTF/SheenCloth.gltf'),
		timeoutSeconds: LAYERS_SECONDS,
	},
	'sheen-grid': {
		url: sampleUrl('sources/khronos/SheenTestGrid/glTF-Binary/SheenTestGrid.glb'),
		timeoutSeconds: LAYERS_SECONDS,
	},
	'sheen-grid-env': {
		url: sampleUrl('sources/khronos/SheenTestGrid/glTF-Binary/SheenTestGrid.glb'),
		environment: true,
		timeoutSeconds: LAYERS_SECONDS,
	},
	'toy-car': {
		url: sampleUrl('sources/khronos/ToyCar/glTF-Binary/ToyCar.glb'),
		view: [0.7, 0.45, 1],
		timeoutSeconds: LAYERS_SECONDS,
	},
	// The Khronos test grids of the layers above the base, which a test page keeps as one file
	// each: the stretch of KHR_materials_anisotropy over seven strengths against seven roughnesses,
	// and the film of KHR_materials_iridescence over the indices of refraction and the film's
	// thicknesses. The dielectric spheres take the environment's light, which their polished
	// surfaces reflect.
	'anisotropy-strength': {
		url: new URL(
			'../../tests/pages/assets/models/sources/khronos/AnisotropyStrengthTest/AnisotropyStrengthTest.glb',
			import.meta.url,
		).href,
		environment: true,
		timeoutSeconds: GRID_SECONDS,
	},
	'iridescence-dielectric': {
		url: new URL(
			'../../tests/pages/assets/models/sources/khronos/IridescenceDielectricSpheres/IridescenceDielectricSpheres.glb',
			import.meta.url,
		).href,
		environment: true,
		timeoutSeconds: GRID_SECONDS,
	},
	// The Khronos sample's own directional light draws it, its film's thickness comes from a
	// texture, and the environment's light shows through its transmissive head.
	'iridescence-suzanne': {
		url: new URL(
			'../../tests/pages/assets/models/sources/khronos/IridescenceSuzanne/IridescenceSuzanne.glb',
			import.meta.url,
		).href,
		ownLights: true,
		environment: true,
		timeoutSeconds: LAYERS_SECONDS,
	},
} as const satisfies Record<string, ModelScene>;

export type ModelName = keyof typeof MODEL_SCENES;

/**
 * The address that both engines load a model scene's file from: its address on the dev server, or
 * an object URL of the file that the scene makes in code.
 */
export function modelUrl(model: ModelScene): string {
	if (model.url) return model.url;
	if (!model.file) throw new Error('a model scene needs a url or a file');
	const bytes = model.file() as Uint8Array<ArrayBuffer>;
	return URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
}

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
