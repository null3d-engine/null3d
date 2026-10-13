// Checks of the first-draw page's result, shared by the Playwright test and the real-browser runner.
// The page draws a pass of indexed indirect draws, whose arguments the CPU wrote, as the first pass
// that draws on a new device: once as it is, and once after the pass that the engine draws before
// its first frame. Some drivers draw nothing in the first such pass on a device. The engine's pass
// must make the draws right; the bare draw only tells whether the device has the fault.

/** One draw of the page: the points it should write, and those it wrote and wrote right. */
export interface FirstDrawOutcome {
	expected: number;
	drawn: number;
	right: number;
}

export interface FirstDrawResult {
	tier?: string;
	/** The draws as the first pass that draws on a new device. */
	bare: FirstDrawOutcome;
	/** The same on another new device, after the engine's first pass. */
	afterFirstPass: FirstDrawOutcome;
	errors: string[];
}

const counted = ({ expected, drawn, right }: FirstDrawOutcome) =>
	`${right} of ${expected} points right, ${drawn} drawn`;

/** What went wrong after the engine's first pass, or nothing when every point came out right. */
export function firstDrawProblems(result: FirstDrawResult): string[] {
	const { afterFirstPass } = result;
	return [
		...result.errors.map((error) => `WebGPU error: ${error}`),
		...(afterFirstPass.right === afterFirstPass.expected
			? []
			: [
					`after the engine's first pass, the first indirect draws wrote ${counted(afterFirstPass)}`,
				]),
	];
}

/** Whether the device has the fault, for the run's notes. */
export function firstDrawNote({ bare }: FirstDrawResult): string {
	return bare.right === bare.expected
		? 'the first indirect draws on a new device came out right without the first pass'
		: `the device has the first-pass fault: without the engine's first pass, the first indirect draws on a new device wrote ${counted(bare)}`;
}
