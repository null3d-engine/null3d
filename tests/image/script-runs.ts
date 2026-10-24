// The images of the command-line tool's timed script test: one for each state that a script drives
// the input demo through. The spec (cli-script.spec.ts) runs `bunx @null3d/cli shot --script` in the
// repository, and compares each image with its reference here. The runs are not in the manifest,
// which the image page draws: a script's images come from the command itself.
import { DEVICE_TOLERANCE, type ImageRun, TOLERANCE } from '../lib/images.ts';

/** The test's name, which names each image after the state it shows. */
export const SCRIPT_TEST = 'script-demo-input';

/** The states that the input demo's script draws, in time order. */
export const SCRIPT_STATES = ['start', 'walking', 'jumping'] as const;

/** The tier that the script test draws and keeps references on. */
export const SCRIPT_TIER = 'webgl2';

/** The page that draws the demo, at the preset that the references use. */
const DEMO_PAGE =
	'/tests/pages/image.html?sketch=/examples/input/sketch.ts&size=640x360&preset=high';

/** The sketch time of each state, in seconds. */
const DEMO_HOLD: Readonly<Record<(typeof SCRIPT_STATES)[number], number>> = {
	start: 0,
	walking: 1.2,
	jumping: 2,
};

/** The states' runs, each with the reference that its image must match. */
export const SCRIPT_RUNS: ImageRun[] = SCRIPT_STATES.map((state) => ({
	id: `${SCRIPT_TEST}-${state}-${SCRIPT_TIER}`,
	test: `${SCRIPT_TEST}-${state}`,
	tier: SCRIPT_TIER,
	path: DEMO_PAGE,
	scene: 'examples/input/sketch.ts',
	hold: DEMO_HOLD[state],
	timeoutSeconds: 180,
	size: [640, 360],
	expect: {},
	reference: { test: `${SCRIPT_TEST}-${state}`, tier: SCRIPT_TIER, devices: [] },
	// The command-line tool draws these, in its own spec rather than the image page.
	make: `{ci}node packages/cli/bin/null3d.js shot --script tests/image/demo-input.script --page '${DEMO_PAGE}' --size 640x360 --gpu webgl2 --out target/demo-input.png, then bun run images:review --accept ${SCRIPT_TEST}-${state}`,
	tolerance: TOLERANCE,
	deviceTolerance: DEVICE_TOLERANCE,
}));
