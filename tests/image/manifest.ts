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
import { ORTHO_IMAGE } from '../../bench/scenes/ortho-camera.ts';
import { HOLD_TIME, PARITY_CANVAS } from '../../bench/scenes/spec.ts';
import { DEMOS } from '../../examples/demos.ts';
import type { DepthMode } from '../../packages/engine/src/page/switches.ts';
import type { EngineModeName } from '../lib/engine-checks.ts';
import { ALL_MODES, type ImageRun, type ImageTest, imageRuns, type Tier } from '../lib/images.ts';
import { PRECISION } from '../pages/lib/depth-precision.ts';

/** The orthographic camera's sketch, and the size of its image. */
const ORTHO = {
	sketch: 'tests/pages/sketches/ortho-camera-sketch.ts',
	size: [ORTHO_IMAGE.width, ORTHO_IMAGE.height] as const,
	hold: 0,
};

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
		tolerance: { threshold: 0, maxDiffRatio: 0 },
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
		tolerance: { threshold: 0, maxDiffRatio: 0 },
	},
	// Objects, a parent and its child, and instance batches on three layers, some of them moved to
	// other layers after they were created, and a camera that draws two of the layers. A child keeps
	// its own layers, so the child of a parent that the camera leaves out still draws.
	{ name: 'layers', sketch: 'tests/pages/sketches/layers-sketch.ts', hold: 0.1 },
	// The main directional light's shadows with 1 to 4 cascades, near the camera and far from it:
	// casters that receive shadows, a receiver that casts none, a caster that receives none, and an
	// unlit box in a shadow. WebGL2 draws no shadows yet.
	...[3, 1, 2, 4].map((cascades) => ({
		name: cascades === 3 ? 'shadows' : `shadows-cascades-${cascades}`,
		sketch: `tests/pages/sketches/shadows-sketch.ts?cascades=${cascades}`,
		hold: 0,
		size: [480, 270] as const,
		tiers: ['webgpu', 'compat'] as const,
	})),
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
		tolerance: { threshold: 0, maxDiffRatio: 0 },
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
	// out each vertex format in its own code, and must draw the WebGPU image.
	{
		name: 'vertex-formats',
		sketch: 'tests/pages/sketches/vertex-formats-sketch.ts',
		hold: 0,
		size: [400, 300],
		modes: ['pipelined', 'single-threaded'],
		sameOnEveryTier: true,
	},
	// The nine geometry generators, each lit and with its texture coordinates shown as colors. Every
	// tier must draw the WebGPU image.
	{
		name: 'generators',
		sketch: 'tests/pages/sketches/generators-sketch.ts',
		hold: 0,
		size: [480, 270],
		sameOnEveryTier: true,
	},
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
