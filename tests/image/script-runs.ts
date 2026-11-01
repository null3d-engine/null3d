// The images of the command-line tool's timed script test: one for each state that a script drives
// the night town showcase through. The spec (cli-script.spec.ts) runs `bunx @null3d/cli shot
// --script` in the repository, and compares each image with its reference here. The runs are not in
// the manifest, which the image page draws: a script's images come from the command itself.
import {
	DEVICE_TOLERANCE,
	type Environment,
	type ImageRun,
	runIn,
	TOLERANCE,
} from '../lib/images.ts';

/** The test's name, which names each image after the state it shows. */
export const SCRIPT_TEST = 'script-demo-night-town';

/** The states that the showcase's script draws, in time order. */
export const SCRIPT_STATES = ['turned', 'walked', 'closer'] as const;

/** The tier that the script test draws and keeps references on. */
export const SCRIPT_TIER = 'webgl2';

/** The image size that the states draw at. */
export const SCRIPT_SIZE = [320, 180] as const;

/** The page that draws the showcase, at the preset that the real GPU's references use. */
const SHOWCASE_PAGE =
	'/tests/pages/image.html?sketch=/examples/showcase/night-town/sketch.ts&size=320x180&preset=high';

/** The sketch time of each state, in seconds. */
const SHOWCASE_HOLD: Readonly<Record<(typeof SCRIPT_STATES)[number], number>> = {
	turned: 2,
	walked: 3.5,
	closer: 5,
};

/** The states' runs, each with the reference that its image must match. */
export const SCRIPT_RUNS: ImageRun[] = SCRIPT_STATES.map((state) => ({
	id: `${SCRIPT_TEST}-${state}-${SCRIPT_TIER}`,
	test: `${SCRIPT_TEST}-${state}`,
	tier: SCRIPT_TIER,
	path: SHOWCASE_PAGE,
	scene: 'examples/showcase/night-town/sketch.ts',
	hold: SHOWCASE_HOLD[state],
	timeoutSeconds: 180,
	size: SCRIPT_SIZE,
	expect: {},
	reference: { test: `${SCRIPT_TEST}-${state}`, tier: SCRIPT_TIER, devices: [] },
	// The software GPU draws every showcase at its Low preset, as the image manifest does, which
	// keeps its run short.
	swiftShaderSwitches: ['preset=low'],
	// The command-line tool draws these, in its own spec rather than the image page. That spec saves
	// a picture without a reference as a candidate, which `images:review` then accepts.
	make: `{ci}NULL3D_PRODUCTION_PAGES=skip bun run test:browser image/cli-script.spec.ts, which saves the new picture as a candidate, then bun run images:review --accept ${SCRIPT_TEST}-${state}`,
	tolerance: TOLERANCE,
	deviceTolerance: DEVICE_TOLERANCE,
}));

/** The page that draws the showcase in `environment`, at the preset that its references use. */
export const scriptPage = (environment: Environment): string =>
	runIn(SCRIPT_RUNS[0] as ImageRun, environment).path;
