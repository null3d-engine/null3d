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
 * The share of an image's bytes that Brave's Shields may change. To defeat fingerprinting, Shields
 * move a few color bytes of each image that a canvas encodes by one step, the same bytes in every
 * load of a site, and far fewer than this share.
 */
const SHIELDS_SHARE = 0.01;

/**
 * What is wrong with a result of the capture page, run in a mode; empty when nothing is. The image
 * that capture gave must be a PNG file of the pixels that captureFrame read. The canvas is opaque,
 * so the image must be too, whatever alpha the GPU wrote. In Brave, unless the run recorded its
 * Shields off, the image may also hold the changes that Shields make to a canvas's images: bytes
 * one step off, in at most a hundredth of the image.
 */
export function captureProblems(
	result: CaptureResult,
	mode: EngineMode,
	braveShields?: 'on' | 'off' | null,
): string[] {
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
	let oneStep = 0;
	for (let i = 0; i < expected.length; i++) {
		const step = Math.abs((image.data[i] as number) - (expected[i] as number));
		if (step > 0) differing++;
		if (step === 1) oneStep++;
	}
	if (differing === 0) return problems;
	const shields = braveShields !== undefined && braveShields !== 'off';
	if (shields && oneStep === differing && differing <= expected.length * SHIELDS_SHARE)
		return problems;
	problems.push(
		`${differing} of ${expected.length} bytes of the image differ from the frame${shields ? ", more than Brave's Shields change" : ''}`,
	);
	return problems;
}
