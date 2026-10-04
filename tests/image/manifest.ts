// The image test manifest: every image test, which one harness (tests/lib/images.ts) runs in every
// environment. Playwright runs each test in Chrome, on SwiftShader in CI and on the real GPU
// elsewhere, and the device runner's checks plan runs it in the other browsers on the team's devices.
//
// A sketch test names a sketch module and a hold time. The image page draws the sketch in the
// engine's hold mode, at 320 x 180 pixels unless the entry gives a size. A page test names a test
// page that draws and publishes its image itself. Each test draws on all three GPU tiers unless it
// lists fewer, and a sketch draws in the pipelined thread mode unless it lists others.
//
// To add a test, add its entry and run it: bun run test:images -g <name>. Its first run has no
// reference, so it saves its image as a candidate. Look at it with bun run images:review, and make it
// the reference with bun run images:review --accept. Then do the same with CI=1 for the SwiftShader
// reference: on the Mac, Playwright's Chromium draws CI's SwiftShader images byte for byte.
// bun run check fails until the test has both references.
import { BENCH_SCENES, type FeatureScene } from '../../bench/lib/parity.ts';
import { MASK_IMAGE } from '../../bench/scenes/alpha-mask.ts';
import { AO_IMAGE } from '../../bench/scenes/ao.ts';
import { BLOOM_IMAGE } from '../../bench/scenes/bloom.ts';
import { FOG_IMAGE } from '../../bench/scenes/fog.ts';
import {
	MODEL_NAMES,
	MODEL_SCENES,
	MODELS_IMAGE,
	type ModelScene,
} from '../../bench/scenes/gltf-models.ts';
import { GRADING_IMAGE } from '../../bench/scenes/grading.ts';
import { LIGHTS_IMAGE } from '../../bench/scenes/lights.ts';
import { LINE_IMAGE } from '../../bench/scenes/lines.ts';
import { MAPS_IMAGE } from '../../bench/scenes/material-maps.ts';
import { MORPH_IMAGE } from '../../bench/scenes/morph.ts';
import { ORTHO_IMAGE } from '../../bench/scenes/ortho-camera.ts';
import { OUTLINE_IMAGE } from '../../bench/scenes/outline.ts';
import { SHADOW_IMAGE } from '../../bench/scenes/shadows.ts';
import { SKINNING_HOLD, SKINNING_IMAGE } from '../../bench/scenes/skinning.ts';
import { HOLD_TIME, PARITY_CANVAS } from '../../bench/scenes/spec.ts';
import { SPRITE_IMAGE } from '../../bench/scenes/sprites.ts';
import { GRID_IMAGE } from '../../bench/scenes/standard-grid.ts';
import { BACKGROUND_IMAGE } from '../../bench/scenes/texture-background.ts';
import { GLASS_IMAGE } from '../../bench/scenes/transparency.ts';
import { DEMOS } from '../../examples/demos.ts';
import type { DepthMode } from '../../packages/engine/src/page/switches.ts';
import type { EngineModeName } from '../lib/engine-checks.ts';
import { ALL_MODES, type ImageRun, type ImageTest, imageRuns, type Tier } from '../lib/images.ts';
import { STOPS, TONE_MAPPINGS, toneMappingTest } from '../pages/lib/bright-scene.ts';
import { PRECISION } from '../pages/lib/depth-precision.ts';

/**
 * The tolerance of a scene drawn about 1,000 km out against its image at the origin: any change of
 * color counts, and a few pixels may change. The final pass dithers after the tone mapping, so a
 * rounding difference of the GPU below the last bit can still move a pixel by one step, as CI's
 * software GPU did in one pixel of a whole image. A world matrix relative to the origin, instead of
 * to its cell, changes many times more.
 */
const FAR_OUT_TOLERANCE = { threshold: 0, maxDiffRatio: 0.00005 };

/**
 * The switch of tests that compare exact colors with another test's references, such as a scene far
 * out against its image at the origin. Half precision rounds colors differently, by one step in
 * most changed pixels, so these tests keep full precision even when a run turns half precision on
 * for every page. Positions keep full precision either way, which is what they test.
 */
const FULL_PRECISION = 'half=off';

/** The sketch of the tone mapping tests: tiles whose linear colors run from about 0.2 to 16. */
export const BRIGHT_SKETCH = 'tests/pages/sketches/bright-sketch.ts';

/** The name of the test that draws a tone mapping test at an exposure of 1 on the 8-bit path. */
export const eightBitTest = (tone: string) => `tone-${tone}-8-bit`;

/**
 * How far the 8-bit path's image may stray from the HDR path's. Tile colors match, but the 8-bit
 * path averages the samples of an antialiased edge after the tone mapping, and the HDR path before
 * it, so a bright tile's edge against the dark background differs. On the Mac up to 1.5% of the
 * pixels differ, all at edges. Dithering keeps pixelmatch from counting them as antialiasing.
 */
const EIGHT_BIT_TOLERANCE = { maxDiffRatio: 0.03 };

/**
 * The bright scene under each tone mapping, at an exposure of 1 and of 0.5. The 8-bit path, whose
 * shaders tone map themselves, must draw the HDR path's image at an exposure of 1.
 */
function toneMappingTests(): ImageTest[] {
	return TONE_MAPPINGS.flatMap((tone): ImageTest[] => [
		...STOPS.map(
			(stops): ImageTest => ({
				name: toneMappingTest(tone, stops),
				sketch: `${BRIGHT_SKETCH}?tone=${tone}&stops=${stops}`,
				hold: 0,
			}),
		),
		{
			name: eightBitTest(tone),
			sketch: `${BRIGHT_SKETCH}?tone=${tone}&stops=0`,
			hold: 0,
			tiers: ['webgpu', 'webgl2'],
			switches: ['hdr=off'],
			reference: toneMappingTest(tone, 0),
			expect: { hdr: false },
			tolerance: EIGHT_BIT_TOLERANCE,
			deviceTolerance: EIGHT_BIT_TOLERANCE,
		},
	]);
}

/**
 * How far the asset tool's output may stray from its source's image. On the Mac's GPU and on
 * SwiftShader, 1.07% to 1.08% of the pixels differ on each tier, all at the edges of the floor's
 * stripes, where the color map is resized and encoded in ETC1S, and in the ball's highlight. Moved
 * or missing geometry changes far more.
 */
const OPTIMIZED_TOLERANCE = { threshold: 0.1, maxDiffRatio: 0.02 };

/** The sketch of the bloom tests: glowing shapes on a dark ground (bench/scenes/bloom.ts). */
const BLOOM_SKETCH = 'tests/pages/sketches/bloom-sketch.ts';

/** The bloom tests' image size: the parity images' size, as the parity test compares them. */
const BLOOM_SIZE = [BLOOM_IMAGE.width, BLOOM_IMAGE.height] as const;

/**
 * Bloom at two strengths, and the scene without it, on every tier. Compatibility mode starts on
 * the 8-bit path for MSAA, and bloom moves it to HDR color with FXAA, at the start or during play.
 * Both must draw the same image. A device with no HDR target draws no bloom: the page's switch
 * that turns HDR off stands in for one, and must draw the scene without bloom. Bloom at half the
 * render scale draws its levels into the corners of the same targets. The parity test compares
 * the soft and strong images with three.js's UnrealBloomPass.
 */
function bloomTests(): ImageTest[] {
	const test = (name: string, query: string): ImageTest => ({
		name,
		sketch: `${BLOOM_SKETCH}${query}`,
		hold: 1,
		size: BLOOM_SIZE,
	});
	return [
		test('bloom-off', ''),
		test('bloom-soft', '?bloom=soft'),
		test('bloom-strong', '?bloom=strong'),
		{ ...test('bloom-later', '?bloom=strong&later'), reference: 'bloom-strong' },
		test('bloom-scale-50', '?scale=0.5&bloom=strong'),
		{
			...test('bloom-8-bit', '?bloom=strong'),
			tiers: ['webgpu', 'webgl2'],
			switches: ['hdr=off'],
			reference: 'bloom-off',
			expect: { hdr: false },
			tolerance: EIGHT_BIT_TOLERANCE,
			deviceTolerance: EIGHT_BIT_TOLERANCE,
		},
	];
}

