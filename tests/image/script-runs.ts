// The images of the command-line tool's timed script test: one for each state that the script
// drives the fixture project through. The spec (cli-script.spec.ts) runs `bunx @null3d/cli shot
// --script` in a copy of the project, and compares each image with its reference here. The runs are
// not in the manifest, which the image page draws: a script's images come from the command itself.
import { DEVICE_TOLERANCE, type ImageRun, TOLERANCE } from '../lib/images.ts';

/** The test's name, which names each image after the state it shows. */
export const SCRIPT_TEST = 'project-script';

/** The states that the project's script draws, in time order. */
export const SCRIPT_STATES = ['start', 'forward', 'parked'] as const;

/** The tier that the script test draws and keeps references on. */
export const SCRIPT_TIER = 'webgl2';

/** The states' runs, each with the reference that its image must match. */
export const SCRIPT_RUNS: ImageRun[] = SCRIPT_STATES.map((state) => ({
	id: `${SCRIPT_TEST}-${state}-${SCRIPT_TIER}`,
	test: `${SCRIPT_TEST}-${state}`,
	tier: SCRIPT_TIER,
	path: '/',
	scene: 'tests/fixtures/project/sketch.ts',
	timeoutSeconds: 180,
	size: [320, 180],
	expect: {},
	reference: { test: `${SCRIPT_TEST}-${state}`, tier: SCRIPT_TIER, devices: [] },
	// The command-line tool draws these, in its own spec rather than the image page.
	make: `{ci}bun run test:browser image/cli-script.spec.ts -g "project-script-${state} on ${SCRIPT_TIER}", then bun run images:review --accept project-script-${state}`,
	tolerance: TOLERANCE,
	deviceTolerance: DEVICE_TOLERANCE,
}));
