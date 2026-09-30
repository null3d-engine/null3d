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
import { STOPS, TONE_MAPPINGS } from '../pages/lib/bright-scene.ts';

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
	...toneMappingTests(),
	// The bright scene without a background on a transparent canvas, which keeps premultiplied
	// alpha: the output spec checks the alpha of the captured pixels.
	{
		name: 'transparent',
		sketch: `${BRIGHT_SKETCH}?background=none`,
		hold: 0,
		switches: ['transparent'],
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