/** The sketch of the ambient occlusion tests: a floor, a wall and shapes on them (bench/scenes/ao.ts). */
const AO_SKETCH = 'tests/pages/sketches/ao-sketch.ts';

/**
 * Ambient occlusion with three.js's defaults and with a wider search, and the scene without it, on
 * every tier. The parity test compares the two with three.js's GTAOPass. The sun's test shows that
 * the occlusion darkens only the ambient light, beside the sun's shadows. Ambient occlusion at half
 * the render scale draws into the corners of the same targets, and a quarter-size scale into a
 * smaller corner.
 */
function aoTests(): ImageTest[] {
	const test = (name: string, query: string): ImageTest => ({
		name,
		sketch: `${AO_SKETCH}${query}`,
		hold: 1,
		size: [AO_IMAGE.width, AO_IMAGE.height],
	});
	return [
		test('ao-off', ''),
		test('ao-default', '?ao=default'),
		test('ao-wide', '?ao=wide'),
		test('ao-sun', '?ao=wide&sun'),
		test('ao-scale-50', '?scale=0.5&ao=wide'),
		test('ao-quarter', '?ao=wide&aoscale=0.25'),
		test('ao-custom', '?ao=wide&custom'),
	];
}

/** The sketch of the occlusion tests: a city whose buildings block the view from its streets. */
const OCCLUSION_SKETCH = 'tests/pages/sketches/occlusion-sketch.ts';

/**
 * The city with software occlusion culling off, and on, which must match the same references: the
 * culling skips only what the buildings hide. WebGPU ignores the setting, so the second test runs
 * on WebGL2 alone. The references allow the usual tolerance, since a software GPU on another kind
 * of processor can round a pixel otherwise. The occlusion spec checks that the culling hid objects
 * and draws the same image to the pixel as without it, both drawn on one machine.
 */
function occlusionTests(): ImageTest[] {
	const test = (name: string, side: 'on' | 'off'): ImageTest => ({
		name,
		sketch: `${OCCLUSION_SKETCH}?light`,
		hold: 2.5,
		switches: [`occlusion=${side}`],
	});
	return [
		test('occlusion-off', 'off'),
		{
			...test('occlusion-on', 'on'),
			tiers: ['webgl2'],
			reference: 'occlusion-off',
		},
	];
}

/** The sketch of the color grading tests: hues and grays on a light ground (bench/scenes/grading.ts). */
const GRADING_SKETCH = 'tests/pages/sketches/grading-sketch.ts';

/**
 * Color grading on every tier: a table from a .cube file, a table from a .3dl file, the vignette,
 * and a table at part of its intensity with the vignette. Compatibility mode keeps the 8-bit path
 * with MSAA, where grading runs the final pass in place of the resolve pass. The page's switch that
 * turns HDR off puts the other tiers on that path too, which must draw the HDR path's image. At
 * half the render scale, the final pass grades the scaled image. The parity test compares the
 * .cube and the mixed images with three.js's LUTPass and VignetteShader.
 */
function gradingTests(): ImageTest[] {
	const test = (name: string, query: string): ImageTest => ({
		name,
		sketch: `${GRADING_SKETCH}${query}`,
		hold: 0,
		size: [GRADING_IMAGE.width, GRADING_IMAGE.height],
	});
	return [
		test('lut-cube', '?lut=warm'),
		test('lut-3dl', '?lut=cool'),
		test('vignette', '?vignette'),
		test('lut-vignette', '?lut=warm&mix&vignette'),
		{
			...test('lut-vignette-8-bit', '?lut=warm&mix&vignette'),
			tiers: ['webgpu', 'webgl2'],
			switches: ['hdr=off'],
			reference: 'lut-vignette',
			expect: { hdr: false },
			tolerance: EIGHT_BIT_TOLERANCE,
			deviceTolerance: EIGHT_BIT_TOLERANCE,
		},
		test('lut-vignette-scale-50', '?lut=warm&mix&vignette&scale=0.5'),
	];
}

/** The sketch of the outline tests: a sphere half behind a wall and a box (bench/scenes/outline.ts). */
const OUTLINE_SKETCH = 'tests/pages/sketches/outline-sketch.ts';

/**
 * Outlines on every tier: the default white line around the parts that nothing hides, and a wider
 * orange line with a blue line around hidden parts, around a sphere half behind a wall and a box
 * in the open. At half the render scale, the mask draws into the corner of its target, and the
 * line keeps its width on the canvas. Compatibility mode keeps the 8-bit path with MSAA. The
 * page's switch that turns HDR off puts the other tiers on that path too. The parity test compares
 * both outlines with the same line drawn from the mask of three.js's OutlinePass.
 */
function outlineTests(): ImageTest[] {
	const test = (name: string, query: string): ImageTest => ({
		name,
		sketch: `${OUTLINE_SKETCH}${query}`,
		hold: 0,
		size: [OUTLINE_IMAGE.width, OUTLINE_IMAGE.height],
	});
	return [
		test('outline-plain', '?outline=plain'),
		test('outline-hidden', '?outline=hidden'),
		test('outline-scale-50', '?outline=hidden&scale=0.5'),
		{
			...test('outline-8-bit', '?outline=hidden'),
			tiers: ['webgpu', 'webgl2'],
			switches: ['hdr=off'],
			expect: { hdr: false },
		},
	];
}

/** The sketch of the anti-aliasing tests: thin bars and a bright box on a black background. */
const EDGES_SKETCH = 'tests/pages/sketches/edges-sketch.ts';

/** The anti-aliasing modes, as the page's option names them. */
const ANTIALIAS_MODES = ['msaa', 'fxaa', 'none'] as const;

/**
 * The edges scene in each anti-aliasing mode on each tier, then in the one-sample modes on the
 * 8-bit path. There the final pass reads color that the scene shaders tone mapped already, and it
 * must draw the HDR path's image. FXAA judges edges by the brightness after tone mapping on both
 * paths, but the 8-bit path blends the tone mapped colors, so a few edge pixels differ.
 */
function antialiasTests(): ImageTest[] {
	return [
		...ANTIALIAS_MODES.map(
			(mode): ImageTest => ({
				name: `antialias-${mode}`,
				sketch: EDGES_SKETCH,
				hold: 0,
				switches: [`antialias=${mode}`],
			}),
		),
		...(['fxaa', 'none'] as const).map(
			(mode): ImageTest => ({
				name: `antialias-${mode}-8-bit`,
				sketch: EDGES_SKETCH,
				hold: 0,
				tiers: ['webgpu', 'webgl2'],
				switches: [`antialias=${mode}`, 'hdr=off'],
				reference: `antialias-${mode}`,
				expect: { hdr: false },
				tolerance: EIGHT_BIT_TOLERANCE,
				deviceTolerance: EIGHT_BIT_TOLERANCE,
			}),
		),
	];
}

/** The vertex formats sketch, and how its tests draw it. */
const VERTEX_FORMATS = {
	sketch: 'tests/pages/sketches/vertex-formats-sketch.ts',
	hold: 0,
	size: [400, 300],
	modes: ['pipelined', 'single-threaded'],
} as const;

/** The vertex types sketch, and how its tests draw it. */
const VERTEX_TYPES = {
	sketch: 'tests/pages/sketches/vertex-types-sketch.ts',
	hold: 0,
	size: [480, 270],
} as const;

