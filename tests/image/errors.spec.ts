// Engine errors keep their code and their full message wherever they are raised: a start that fails
// in the thread that runs the sketch, and calls of the scene API inside a running sketch. Each
// thread mode runs the sketch in another thread, and the engine starts again after the errors.
import { expect, test } from '@playwright/test';
import { ERROR_FIXES, type ErrorCode } from '../../packages/engine/src/errors/fixes.ts';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

const DOCS = 'https://github.com/null3d-engine/null3d/blob/main/docs/errors/';

interface Raised {
	code: string;
	message: string;
	name: string;
}

interface ErrorsResult {
	error?: string;
	mode: { build: string; latency: string };
	notASketch: string;
	failedStarts: (Raised & { engineError: boolean })[];
	inSketch: Raised[];
	framesAfterRestart: number;
}

/** An engine error as the engine raises it: the code, the detail, the code's fix and its page. */
const engineError = (code: ErrorCode, detail: string): Raised => ({
	code,
	message: `${code}: ${detail} ${ERROR_FIXES[code]} See ${DOCS}${code}.md`,
	name: 'EngineError',
});

const BAD_COLOR = engineError('E1204', 'setBackground() got the color "blue-ish".');

for (const mode of ENGINE_MODES) {
	test(`errors keep their code and full message, and the engine starts again, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`errors.html?gpu=webgpu&${mode.query}`);
		const result = await pageResult<ErrorsResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.mode).toMatchObject({ build: mode.build, latency: mode.latency });
		expect(result.failedStarts).toEqual([
			{
				...engineError('E1401', `${result.notASketch} must export default defineSketch(...).`),
				engineError: true,
			},
			{ ...BAD_COLOR, engineError: true },
		]);
		expect(result.inSketch).toEqual([
			BAD_COLOR,
			engineError('E1108', 'setActiveCount() got 11, above the limit of 10.'),
		]);
		expect(result.framesAfterRestart).toBeGreaterThan(0);
	});
}
