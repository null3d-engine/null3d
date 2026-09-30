// Checks of the capture test page's result, shared by the Playwright tests and the real-browser
// runner.
import { decodePng } from '../../packages/cli/src/png.js';
import { type EngineMode, modeProblems, type ReportedMode } from './engine-checks.ts';

export interface CaptureResult {
	mode: ReportedMode;
	width: number;
	height: number;
	/** The frame that captureFrame read, as RGBA8 rows in base64. */
	pixels: string;
	/** The file that capture gave, in base64. */
	image: string;
	imageType: string;
	/** The error code of a capture after the engine stopped, or what the capture gave instead. */
	afterStop: string;
}

/**
 * What is wrong with a result of the capture page, run in a mode; empty when nothing is. The image
 * that capture gave must be a PNG file of the pixels that captureFrame read. The canvas is opaque,
 * so the image must be too, whatever alpha the GPU wrote.
 */
export function captureProblems(result: CaptureResult, mode: EngineMode): string[] {
	const problems = modeProblems(result.mode, mode);
	if (result.afterStop !== 'E1414')
		problems.push(`a capture after the engine stopped gave ${result.afterStop}, not E1414`);
	if (result.imageType !== 'image/png') return [...problems, `the image is ${result.imageType}`];
	const image = decodePng(Buffer.from(result.image, 'base64'), 'the captured image');
	if (image.width !== result.width || image.height !== result.height)
		return [
			...problems,
			`the image is ${image.width} x ${image.height}, the frame ${result.width} x ${result.height}`,
		];
	const expected = Buffer.from(result.pixels, 'base64');
	for (let i = 3; i < expected.length; i += 4) expected[i] = 255;
	let differing = 0;
	for (let i = 0; i < expected.length; i++) if (image.data[i] !== expected[i]) differing++;
	if (differing > 0)
		problems.push(`${differing} of ${expected.length} bytes of the image differ from the frame`);
	return problems;
}