/**
 * How far the image of meshes with integer attributes may stray from their float twins' image: a
 * change of at most one step of 255 in each channel. Pixelmatch's color distance of such a change
 * is at most 0.54, and this threshold allows 0.56. A change of two steps in red or green goes past
 * it. Anti-aliased edges, where a GPU's rounding of a vertex can cover a sample or not, do not
 * count.
 */
const ONE_STEP = { threshold: 0.004, maxDiffRatio: 0 };

/** The geometry generators sketch, and how its tests draw it. */
const GENERATORS = {
	sketch: 'tests/pages/sketches/generators-sketch.ts',
	hold: 0,
	size: [480, 270],
} as const;

/** The orthographic camera's sketch, and the size of its image. */
const ORTHO = {
	sketch: 'tests/pages/sketches/ortho-camera-sketch.ts',
	size: [ORTHO_IMAGE.width, ORTHO_IMAGE.height] as const,
	hold: 0,
};

/** The page of the depth precision tests, and its image's size. */
const DEPTH_PAGE = { page: 'tests/pages/depth-precision.html', size: PRECISION.size, hold: 0 };

/**
 * S1-cells' tolerance on other devices: about half the share of its frame that its boxes cover, so a
 * frame that lost most of the scene fails.
 */
const S1_CELLS_DEVICE_TOLERANCE = { maxDiffRatio: 0.003 };

/** The WebGL2 depth modes that ?depth= forces. */
const DEPTH_MODES: readonly DepthMode[] = ['standard', 'reversed-gl', 'reversed'];

