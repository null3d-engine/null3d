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
import { BENCH_SCENES } from '../../bench/lib/parity.ts';
import { MASK_IMAGE } from '../../bench/scenes/alpha-mask.ts';
import { FOG_IMAGE } from '../../bench/scenes/fog.ts';
import { MAPS_IMAGE } from '../../bench/scenes/material-maps.ts';
import { ORTHO_IMAGE } from '../../bench/scenes/ortho-camera.ts';
import { HOLD_TIME, PARITY_CANVAS } from '../../bench/scenes/spec.ts';
import { BACKGROUND_IMAGE } from '../../bench/scenes/texture-background.ts';
import { GLASS_IMAGE } from '../../bench/scenes/transparency.ts';
import { DEMOS } from '../../examples/demos.ts';
import type { DepthMode } from '../../packages/engine/src/page/switches.ts';
import type { EngineModeName } from '../lib/engine-checks.ts';
import { ALL_MODES, type ImageRun, type ImageTest, imageRuns, type Tier } from '../lib/images.ts';
import { STOPS, TONE_MAPPINGS } from '../pages/lib/bright-scene.ts';
import { PRECISION } from '../pages/lib/depth-precision.ts';

/**
 * The tolerance of a scene drawn about 1,000 km out against its image at the origin: any change of
 * color counts, and a few pixels may change. The final pass dithers after the tone mapping, so a
 * rounding difference of the GPU below the last bit can still move a pixel by one step, as CI's
 * software GPU did in one pixel of a whole image. A world matrix relative to the origin, instead of
 * to its cell, changes many times more.
 */
const FAR_OUT_TOLERANCE = { threshold: 0, maxDiffRatio: 0.00005 };

/** The sketch of the tone mapping tests: tiles whose linear colors run from about 0.2 to 16. */
export const BRIGHT_SKETCH = 'tests/pages/sketches/bright-sketch.ts';

/** The name of the tone mapping test of a tone mapping at an exposure in stops. */
export const toneMappingTest = (tone: string, stops: number) =>
	`tone-${tone}${stops === 0 ? '' : '-half-exposure'}`;

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

export const IMAGE_TESTS: readonly ImageTest[] = [
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
	...toneMappingTests(),
	...antialiasTests(),
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
		tolerance: { threshold: 0, maxDiffRatio: 0.0003 },
	},
	{
		name: 'cells-1000km',
		sketch: `tests/pages/sketches/cells-sketch.ts?x=${977 * 1024}`,
		hold: 1,
		reference: 'cells',
		tolerance: FAR_OUT_TOLERANCE,
	},
	// Debug drawing: every shape of ctx.debug over a small scene, the axes of a spinning box and the
	// frustum of a second camera. The single-threaded mode runs the sketch on the page, which draws
	// the same lines.
	{
		name: 'debug',
		sketch: 'tests/pages/sketches/debug-sketch.ts',
		hold: 1,
		size: [400, 225],
		modes: ['pipelined', 'single-threaded'],
		tolerance: { threshold: 0, maxDiffRatio: 0 },
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
		tolerance: FAR_OUT_TOLERANCE,
	},
	// Objects, a parent and its child, and instance batches on three layers, some of them moved to
	// other layers after they were created, and a camera that draws two of the layers. A child keeps
	// its own layers, so the child of a parent that the camera leaves out still draws.
	{ name: 'layers', sketch: 'tests/pages/sketches/layers-sketch.ts', hold: 0.1 },
	// The main directional light's shadows with 1 to 4 cascades, near the camera and far from it:
	// casters that receive shadows, a receiver that casts none, a caster that receives none, and an
	// unlit box in a shadow. Both GPU paths draw the same shadows, so every tier must draw the
	// WebGPU image. WebGL2 takes the 8-bit path, which averages antialiased edges after the tone
	// mapping, so about 0.16% of the pixels differ, all at edges, on the Mac and with SwiftShader.
	// A shadow drawn wrong changes several percent.
	...[3, 1, 2, 4].map((cascades) => ({
		name: cascades === 3 ? 'shadows' : `shadows-cascades-${cascades}`,
		sketch: `tests/pages/sketches/shadows-sketch.ts?cascades=${cascades}`,
		hold: 0,
		size: [480, 270] as const,
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
	})),
	// The same scene with custom materials on the ground and the red boxes, whose surface function
	// keeps the standard look: they cast and receive shadows as the standard material does, so the
	// references are copies of the shadows test's, with its tolerance for WebGL2's edges.
	{
		name: 'shadows-custom',
		sketch: 'tests/pages/sketches/shadows-sketch.ts?custom',
		hold: 0,
		size: [480, 270],
		sameOnEveryTier: true,
		tolerance: { maxDiffRatio: 0.005 },
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
		size: [480, 270],
	},
	{
		name: 'standard-features',
		sketch: 'tests/pages/sketches/standard-sketch.ts?scene=features',
		hold: 0,
		size: [480, 270],
	},
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
	// The README's dissolve: a surface function with uniforms and the mask alpha mode, at four
	// stages of its progress.
	{
		name: 'custom-dissolve',
		sketch: 'tests/pages/sketches/custom-dissolve-sketch.ts',
		hold: 0,
		size: [480, 270],
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

/** Every run of the manifest's tests: each test on each of its tiers, in each of its thread modes. */
export const IMAGE_RUNS = imageRuns(IMAGE_TESTS);

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
