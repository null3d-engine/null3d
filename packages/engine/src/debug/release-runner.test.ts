// Release builds drop the code that only development needs: the Vite plugin defines the development
// constant as false in production builds. So the sketch runner keeps no debug drawing code, and
// none of the notes that a development build gives a sketch that relies on input while the page
// started the engine with `input: false`, nor the hearing of add-ons that those notes need. This
// builds the runner and a page's engine both ways and compares what each build holds.
import { beforeAll, describe, expect, it } from 'bun:test';
import { type Built, bundleOne, holds, sizeOf } from '../../../../tests/lib/release-build.ts';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { INPUT_OFF_NOTES } from '../sketch/input-off';

/** Text that only the debug drawing code holds: the warning past a frame's limit of lines. */
const DRAWING_CODE = 'debug lines. This frame left out';

describe('the release build of the sketch runner', () => {
	let release: Built;
	let development: Built;
	beforeAll(async () => {
		release = await bundleOne('sketch/runner.ts', 'production');
		development = await bundleOne('sketch/runner.ts', 'development');
		console.log(
			`sketch runner, minified: ${sizeOf(development)} bytes for development, ${sizeOf(release)} for production`,
		);
	}, scaledBudget(120_000));

	it('holds none of the debug drawing code', () => {
		expect(holds(development, DRAWING_CODE)).toBe(true);
		expect(holds(release, DRAWING_CODE)).toBe(false);
	});

	it('holds none of the notes of input that the page does not write', () => {
		for (const note of Object.values(INPUT_OFF_NOTES)) {
			expect(holds(development, note)).toBe(true);
			expect(holds(release, note)).toBe(false);
		}
		// Nor the name of the controls, which only the notes read.
		expect(holds(development, '@null3d/controls')).toBe(true);
		expect(holds(release, '@null3d/controls')).toBe(false);
		// The runner imports no hearing of the add-ons: the code that builds it hands it one.
		for (const build of [development, release])
			expect(holds(build, 'null3d.addonsChecked')).toBe(false);
	});
});

// A page's build splits the engine into files, and code that two of them import stays in a release
// build even where only development code calls it. The page and its sketch worker hear the add-ons
// for the runner, and a release build of the engine holds none of that hearing.
describe('the release build of a page', () => {
	let release: Built;
	let development: Built;
	beforeAll(async () => {
		release = await bundleOne('index.ts', 'production');
		development = await bundleOne('index.ts', 'development');
	}, scaledBudget(240_000));

	it("holds none of the thread's record of the add-ons that checked their version", () => {
		expect(holds(development, 'null3d.addonsChecked')).toBe(true);
		expect(holds(release, 'null3d.addonsChecked')).toBe(false);
	});
});