/** The tests of every feature, before the depth prepass and half precision draw some again. */
const FEATURE_TESTS: readonly ImageTest[] = [
	// A clear color, read back through the engine's readback on each GPU interface.
	{ name: 'clear', page: 'tests/pages/clear.html', size: [64, 64], tiers: ['webgpu', 'webgl2'] },
	// Every texture command of the GPU layer, replayed on each path, which must all draw one image,
	// and release every image they had.
	{
		name: 'replay-textures',
		page: 'tests/pages/replay-textures.html',
		size: [320, 256],
		sameOnEveryTier: true,
		expect: { released: true },
	},
	// Cube, 3D and high dynamic range textures through every texture command, replayed on each
	// path, which must all draw one image. Each path filters 32-bit floats exactly when it offers
	// to, which the page reports apart from the image.
	{
		name: 'replay-cube-3d',
		page: 'tests/pages/replay-cube-3d.html',
		size: [320, 200],
		sameOnEveryTier: true,
		expect: { released: true, float32AsOffered: true },
	},
	// A hand-built draw list: GPU culling, then indirect draws from a render bundle with MSAA.
	{
		name: 'replay-instanced',
		page: 'tests/pages/replay.html',
		size: [256, 256],
		tiers: ['webgpu'],
		// 13 red and 12 blue boxes are in view. The 26th box sits behind the camera, and the 27th
		// above the grid on a layer that the view leaves out.
		expect: { visible: [13, 12] },
	},
	// An animated scene held at 1.5 seconds: the same steps and seeded random numbers in every mode.
	{
		name: 'held',
		sketch: 'tests/pages/sketches/animated-sketch.ts',
		hold: 1.5,
		modes: ALL_MODES,
	},
	// Textures from PNG, JPEG, WebP and AVIF files, sRGB and linear textures, each wrap mode, and
	// magnified texels with each filter. Every thread mode sends the images to the thread that draws
	// its own way, and must draw the same image.
	{
		name: 'textures',
		sketch: 'tests/pages/sketches/textures-sketch.ts',
		hold: 0,
		size: [480, 270],
		modes: ALL_MODES,
	},
	// Mip levels that the GPU makes: a checkerboard that shrinks and a floor that recedes, with and
	// without mip levels, and with anisotropic filtering.
	{
		name: 'texture-mipmaps',
		sketch: 'tests/pages/sketches/texture-mipmaps-sketch.ts',
		hold: 0,
		size: [480, 270],
	},
	// The texture calls of a sketch: loadTexture with and without the flip, loadImageBitmap with
	// fromImageBitmap, data in bytes, half floats and layers, updates that bring new texels and a new
	// size, a destroyed map, and colors multiplied by alpha. Every thread mode must draw one image.
	{
		name: 'texture-api',
		sketch: 'tests/pages/sketches/texture-api-sketch.ts',
		hold: 0,
		size: [480, 270],
		modes: ALL_MODES,
	},
	// KTX2 files of ETC1S and UASTC data, which the transcoder turns into the compressed format that
	// each device supports, with the files' mip levels, beside the same picture from a PNG file. A
	// ramp whose size takes no compressed format becomes RGBA8. Every thread mode starts the
	// transcoder from its own thread, and must draw the same image.
	{
		name: 'ktx2',
		sketch: 'tests/pages/sketches/ktx2-sketch.ts',
		hold: 0,
		size: [480, 270],
		modes: ALL_MODES,
	},
	// The same files where the device keeps to one family of compressed formats, or has none, as
	// ?compression= makes it: BC7 as on a desktop GPU, ASTC alone, and RGBA8. Every format draws the
	// image of the device's own formats, so each borrows its references.
	...(
		[
			['ktx2-bc7', 'bc'],
			['ktx2-astc', 'astc'],
			['ktx2-rgba8', 'none'],
		] as const
	).map(([name, family]) => ({
		name,
		sketch: 'tests/pages/sketches/ktx2-sketch.ts',
		hold: 0,
		size: [480, 270] as const,
		switches: [`compression=${family}`],
		reference: 'ktx2',
	})),
	// glTF sample models that assets.loadGltf loads and scene.instantiate copies, one for each feature
	// of the loader: materials with their maps, texture transforms, unlit and emissive strength,
	// lights, instancing, KTX2 textures, alpha modes, vertex colors, the second texture coordinates,
	// meshopt compression and morph targets. The parity test compares each with three.js's
	// GLTFLoader. A model compressed with meshopt must draw as its uncompressed scene does. A model
	// with a clip holds the clip's time.
	...MODEL_NAMES.map((model): ImageTest => {
		const { uncompressed, clip } = MODEL_SCENES[model] as ModelScene;
		return {
			name: `gltf-${model}`,
			sketch: `tests/pages/sketches/gltf-sketch.ts?model=${model}`,
			size: [MODELS_IMAGE.width, MODELS_IMAGE.height],
			hold: clip?.time ?? 0,
			...(uncompressed ? { reference: `gltf-${uncompressed}` } : {}),
		};
	}),
	// The asset tool's test scene, then the tool's output, which must draw the source's image: its
	// positions and coordinates in 16-bit integers, normals in bytes, a mesh moved to a child node,
	// instances that carry the dequantizing transform, meshopt compression and KTX2 textures.
	// Compressed textures and 8-bit normals change some pixels a little, so the output takes a
	// tolerance of its own.
	{
		name: 'asset-scene',
		sketch: 'tests/pages/sketches/asset-scene-sketch.ts',
		size: [MODELS_IMAGE.width, MODELS_IMAGE.height],
		hold: 0,
	},
	{
		name: 'asset-scene-optimized',
		sketch: 'tests/pages/sketches/asset-scene-sketch.ts?file=optimized',
		size: [MODELS_IMAGE.width, MODELS_IMAGE.height],
		hold: 0,
		reference: 'asset-scene',
		tolerance: OPTIMIZED_TOLERANCE,
		deviceTolerance: OPTIMIZED_TOLERANCE,
	},
	// Copies of a glTF model made in code: scene.instantiate, scene.clone, a model with 16-bit
	// positions, and an instance batch from scene.createInstances whose rows move every part of the
	// model. Each tier must place every part the same way.
	{
		name: 'gltf-copies',
		sketch: 'tests/pages/sketches/gltf-copies-sketch.ts',
		size: [MODELS_IMAGE.width, MODELS_IMAGE.height],
		hold: 0,
	},
	// The skeletons of two animated glTF models, drawn with debug.skeleton at a held time: the Fox
	// sample model running, and an arm made in code waving, with a cubic spline clip. Their meshes are
	// hidden, so the image shows the joints alone, where the animation step posed them. The
	// single-threaded mode has no job workers, so the loader resamples the clips itself.
	{
		name: 'gltf-skeleton',
		sketch: 'tests/pages/sketches/gltf-skeleton-sketch.ts',
		hold: 0.6,
		size: [400, 225],
		modes: ['pipelined', 'single-threaded'],
	},
	// Animated glTF sample characters at a held time: the KayKit Knight walking, its sword and
	// shield following its joints, and the Fox running, on every tier.
	{
		name: 'gltf-animated',
		sketch: 'tests/pages/sketches/gltf-animated-sketch.ts',
		hold: 0.6,
		size: [400, 225],
	},
	// A picture behind a lit box and an unlit box, as three.js draws a texture background: it fills
	// the view, upright, and every object draws over it. The parity test compares it with its
	// three.js twin.
	{
		name: 'texture-background',
		sketch: 'tests/pages/sketches/texture-background-sketch.ts',
		size: [BACKGROUND_IMAGE.width, BACKGROUND_IMAGE.height],
		hold: 0,
	},
	// The same scene on the 8-bit path, where the background's own shader tone maps its color. It
	// must draw the HDR path's image.
	{
		name: 'texture-background-8-bit',
		sketch: 'tests/pages/sketches/texture-background-sketch.ts',
		size: [BACKGROUND_IMAGE.width, BACKGROUND_IMAGE.height],
		hold: 0,
		tiers: ['webgpu', 'webgl2'],
		switches: ['hdr=off'],
		reference: 'texture-background',
		expect: { hdr: false },
	},
	// Fifty textures that load in waves in a live engine, a band of rows per frame under a small
	// upload budget, while their array grows twice, to 64 layers. No frame may upload more than the
	// budget, and the GPU memory count must match the array.
	{
		name: 'texture-arrays',
		page: 'tests/pages/texture-arrays.html',
		size: [400, 240],
		modes: ALL_MODES,
		expect: { withinBudget: true, memoryCounted: true },
	},
	// A small static scene: lit and unlit meshes, a hierarchy and an instance batch.
	{ name: 'scene', sketch: 'tests/pages/sketches/boxes-sketch.ts', hold: 0, modes: ALL_MODES },
	// A box that fixed steps move at 50 steps per second, and a camera that follows it from the late
	// update, held at 1.5 seconds: the box stays at the center, and every mode runs the same steps.
	{
		name: 'follow',
		sketch: 'tests/pages/sketches/follow-sketch.ts',
		hold: 1.5,
		modes: ALL_MODES,
	},
	// The sketch of the project that the command-line tool's tests run in, held at 1.5 seconds. The
	// shot command draws the project's own page, and its images must match these references.
	{ name: 'project', sketch: 'tests/fixtures/project/sketch.ts', hold: 1.5 },
	// The same scene on WebGL2 with each upload copied out of shared memory first.
	{
		name: 'scene-copied-uploads',
		sketch: 'tests/pages/sketches/boxes-sketch.ts',
		hold: 0,
		tiers: ['webgl2'],
		switches: ['uploads=copy'],
		reference: 'scene',
	},
	// The same scene at render scales of 1, 0.75 and 0.5. Each range reaches down to 0.5, so the
	// final pass scales the image up on every GPU path, even the 8-bit one, and hold mode draws at
	// the range's highest scale. At 1 each pixel shows its own texel, so the image is the scene's.
	{
		name: 'render-scale-100',
		sketch: 'tests/pages/sketches/boxes-sketch.ts?scale=1',
		hold: 0,
		reference: 'scene',
	},
	{ name: 'render-scale-75', sketch: 'tests/pages/sketches/boxes-sketch.ts?scale=0.75', hold: 0 },
	{
		name: 'render-scale-50',
		sketch: 'tests/pages/sketches/boxes-sketch.ts?scale=0.5',
		hold: 0,
		modes: ALL_MODES,
	},
	// The 8-bit path's final pass only copies the colors that it scales up, so it draws the HDR
	// path's image, apart from the edges that it resolves after the tone mapping.
	{
		name: 'render-scale-50-8-bit',
		sketch: 'tests/pages/sketches/boxes-sketch.ts?scale=0.5',
		hold: 0,
		tiers: ['webgpu', 'webgl2'],
		switches: ['hdr=off'],
		reference: 'render-scale-50',
		expect: { hdr: false },
		tolerance: EIGHT_BIT_TOLERANCE,
		deviceTolerance: EIGHT_BIT_TOLERANCE,
	},
	...toneMappingTests(),
	...antialiasTests(),
	...bloomTests(),
	...aoTests(),
	...outlineTests(),
	...occlusionTests(),
	...gradingTests(),
	// The bright scene without a background on a transparent canvas, which keeps premultiplied
	// alpha: the output spec checks the alpha of the captured pixels.
	{
		name: 'transparent',
		sketch: `${BRIGHT_SKETCH}?background=none`,
		hold: 0,
		switches: ['transparent'],
	},
	// Object calls: turns about an object's own axes, a move along them, a hand moved under a turned
	// and scaled arm with keepWorld, which then swings with the arm, and bounds that culling tests:
	// one box that its bounds hide, and one that is never culled.
	{ name: 'objects', sketch: 'tests/pages/sketches/objects-sketch.ts', hold: 1 },
	// A scene that spans grid cells, with a turned tree and a camera on a turned rig.
	{ name: 'cells', sketch: 'tests/pages/sketches/cells-sketch.ts', hold: 1 },
	// The same scene 100 km out, away from a cell's center, and about 1,000 km out at the center of a
	// cell, 977 cells of 1,024 m along x. Each must draw the scene's image. 100 km out, the tree's
	// children and the camera round below a hundredth of a millimeter, which changes a pixel or so;
	// at a cell's center the engine computes the same numbers as at the origin. With threshold 0,
	// any change of color counts, except on anti-aliased edges. With world matrices relative to the
	// origin instead of to cells, 60 such pixels change 100 km out and 124 at 1,000 km, while the
	// default tolerance would count at most one of them.
	{
		name: 'cells-100km',
		sketch: 'tests/pages/sketches/cells-sketch.ts?x=100000',
		hold: 1,
		reference: 'cells',
		switches: [FULL_PRECISION],
		tolerance: { threshold: 0, maxDiffRatio: 0.0003 },
	},
	{
		name: 'cells-1000km',
		sketch: `tests/pages/sketches/cells-sketch.ts?x=${977 * 1024}`,
		hold: 1,
		reference: 'cells',
		switches: [FULL_PRECISION],
		tolerance: FAR_OUT_TOLERANCE,
	},
	// The same scene at the Earth's radius, 0.3 m past a whole meter, in large-world mode: root
	// positions keep 64-bit precision through the setters, and each batch's rows sit around its
	// origin. 32-bit positions there move in steps of 0.5 m. The scene's own sums stay off any
	// cell's center, as 100 km out, and keep the same tolerance.
	{
		name: 'cells-6378km',
		sketch: 'tests/pages/sketches/cells-sketch.ts?x=6378137.3&origin',
		hold: 1,
		reference: 'cells',
		switches: [FULL_PRECISION, 'largeWorld'],
		tolerance: { threshold: 0, maxDiffRatio: 0.0003 },
	},
	// Debug drawing: every shape of ctx.debug over a small scene, the axes of a spinning box and the
	// frustum of a second camera. The single-threaded mode runs the sketch on the page, which draws
	// the same lines. The S24+'s GPU puts some lines one pixel off, in 1.6% of the pixels, so it
	// keeps its own references, which the S24 shares and the test 1,000 km out compares with too.
	{
		name: 'debug',
		sketch: 'tests/pages/sketches/debug-sketch.ts',
		hold: 1,
		size: [400, 225],
		modes: ['pipelined', 'single-threaded'],
		switches: [FULL_PRECISION],
		tolerance: { threshold: 0, maxDiffRatio: 0 },
		devices: ['sm-s926b', 'sm-s921b'],
	},
	// The same scene about 1,000 km out, at the center of a cell: the lines keep 64-bit positions,
	// which the engine draws relative to the camera, so the frame must match. In 32-bit floats from
	// the origin, the lines would move in steps of 6 cm there.
	{
		name: 'debug-1000km',
		sketch: `tests/pages/sketches/debug-sketch.ts?x=${977 * 1024}`,
		hold: 1,
		size: [400, 225],
		reference: 'debug',
		switches: [FULL_PRECISION],
		tolerance: FAR_OUT_TOLERANCE,
	},
	// Each debug view of a scene with lit, unlit, see-through and instanced objects, on every tier.
	...(['normals', 'depth', 'overdraw', 'wireframe', 'shadows'] as const).map(
		(view): ImageTest => ({
			name: `debug-view-${view}`,
			sketch: `tests/pages/sketches/debug-view-sketch.ts?view=${view}`,
			hold: 0,
		}),
	),
	// Objects, a parent and its child, and instance batches on three layers, some of them moved to
	// other layers after they were created, and a camera that draws two of the layers. A child keeps
	// its own layers, so the child of a parent that the camera leaves out still draws.
	{ name: 'layers', sketch: 'tests/pages/sketches/layers-sketch.ts', hold: 0.1 },
	// The main directional light's shadows with 1 to 4 cascades, near the camera and far from it:
	// casters that receive shadows, a receiver that casts none, a caster that receives none, and an
	// unlit box in a shadow. Both GPU paths draw the same shadows, so every tier must draw the
	// WebGPU image. WebGL2 takes the 8-bit path, which averages antialiased edges after the tone
	// mapping, so about 0.16% of the pixels differ, all at edges, on the Mac and with SwiftShader.
	// A shadow drawn wrong changes several percent. The parity test compares the three cascades with
	// three.js.
	...[3, 1, 2, 4].map((cascades) => ({
		name: cascades === 3 ? 'shadows' : `shadows-cascades-${cascades}`,
		sketch: `tests/pages/sketches/shadows-sketch.ts?cascades=${cascades}`,
		hold: 0,
		size: [SHADOW_IMAGE.width, SHADOW_IMAGE.height] as const,
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	})),
	// The same scene with the 5 x 5 shadow filter of the High and Ultra presets, whose edges are
	// softer than the 3 x 3 filter's.
	{
		name: 'shadows-filter-5',
		sketch: 'tests/pages/sketches/shadows-sketch.ts?filter=5',
		hold: 0,
		size: [480, 270],
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	},
	// Car-sized boxes standing on a street, in the last cascade from above, and from a low angle in
	// the first cascade and in the last. Each box's shadow must meet its base with no lit line
	// between them.
	...['', 'near', 'far'].map(
		(view): ImageTest => ({
			name: view === '' ? 'shadows-contact' : `shadows-contact-${view}`,
			sketch: `tests/pages/sketches/shadow-contact-sketch.ts${view === '' ? '' : `?view=${view}`}`,
			hold: 0,
			size: [480, 270],
			sameOnEveryTier: true,
			tolerance: { maxDiffRatio: 0.005 },
		}),
	),
	// The same scene with custom materials on the ground and the red boxes, whose surface function
	// keeps the standard look: they cast and receive shadows as the standard material does, so the
	// references are copies of the shadows test's, with its tolerance for WebGL2's edges.
	{
		name: 'shadows-custom',
		sketch: 'tests/pages/sketches/shadows-sketch.ts?custom',
		hold: 0,
		size: [SHADOW_IMAGE.width, SHADOW_IMAGE.height],
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	},
	// Spot light shadows: two spot lights, each with a tile of the shadow atlas, over casters that
	// receive shadows, a receiver that casts none, a caster that receives none, and an unlit box.
	// The tile size is fixed, as the presets of the GPU tiers differ. Both GPU paths draw the same
	// shadows; WebGL2's 8-bit path differs at edges, as in the shadows test.
	{
		name: 'spot-shadows',
		sketch: 'tests/pages/sketches/spot-shadows-sketch.ts',
		hold: 0,
		size: [480, 270],
		switches: ['shadowTileSize=1024'],
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	},
	// Point light shadows: one point light among casters on every side, whose shadows fall across
	// the six tiles of its cube onto the ground and a wall. The switch turns point light shadows
	// on, as the presets of WebGL2 and compatibility mode leave them off.
	{
		name: 'point-shadows',
		sketch: 'tests/pages/sketches/point-shadows-sketch.ts',
		hold: 0,
		size: [480, 270],
		switches: ['shadowTileSize=1024', 'pointLightShadows'],
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	},
	// Skinning: three characters skinned to chains of joints, each in another pose of one clip. The
	// parity test compares the image with three.js's SkinnedMesh. WebGPU skins them in a compute
	// pass, and WebGL2 in the vertex shader of each pass. ?shadows stands them on a ground under a
	// sun whose shadows must follow each pose. Every tier draws the same image.
	...(['', 'shadows'] as const).map(
		(variant): ImageTest => ({
			name: variant ? `skinning-${variant}` : 'skinning',
			sketch: `tests/pages/sketches/skinning-sketch.ts${variant ? `?${variant}` : ''}`,
			hold: SKINNING_HOLD,
			size: [SKINNING_IMAGE.width, SKINNING_IMAGE.height],
			sameOnEveryTier: true,
		}),
	),
	// The characters with a custom material that samples a texture, which WebGPU skins in the
	// skinning pass and WebGL2 in the vertex shader of the material's own skinned builds.
	{
		name: 'skinning-custom-textures',
		sketch: 'tests/pages/sketches/skinning-sketch.ts?textured',
		hold: SKINNING_HOLD,
		size: [SKINNING_IMAGE.width, SKINNING_IMAGE.height],
		sameOnEveryTier: true,
	},
	// The same characters from a quantized mesh, whose joints, weights and normals both paths
	// read in their own types: it draws the image of floats, within the steps of 8-bit normals.
	{
		name: 'skinning-quantized',
		sketch: 'tests/pages/sketches/skinning-sketch.ts?quantized',
		hold: SKINNING_HOLD,
		size: [SKINNING_IMAGE.width, SKINNING_IMAGE.height],
		reference: 'skinning',
	},
	// The middle character sees through, so the transparent pass draws it skinned, in front of its
	// shadow, with each way to skin, and on WebGL2 in the vertex shader. Compatibility mode blends
	// on the 8-bit path, which differs in the see-through pixels, so each tier has its own image.
	...(['', '-vertex'] as const).map(
		(way): ImageTest => ({
			name: `skinning-blend${way}`,
			sketch: 'tests/pages/sketches/skinning-sketch.ts?shadows&blend',
			hold: SKINNING_HOLD,
			size: [SKINNING_IMAGE.width, SKINNING_IMAGE.height],
			...(way
				? {
						tiers: ['webgpu', 'compat'],
						switches: ['skinning=vertex'],
						reference: 'skinning-blend',
					}
				: {}),
		}),
	),
	// The same scenes skinned in the vertex shader of each pass, which D-20 measures against the
	// skinning pass: they must draw the same images.
	...(['', 'shadows'] as const).map(
		(variant): ImageTest => ({
			name: variant ? `skinning-${variant}-vertex` : 'skinning-vertex',
			sketch: `tests/pages/sketches/skinning-sketch.ts${variant ? `?${variant}` : ''}`,
			hold: SKINNING_HOLD,
			size: [SKINNING_IMAGE.width, SKINNING_IMAGE.height],
			tiers: ['webgpu', 'compat'],
			switches: ['skinning=vertex'],
			reference: variant ? `skinning-${variant}` : 'skinning',
		}),
	),
	// The middle character outlined: the outline's mask skins it in its pose, from the skinning
	// pass's vertices or in the vertex shader, and on WebGL2 always in the vertex shader. Each tier
	// draws the scene in its own way, so each has its own image.
	...(['', '-vertex'] as const).map(
		(way): ImageTest => ({
			name: `skinning-outline${way}`,
			sketch: 'tests/pages/sketches/skinning-sketch.ts?outline',
			hold: SKINNING_HOLD,
			size: [SKINNING_IMAGE.width, SKINNING_IMAGE.height],
			...(way
				? {
						tiers: ['webgpu', 'compat'],
						switches: ['skinning=vertex'],
						reference: 'skinning-outline',
					}
				: {}),
		}),
	),
	// Morph targets: three spheres of one mesh, each at its own weights of three targets, one of
	// them below 0. The parity test compares the image with three.js's morphTargetInfluences. WebGPU
	// morphs them in the skinning pass, and WebGL2 in the vertex shader of each pass. ?shadows
	// stands them on a ground under a sun whose shadows must follow each shape. Every tier draws the
	// same image, and weights set by the targets' names draw it too. With the ground, WebGL2 draws
	// the outlines' edge pixels a little differently: 0.113% of the pixels on the Mac's GPU.
	...(['', 'shadows'] as const).map(
		(variant): ImageTest => ({
			name: variant ? `morph-${variant}` : 'morph',
			sketch: `tests/pages/sketches/morph-sketch.ts${variant ? `?${variant}` : ''}`,
			hold: 0,
			size: [MORPH_IMAGE.width, MORPH_IMAGE.height],
			sameOnEveryTier: true,
			...(variant && { tolerance: { maxDiffRatio: 0.002 } }),
		}),
	),
	// The third sphere from close by, where a step of the half floats that hold the deltas would
	// show. The parity test compares it with three.js's deltas in 32-bit floats.
	{
		name: 'morph-closeup',
		sketch: 'tests/pages/sketches/morph-sketch.ts?closeup',
		hold: 0,
		size: [MORPH_IMAGE.width, MORPH_IMAGE.height],
		sameOnEveryTier: true,
	},
	{
		name: 'morph-names',
		sketch: 'tests/pages/sketches/morph-sketch.ts?names',
		hold: 0,
		size: [MORPH_IMAGE.width, MORPH_IMAGE.height],
		reference: 'morph',
	},
	// WebGL2 keeps a preset's count of each object's weights, the largest. With two kept, the third
	// sphere draws without its smallest weight, as the scene with that weight set to 0 draws it.
	{
		name: 'morph-capped',
		sketch: 'tests/pages/sketches/morph-sketch.ts?capped',
		hold: 0,
		size: [MORPH_IMAGE.width, MORPH_IMAGE.height],
		tiers: ['webgl2'],
	},
	{
		name: 'morph-cap',
		sketch: 'tests/pages/sketches/morph-sketch.ts',
		hold: 0,
		size: [MORPH_IMAGE.width, MORPH_IMAGE.height],
		tiers: ['webgl2'],
		switches: ['morphTargets=2'],
		reference: 'morph-capped',
	},
	// The orthographic camera: towers seen from above at an angle, with the near plane cutting the
	// slab's front corner and the far plane cutting the bar at the back. The parity test compares
	// the image with three.js's OrthographicCamera.
	{ name: 'ortho-camera', ...ORTHO },
	// The same view from four edges that setOrthoHeight then halves.
	{
		name: 'ortho-camera-edges',
		...ORTHO,
		sketch: `${ORTHO.sketch}?edges`,
		reference: 'ortho-camera',
	},
	// The same scene 1,000 km out, at the center of a cell, where each cell's offset moves the
	// view's box. It must draw exactly the scene's image, as the cells test does there.
	{
		name: 'ortho-camera-1000km',
		...ORTHO,
		sketch: `${ORTHO.sketch}?x=${977 * 1024}`,
		reference: 'ortho-camera',
		switches: [FULL_PRECISION],
		tolerance: FAR_OUT_TOLERANCE,
	},
	// Each depth mode that ?depth= forces on WebGL2 must cut the scene at the same near and far
	// planes, and draw its image.
	...DEPTH_MODES.map(
		(depth): ImageTest => ({
			name: `ortho-camera-${depth}`,
			...ORTHO,
			tiers: ['webgl2'],
			switches: [`depth=${depth}`],
			reference: 'ortho-camera',
			expect: { drewAsked: true },
		}),
	),
	// Meshes from arrays in every vertex format, a mesh too big for 16-bit indices that splits into
	// parts, and normals and tangents that the engine computes: on job workers in the threaded build,
	// and on the page in the single-threaded build, which must compute the same values. WebGL2 lays
	// out each vertex format in its own code, and must draw the WebGPU image. Dithering keeps
	// pixelmatch from passing over antialiased edges, where the two differ in 0.14% of the pixels on
	// the Mac and in 0.34% with SwiftShader. A quad drawn wrong changes over 1%.
	{
		name: 'vertex-formats',
		...VERTEX_FORMATS,
		tiers: ['webgpu', 'webgl2'],
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	},
	// Compatibility mode takes the 8-bit path, which averages the samples of antialiased edges after
	// the tone mapping, so its edges differ from the HDR path's and it keeps references of its own.
	{ name: 'vertex-formats-compat', ...VERTEX_FORMATS, tiers: ['compat'], expect: { hdr: false } },
	// Meshes whose positions, normals, tangents, texture coordinates, colors, joints and weights
	// are 8-bit and 16-bit integers, normalized and plain, and their float twins, which hold the
	// values that shaders read from the integers. Each tier must draw the integers as it draws the
	// twins. WebGL2 reads plain integers as whole numbers itself, WebGPU reads them as fractions
	// that the shader scales back, and joints take WebGL2's integer attributes.
	{
		name: 'vertex-types-float',
		...VERTEX_TYPES,
		sketch: `${VERTEX_TYPES.sketch}?float`,
		switches: [FULL_PRECISION],
	},
	{
		name: 'vertex-types',
		...VERTEX_TYPES,
		reference: 'vertex-types-float',
		switches: [FULL_PRECISION],
		tolerance: ONE_STEP,
	},
	// The nine geometry generators, each lit and with its texture coordinates shown as colors.
	// WebGL2 must draw the WebGPU image, apart from the antialiased edges that dithering keeps
	// pixelmatch from passing over.
	{
		name: 'generators',
		...GENERATORS,
		tiers: ['webgpu', 'webgl2'],
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	},
	// Compatibility mode's 8-bit path averages antialiased edges after the tone mapping, so it keeps
	// references of its own.
	{ name: 'generators-compat', ...GENERATORS, tiers: ['compat'], expect: { hdr: false } },
	// Towers on a floor that runs into linear fog and exponential squared fog, lit and unlit, and two
	// towers whose materials turn fog off. The parity test compares each image with three.js's `Fog`
	// and `FogExp2`.
	...(['linear', 'exp2'] as const).map(
		(fog): ImageTest => ({
			name: `fog-${fog}`,
			sketch: `tests/pages/sketches/fog-sketch.ts?fog=${fog}`,
			hold: 0,
			size: [FOG_IMAGE.width, FOG_IMAGE.height],
		}),
	),
	// The standard material's spheres over metalness and roughness, and each option that a
	// material fixes when it is created: emissive color, flat shading, double-sided faces, and
	// vertex colors with the standard and the unlit material.
	{
		name: 'standard-grid',
		sketch: 'tests/pages/sketches/standard-sketch.ts?scene=grid',
		hold: 0,
		size: [GRID_IMAGE.width, GRID_IMAGE.height],
	},
	{
		name: 'standard-features',
		sketch: 'tests/pages/sketches/standard-sketch.ts?scene=features',
		hold: 0,
		size: [480, 270],
	},
	// Clustered point and spot lights over a floor of shapes, with no directional light: one point
	// light, a grid of 16 and a grid of 256, three spot lights of different cones, and 16 point
	// lights through an orthographic camera. The parity test compares the grid of 16 and the spot
	// lights with three.js.
	...(
		[
			['lights-1', 'lights=1'],
			['lights-16', 'lights=16'],
			['lights-256', 'lights=256'],
			['lights-spot', 'scene=spot'],
			['lights-ortho', 'lights=16&camera=ortho'],
		] as const
	).map(([name, query]) => ({
		name,
		sketch: `tests/pages/sketches/lights-sketch.ts?${query}`,
		hold: 0,
		size: [LIGHTS_IMAGE.width, LIGHTS_IMAGE.height] as const,
	})),
	// Custom materials with surface functions: pairs of a standard material and a surface function
	// that keeps its look, which must match, then surface functions that change the look. Each
	// thread mode sends the shaders to the thread that draws in its own way.
	{
		name: 'custom-surface',
		sketch: 'tests/pages/sketches/custom-material-sketch.ts',
		hold: 0,
		size: [480, 270],
		modes: ALL_MODES,
	},
	// Custom materials with uniforms: one WGSL whose uniforms take their first values, or change
	// through set() after creation, with a standard value beside them.
	{
		name: 'custom-uniforms',
		sketch: 'tests/pages/sketches/custom-uniforms-sketch.ts',
		hold: 0,
		size: [480, 270],
	},
	// Custom materials with vertex offsets: waves that uniforms shape, a swelling with a surface
	// function from the same WGSL, and a twist beside the same torus with the standard material.
	{
		name: 'custom-vertex-offset',
		sketch: 'tests/pages/sketches/custom-vertex-offset-sketch.ts',
		hold: 0,
		size: [480, 270],
	},
	// The built-in values of custom materials, at a held time: frame, camera and object, and the
	// surface's world position, in a surface function and a vertex offset.
	// A full shader as a custom material, at a held time: a hologram on meshes and instances, and a
	// shader that reads vertex colors, which a mesh without colors does not draw.
	{
		name: 'custom-full-shader',
		sketch: 'tests/pages/sketches/custom-full-shader-sketch.ts',
		hold: 1,
		size: [480, 270],
		modes: ALL_MODES,
	},
	{
		name: 'custom-builtins',
		sketch: 'tests/pages/sketches/custom-builtins-sketch.ts',
		hold: 1.5,
		size: [480, 270],
		modes: ALL_MODES,
	},
	// The README's dissolve: a surface function with uniforms and the mask alpha mode, at four
	// stages of its progress.
	{
		name: 'custom-dissolve',
		sketch: 'tests/pages/sketches/custom-dissolve-sketch.ts',
		hold: 0,
		size: [480, 270],
	},
	// Custom materials with textures: two textures that a surface function samples, the same WGSL
	// without them, which samples white, a vertex offset that reads a height in the vertex stage,
	// and a texture with a nearest filter. The thread modes send textures and shaders apart.
	{
		name: 'custom-textures',
		sketch: 'tests/pages/sketches/custom-textures-sketch.ts',
		hold: 0,
		size: [480, 270],
		modes: ALL_MODES,
	},
	// Each texture map of the standard material, made in code: base color, metal-rough, normal maps
	// on quads with and without tangents, occlusion, emissive, a light map on the second texture
	// coordinates, and base color maps through a texture coordinate transform, standard and unlit.
	// The parity test draws the same scene with three.js.
	{
		name: 'standard-maps',
		sketch: 'tests/pages/sketches/standard-maps-sketch.ts',
		hold: 0,
		size: [MAPS_IMAGE.width, MAPS_IMAGE.height],
	},
	// Masked materials under MSAA: cards cut by vertex alpha at three cutoffs, with the standard and
	// the unlit material, crossing each other, and a batch of tilted cards. The parity test compares
	// it with three.js's alphaTest.
	{
		name: 'alpha-mask',
		sketch: 'tests/pages/sketches/alpha-mask-sketch.ts',
		hold: 0,
		size: [MASK_IMAGE.width, MASK_IMAGE.height],
	},
	// Wide lines: widths in pixels and in world units, round joins, colors at each point, dashes, a
	// loop and a blended line, over a floor and in front of a wall. The parity test compares it with
	// three.js's Line2 and LineSegments2 with a LineMaterial.
	{
		name: 'lines',
		sketch: 'tests/pages/sketches/lines-sketch.ts',
		hold: 0,
		size: [LINE_IMAGE.width, LINE_IMAGE.height],
	},
	// Lit lines: helixes that the sun, a point light and the ambient light shade, a line that gives
	// off light, and a dashed line whose width is in world units, in fog beside an unlit line.
	{
		name: 'lines-lit',
		sketch: 'tests/pages/sketches/lines-lit-sketch.ts',
		hold: 0,
	},
	// The same kinds of line one pixel wide, which the parity test compares with three.js's Line,
	// LineSegments and LineLoop with a LineBasicMaterial, and its LineDashedMaterial.
	{
		name: 'lines-basic',
		sketch: 'tests/pages/sketches/lines-basic-sketch.ts',
		hold: 0,
		size: [LINE_IMAGE.width, LINE_IMAGE.height],
	},
	// Sprites: blended ones that show frames of an atlas at several sizes, rotations, colors and
	// depths, sorted back to front, and opaque ones that keep their size in pixels and stand on their
	// positions. The parity test compares it with three.js's Sprite and SpriteMaterial.
	{
		name: 'sprites',
		sketch: 'tests/pages/sketches/sprites-sketch.ts',
		hold: 0,
		size: [SPRITE_IMAGE.width, SPRITE_IMAGE.height],
	},
	// 100,000 sprites of a dynamic batch in one draw: a field of them seen from above, and a row of
	// sprites sized in pixels whose centers lie outside the view. It holds its first frame, and takes
	// S1's limit: SwiftShader draws 100,000 rows on WebGPU in tens of seconds.
	{
		name: 'sprites-100k',
		sketch: 'tests/pages/sketches/sprites-many-sketch.ts',
		hold: 0,
		timeoutSeconds: 90,
	},
	// Decals on a wall and on the floor, whose depth bias makes them win the depth test everywhere.
	// WebGL2's other depth modes store depth another way round, and must draw the same image.
	{
		name: 'depth-bias',
		sketch: 'tests/pages/sketches/depth-bias-sketch.ts',
		hold: 0,
		size: [480, 270],
	},
	...(['standard', 'reversed-gl'] as const).map(
		(depth): ImageTest => ({
			name: `depth-bias-${depth}`,
			sketch: 'tests/pages/sketches/depth-bias-sketch.ts',
			hold: 0,
			size: [480, 270],
			tiers: ['webgl2'],
			switches: [`depth=${depth}`],
			reference: 'depth-bias',
		}),
	),
	// See-through planes and a sphere, created nearest first, which must draw farthest first with
	// normal blending. The parity test compares it with three.js's transparent materials.
	{
		name: 'transparency',
		sketch: 'tests/pages/sketches/transparency-sketch.ts',
		hold: 0,
		size: [GLASS_IMAGE.width, GLASS_IMAGE.height],
	},
	// The same scene with custom materials on the lit planes and the sphere, whose surface function
	// keeps the standard look: they blend as the standard material does, so the references are
	// copies of the transparency test's.
	{
		name: 'transparency-custom',
		sketch: 'tests/pages/sketches/transparency-sketch.ts?custom',
		hold: 0,
		size: [GLASS_IMAGE.width, GLASS_IMAGE.height],
	},
	// Additive and multiply blending, a batch of blended quads sorted row by row, render order,
	// a surface without the depth test, and a glow map with straight and premultiplied colors.
	{
		name: 'blending',
		sketch: 'tests/pages/sketches/blending-sketch.ts',
		hold: 0,
		size: [480, 270],
	},
	// Orbit controls after the controls test's drags, made through the controls' own calls. The
	// controls test must draw this image after it makes the drags with Playwright.
	{ name: 'controls', sketch: 'tests/pages/sketches/controls-sketch.ts?moved', hold: 0 },
	// Two surfaces 1 cm apart at each distance from 1 m to 10 km, in each GPU path's own depth mode.
	// The page paints each pixel where the farther surface shows through as the nearer one, and
	// publishes their count. The engine must draw the depth it chose, no mode may fight up to 40 m,
	// and the farther surface must win the ties of the tie tile.
	{
		name: 'depth-precision',
		...DEPTH_PAGE,
		expect: { drewAsked: true, tiesWon: true, apartNear: true },
	},
	// The same scene in each depth mode that ?depth= forces on WebGL2, which paints to the same image.
	// A browser without EXT_clip_control draws reversed depth in WebGL2's range. Standard depth and
	// reversed depth in that range lose the surfaces somewhere farther than 40 m on every GPU.
	...DEPTH_MODES.map(
		(depth): ImageTest => ({
			name: `depth-precision-${depth}`,
			...DEPTH_PAGE,
			tiers: ['webgl2'],
			switches: [`depth=${depth}`],
			reference: 'depth-precision',
			expect: {
				drewAsked: true,
				tiesWon: true,
				apartNear: true,
				...(depth !== 'reversed' && { fights: true }),
			},
		}),
	),
	// Each feature demo in examples/, held at the demo's time.
	...DEMOS.map(
		(demo): ImageTest => ({
			name: `demo-${demo.name}`,
			sketch: `examples/${demo.name}/sketch.ts`,
			hold: demo.hold,
		}),
	),
	// The benchmark scenes' hold frames, which the parity command also compares with three.js once
	// null3D draws every feature of the scene. S2's trees and S1-cells' boxes each cover under 1% of
	// their frame, so other devices may differ in fewer of their pixels.
	...BENCH_SCENES.map(
		(scene): ImageTest => ({
			name: scene,
			page: `bench/pages/null3d/${scene}.html`,
			size: [PARITY_CANVAS.width, PARITY_CANVAS.height],
			hold: HOLD_TIME,
			modes: ['pipelined', 'low latency'],
			timeoutSeconds: 90,
			...(scene === 's2' && { deviceTolerance: { maxDiffRatio: 0.002 } }),
			...(scene === 's1-cells' && { deviceTolerance: S1_CELLS_DEVICE_TOLERANCE }),
		}),
	),
	// S1-cells culled without grid cells, which must draw what skipping whole cells draws.
	{
		name: 's1-cells-off',
		deviceTolerance: S1_CELLS_DEVICE_TOLERANCE,
		page: 'bench/pages/null3d/s1-cells.html',
		size: [PARITY_CANVAS.width, PARITY_CANVAS.height],
		hold: HOLD_TIME,
		switches: ['cells=off'],
		reference: 's1-cells',
		timeoutSeconds: 90,
	},
];

