// Release builds drop the debug drawing: the Vite plugin defines the development constant as false
// in production builds, so the sketch runner keeps no debug drawing code. This builds the runner
// both ways and compares what each build holds.
import { describe, expect, it } from 'bun:test';
import { bundleOne, holds, sizeOf } from '../../../../tests/lib/release-build.ts';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';

/** Text that only the debug drawing code holds: the warning past a frame's limit of lines. */
const DRAWING_CODE = 'debug lines. This frame left out';

describe('the release build of the sketch runner', () => {
	it(
		'holds none of the debug drawing code',
		async () => {
			const release = await bundleOne('sketch/runner.ts', 'production');
			const development = await bundleOne('sketch/runner.ts', 'development');
			expect(holds(development, DRAWING_CODE)).toBe(true);
			expect(holds(release, DRAWING_CODE)).toBe(false);
			console.log(
				`sketch runner, minified: ${sizeOf(development)} bytes with debug drawing, ${sizeOf(release)} without`,
			);
		},
		scaledBudget(120_000),
	);
});
