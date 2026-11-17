// Release builds drop the code that only development needs: the Vite plugin defines the development
// constant as false in production builds. So the sketch runner keeps no debug drawing code, and
// none of the notes that a development build gives a sketch that relies on input while the page
// started the engine with `input: false`. This builds the runner both ways and compares what each
// build holds.
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
		// Nor the thread's record of the add-ons that checked their version, which only the notes read.
		for (const text of ['@null3d/controls', 'null3d.addonsChecked']) {
			expect(holds(development, text)).toBe(true);
			expect(holds(release, text)).toBe(false);
		}
	});
});