/**
/**
 * A copy of a feature test that draws with one more switch, against the references of the test it
 * copies.
 */
function copyWithSwitch(name: string, suffix: string, extra: string): ImageTest {
	const test = FEATURE_TESTS.find((t) => t.name === name);
	if (!test) throw new Error(`the manifest has no ${name} test to draw again with ?${extra}`);
	const { sameOnEveryTier: _, ...rest } = test;
	return {
		...rest,
		name: `${name}-${suffix}`,
		reference: test.reference ?? name,
		switches: [...(test.switches ?? []), extra],
	};
}

/**
 * The scenes that the depth prepass draws again on every tier, which must match their images
 * without it: shadows, masked cards that stay out of the prepass, decals whose depth bias the
 * prepass keeps, see-through objects that draw after it, an orthographic camera whose near plane
 * cuts a slab, S2, and skinned characters with shadows. The depth debug view replaces every
 * material, and a background texture draws after the prepass in its render pass. Custom materials
 * draw their prepass depth with their own vertex shader, a vertex offset that samples a texture
 * among them. The shadows test's ground, which the near plane cuts, caught WebGL2's prepass when it
 * drew with a program of its own (D-43).
 */
const PREPASS_SCENES = [
	'shadows',
	'alpha-mask',
	'depth-bias',
	'transparency',
	'ortho-camera',
	's2',
	'skinning-shadows',
	'debug-view-depth',
	'texture-background',
	'custom-textures',
];

