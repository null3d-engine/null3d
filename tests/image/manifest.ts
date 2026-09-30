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
import { PARITY_SCENES } from '../../bench/lib/parity.ts';
import { HOLD_TIME, PARITY_CANVAS } from '../../bench/scenes/spec.ts';
import type { DepthMode } from '../../packages/engine/src/page/switches.ts';
import type { EngineModeName } from '../lib/engine-checks.ts';
import { ALL_MODES, type ImageRun, type ImageTest, imageRuns, type Tier } from '../lib/images.ts';
import { STOPS, TONE_MAPPINGS } from '../pages/lib/bright-scene.ts';
import { PRECISION } from '../pages/lib/depth-precision.ts';

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

/** The page of the depth precision tests, and its image's size. */
const DEPTH_PAGE = { page: 'tests/pages/depth-precision.html', size: PRECISION.size, hold: 0 };

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
	// The bright scene without a background on a transparent canvas, which keeps premultiplied
	// alpha: the output spec checks the alpha of the captured pixels.
	{
		name: 'transparent',
		sketch: `${BRIGHT_SKETCH}?background=none`,
		hold: 0,
		switches: ['transparent'],
	},
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
		tolerance: { threshold: 0, maxDiffRatio: 0 },
	},
	// Objects, a parent and its child, and instance batches on three layers, some of them moved to
	// other layers after they were created, and a camera that draws two of the layers. A child keeps
	// its own layers, so the child of a parent that the camera leaves out still draws.
	{ name: 'layers', sketch: 'tests/pages/sketches/layers-sketch.ts', hold: 0.1 },
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
	// The benchmark scenes' hold frames, which the parity command also compares with three.js.
	// S2's trees cover under 1% of its frame, so other devices may differ in fewer of its pixels.
	...PARITY_SCENES.map(
		(scene): ImageTest => ({
			name: scene,
			page: `bench/pages/null3d/${scene}.html`,
			size: [PARITY_CANVAS.width, PARITY_CANVAS.height],
			hold: HOLD_TIME,
			modes: ['pipelined', 'low latency'],
			timeoutSeconds: 90,
			...(scene === 's2' && { deviceTolerance: { maxDiffRatio: 0.002 } }),
		}),
	),
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
