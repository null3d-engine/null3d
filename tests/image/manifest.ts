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
import type { EngineModeName } from '../lib/engine-checks.ts';
import { ALL_MODES, type ImageRun, type ImageTest, imageRuns, type Tier } from '../lib/images.ts';

export const IMAGE_TESTS: readonly ImageTest[] = [
	// A clear color, read back through the engine's readback on each GPU interface.
	{ name: 'clear', page: 'tests/pages/clear.html', size: [64, 64], tiers: ['webgpu', 'webgl2'] },
	// Every texture command of the GPU layer, replayed on each path, which must all draw one image.
	{
		name: 'replay-textures',
		page: 'tests/pages/replay-textures.html',
		size: [256, 256],
		sameOnEveryTier: true,
	},
	// A hand-built draw list: GPU culling, then indirect draws from a render bundle with MSAA.
	{
		name: 'replay-instanced',
		page: 'tests/pages/replay.html',
		size: [256, 256],
		tiers: ['webgpu'],
		// 13 red and 12 blue boxes are in view; the 26th box sits behind the camera.
		expect: { visible: [13, 12] },
	},
	// An animated scene held at 1.5 seconds: the same steps and seeded random numbers in every mode.
	{
		name: 'held',
		sketch: 'tests/pages/sketches/animated-sketch.ts',
		hold: 1.5,
		modes: ALL_MODES,
	},
	// A small static scene: lit and unlit meshes, a hierarchy and an instance batch.
	{ name: 'scene', sketch: 'tests/pages/sketches/boxes-sketch.ts', hold: 0, modes: ALL_MODES },
	// The same scene on WebGL2 with each upload copied out of shared memory first.
	{
		name: 'scene-copied-uploads',
		sketch: 'tests/pages/sketches/boxes-sketch.ts',
		hold: 0,
		tiers: ['webgl2'],
		switches: ['uploads=copy'],
		reference: 'scene',
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