/** A prepass scene's test again with ?prepass=on, in its first thread mode. */
function withPrepass(name: string): ImageTest {
	const test = copyWithSwitch(name, 'prepass', 'prepass=on');
	return {
		...test,
		...(test.modes && { modes: test.modes.slice(0, 1) }),
	};
}

/**
 * The tests that draw again with the scene shaders' color math at half precision, as `?half=on`
 * asks: the standard material over metalness and roughness, its texture maps, clustered point
 * lights, cascaded shadows, and tone mapping in the final pass and in each scene shader on the
 * 8-bit path. Each copy must draw its test's image. WebGPU draws them in 16-bit floats where the
 * device has `shader-f16`, and at full precision elsewhere, as on CI's software GPU. WebGL2 runs
 * that math at `mediump`.
 */
const HALF_PRECISION_TESTS = [
	'standard-grid',
	'standard-maps',
	'lights-16',
	'shadows',
	toneMappingTest('agx', 0),
	eightBitTest('aces'),
];

export const IMAGE_TESTS: readonly ImageTest[] = [
	...FEATURE_TESTS,
	...PREPASS_SCENES.map(withPrepass),
	...HALF_PRECISION_TESTS.map((name) => copyWithSwitch(name, 'half', 'half=on')),
];

/** Every run of the manifest's tests: each test on each of its tiers, in each of its thread modes. */
export const IMAGE_RUNS = imageRuns(IMAGE_TESTS);

