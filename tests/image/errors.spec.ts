// Engine errors keep their code and their full message wherever they are raised: a start that fails
// in the thread that runs the sketch, and calls of the scene API inside a running sketch. Each
// thread mode runs the sketch in another thread, and the engine starts again after the errors. The
// test runs on the production build too, where the sketch worker holds two copies of the engine's
// error code: `instanceof EngineError` and the fix in each message must hold for both.
import { expect, test } from '@playwright/test';
import { ERROR_FIXES, type ErrorCode } from '../../packages/engine/src/errors/fixes.ts';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

const DOCS = 'https://github.com/null3d-engine/null3d/blob/main/docs/errors/';

interface Raised {
	code: string;
	message: string;
	name: string;
	/** True when the code that caught the error saw it as an EngineError. */
	engineError: boolean;
}

interface ErrorsResult {
	error?: string;
	mode: { build: string; latency: string };
	notASketch: string;
	missingSketch: string;
	failedStarts: Raised[];
	inSketch: Raised[];
	framesAfterRestart: number;
}

/** An engine error as the engine raises it: the code, the detail, the code's fix and its page. */
const engineError = (code: ErrorCode, detail: string): Raised => ({
	code,
	message: `${code}: ${detail} ${ERROR_FIXES[code]} See ${DOCS}${code}.md`,
	name: 'EngineError',
	engineError: true,
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
		expect(result.failedStarts).toHaveLength(4);
		expect(result.failedStarts.slice(0, 3)).toEqual([
			engineError('E1401', `${result.notASketch} must export default defineSketch(...).`),
			BAD_COLOR,
			engineError(
				'E1409',
				'the memory.maximumMiB option 8192 is not a whole number of MiB from 256 to 4096.',
			),
		]);
		// The browser words the reason, so the test checks what the engine adds around it.
		const notLoaded = result.failedStarts[3] as Raised;
		expect(notLoaded).toMatchObject({ code: 'E1410', name: 'EngineError', engineError: true });
		const prefix = `E1410: the sketch module ${result.missingSketch} did not load: `;
		const suffix = `. ${ERROR_FIXES.E1410} See ${DOCS}E1410.md`;
		const { message } = notLoaded;
		expect(message.startsWith(prefix) && message.endsWith(suffix), message).toBe(true);
		expect(result.inSketch).toEqual([
			BAD_COLOR,
			engineError('E1108', 'setActiveCount() got 11, above the limit of 10.'),
			engineError(
				'E1206',
				'geometry.fromArrays() got the index 3 at indices[2], past the last of 3 vertices.',
			),
			engineError('E1206', 'geometry.fromArrays() got NaN at uvs[4].'),
			engineError('E1108', 'the sketch asked for row 11 of 10.'),
		]);
		expect(result.framesAfterRestart).toBeGreaterThan(0);
	});
}