/**
 * The page of a feature scene's image test on a tier, in the pipelined mode, with the sketch
 * switches that the scene's parity comparison gives the test's sketch module.
 */
export function featureImagePath({ test, sketchSwitches }: FeatureScene, tier: Tier): string {
	const own = IMAGE_TESTS.find((candidate) => candidate.name === test);
	if (!own) throw new Error(`the manifest has no test ${test}`);
	const drawn =
		sketchSwitches && 'sketch' in own
			? { ...own, sketch: `${own.sketch}${own.sketch.includes('?') ? '&' : '?'}${sketchSwitches}` }
			: own;
	// The page's address depends on the test alone, so a test that shares another test's references
	// runs here without them.
	const { reference: _shared, ...alone } = drawn;
	const run = imageRuns([alone]).find(
		(candidate) => candidate.tier === tier && candidate.mode?.name === 'pipelined',
	);
	if (!run) throw new Error(`the manifest has no pipelined run of ${test} on ${tier}`);
	return run.path;
}

/** The run of a manifest test on a tier, in a thread mode for a page that starts the engine. */
export function manifestRun(test: string, tier: Tier, mode?: EngineModeName): ImageRun {
	const run = IMAGE_RUNS.find(
		(candidate) =>
			candidate.test === test && candidate.tier === tier && candidate.mode?.name === mode,
	);
	if (!run)
		throw new Error(`the manifest has no run of ${test} on ${tier}${mode ? `, ${mode}` : ''}`);
	return run;
}
