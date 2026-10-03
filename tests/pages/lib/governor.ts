// The quality governor's stress test, which the governor page runs, the browser tests judge and the
// runner's governor plan reads back. It has two stages:
//
// - The walk: the sketch spins on its thread for twice the frame budget in every frame, a load that
//   no setting lightens. The governor takes every live step down, one after another. The load then
//   stops, and the governor takes every step back up. The page captures a frame after each step,
//   and measures the frames all along, so a step that lost the frame's image or stopped the frames
//   shows.
// - The hold: a plane in front of the camera runs a heavy loop for each of its pixels, so the GPU's
//   work follows the pixels that the scene draws. With the governor off, the page grows the loop
//   until the GPU falls well behind. With the governor on, the render scale drops until the frames
//   hold their rate again.
//
// This module holds the settings, the steps that the walk expects, and how a result reads. It uses
// no browser or Node API, so the runner and the browser tests import it too.

/** The stages of the stress test, as the page's ?stage= switch names them. */
export type GovernorStage = 'walk' | 'hold';
export const GOVERNOR_STAGES: readonly GovernorStage[] = ['walk', 'hold'];

/** The settings of each stage, and how the page and the checks judge it. */
export const GOVERNOR = {
	/** The canvas's CSS size, drawn at one device pixel per CSS pixel. */
	canvas: [480, 270] as const,
	/** The sun's shadow cascades, so the far cascades' steps apply. */
	cascades: 3,
	/** The shadow settings that the steps start from: a heavier filter and every 4th frame. */
	shadowFilter: 5,
	farCascadeInterval: 4,
	/** The walk's lowest render scale: two steps of 0.05, so the walk stays short. */
	walkMinScale: 0.9,
	/** The hold's lowest render scale, a quarter of the pixels, which lightens most GPU loads. */
	holdMinScale: 0.5,
	/** The walk's load: CPU time per frame on the sketch's thread, in frame budgets. */
	spinBudgets: 2,
	/** How long the walk waits for all the steps down, then for all the steps up, in seconds. */
	walkDownSeconds: 30,
	walkUpSeconds: 60,
	/** The length of each measurement while the walk runs, in seconds. */
	chunkSeconds: 2,
	/**
	 * A presented frame interval longer than this, at the 99th percentile of a measurement, counts
	 * as a stuck frame, in ms. The walk's load spins for two budgets, about 33 ms at 60 hertz.
	 */
	stuckMs: 250,
	/**
	 * The largest difference of a block's mean color between each capture and the first, in levels
	 * of 255 per channel (`compareFrames`). On the Mac, a render scale of 0.5 moves it by about 6
	 * levels and the lighter filter by about 3, while a frame without its shadows differs by over
	 * 100.
	 */
	captureLevels: 20,
	/** How long the walk waits after a step before its capture, for the frames of the new setting, in ms. */
	captureAfterMs: 250,
	/**
	 * The hold's loop count of the first load, which grows by `workGrowth` at each step, up to the
	 * last. A small growth keeps the load that overloads the GPU close to the GPU's limit.
	 */
	firstWork: 64,
	lastWork: 1 << 20,
	workGrowth: Math.SQRT2,
	/** How long each load step of the hold draws before its measurement, and the measurement, in s. */
	settleSeconds: 0.3,
	stepSeconds: 0.5,
	/** The share of the target rate below which a load step counts as too heavy for the GPU. */
	overloadedShare: 0.75,
	/**
	 * How long the hold measures with the governor on, in seconds: the render scale needs about 20
	 * seconds to reach the hold's lowest.
	 */
	holdSeconds: 40,
	/** The seconds at the hold's end that must hold the target. */
	heldSeconds: 15,
	/** A second holds the target at this share of it or more, as the lower of the two rates. */
	heldShare: 0.9,
	/**
	 * The share of the last seconds that must hold the target. A step up that the GPU cannot hold
	 * costs about two seconds before the governor steps back down, and the governor tries one about
	 * 5 seconds after it settles.
	 */
	heldSecondsShare: 0.7,
	/** The highest target rate, as the governor's. */
	maxTargetHz: 60,
} as const;

/** The state that the governor draws with, as the sketch posts it after each step. */
export interface GovernorState {
	/** Seconds since the page asked for the stage's load. */
	at: number;
	renderScale: number;
	steps: number;
	farCascadeInterval: number;
	shadowFilter: number;
}

/** A state as the checks compare it: "scale interval filter". */
export function stateKey(state: Omit<GovernorState, 'at'>): string {
	return `${Number(state.renderScale.toFixed(3))} ${state.farCascadeInterval} ${state.shadowFilter}`;
}

/**
 * The states that the walk passes, from the first to the bottom: the render scale steps down to
 * the walk's lowest, then the far cascades' interval doubles up to every 8th frame, then the filter
 * goes to 3 texels. The steps up pass them again in the reverse order.
 */
export function walkStates(): string[] {
	const { walkMinScale, farCascadeInterval, shadowFilter } = GOVERNOR;
	const states: string[] = [];
	for (let scale = 1; scale >= walkMinScale - 1e-9; scale -= 0.05)
		states.push(stateKey({ renderScale: scale, steps: 0, farCascadeInterval, shadowFilter }));
	for (let interval = farCascadeInterval * 2; interval <= 8; interval *= 2)
		states.push(
			stateKey({
				renderScale: walkMinScale,
				steps: 0,
				farCascadeInterval: interval,
				shadowFilter,
			}),
		);
	states.push(
		stateKey({ renderScale: walkMinScale, steps: 0, farCascadeInterval: 8, shadowFilter: 3 }),
	);
	return states;
}

/** The side of the square blocks of pixels whose mean colors `compareFrames` compares. */
const BLOCK = 16;

/**
 * How far a frame differs from another of the same size, `width` pixels wide, both RGBA rows: the
 * largest difference of a block's mean color, in levels of 255 per channel, and the frame's mean
 * brightness. A lower render scale or a lighter shadow filter softens edges, which barely moves a
 * block's mean. A shadow that a frame lost darkens or lightens whole blocks, and a lost image all
 * of them.
 */
export function compareFrames(
	first: Uint8Array,
	frame: Uint8Array,
	width: number,
): { blockLevels: number; mean: number } {
	const height = frame.length / 4 / width;
	let blockLevels = 0;
	let sum = 0;
	for (let by = 0; by < height; by += BLOCK)
		for (let bx = 0; bx < width; bx += BLOCK) {
			const channels = [0, 0, 0];
			let count = 0;
			for (let y = by; y < Math.min(by + BLOCK, height); y++)
				for (let x = bx; x < Math.min(bx + BLOCK, width); x++, count++)
					for (let c = 0; c < 3; c++) {
						const at = (y * width + x) * 4 + c;
						channels[c] = (channels[c] as number) + (frame[at] as number) - (first[at] as number);
						sum += frame[at] as number;
					}
			for (const channel of channels)
				blockLevels = Math.max(blockLevels, Math.abs(channel) / count);
		}
	return { blockLevels, mean: sum / ((frame.length / 4) * 3) };
}

/** One measurement of the frames while a stage ran. */
export interface GovernorChunk {
	seconds: number;
	presentedFps: number;
	completedFps: number | null;
	/** The presented frame intervals' 99th percentile, in ms. */
	intervalP99Ms: number;
	/** The refresh rate that the governor's budget follows, in hertz, or null before it is measured. */
	refreshHz: number | null;
	/** The median time from a frame's submit until the GPU finished it, in ms, or null for none. */
	gpuDelayMs: number | null;
	pipelines: number;
	skippedDraws: number;
}

/** A frame captured after a step, as the checks read it. */
export interface GovernorCapture {
	state: string;
	/** The largest difference of a block's mean color from the stage's first capture, in levels. */
	blockLevels: number;
	/** The mean brightness, from 0 to 255. */
	mean: number;
}

/** What the governor page reports. */
export type GovernorResult = {
	stage: GovernorStage;
	tier: string;
	/** The display's refresh rate that the engine measured, and the target rate it gives. */
	refreshHz: number | null;
	targetHz: number;
	/** The states after each step, in order, from the stage's start. */
	states: GovernorState[];
	/** The walk's captures after each step. */
	captures: GovernorCapture[];
	/** The measurements while the stage ran. */
	chunks: GovernorChunk[];
	/** The hold's loop count that overloaded the GPU, or null when none did. */
	work: number | null;
	/** The hold: the presented and completed rates of each second with the governor on. */
	perSecond: { presentedFps: number; completedFps: number | null }[];
	/** Error codes that the engine reported. */
	failures: string[];
	/** Where the walk stopped waiting: 'down' or 'up' when the steps never came, or null. */
	timedOut: string | null;
};

/**
 * The governor's target rate in hertz at the display's refresh rate `refreshHz`, or at the lower
 * rate `fps` that the engine's ?fps= switch holds.
 */
export function targetHz(refreshHz: number | null, fps?: number): number {
	return Math.min(refreshHz ?? GOVERNOR.maxTargetHz, GOVERNOR.maxTargetHz, fps ?? Infinity);
}

/** The problems with a stage's frames: stuck frames, pipelines built and draws skipped. */
function frameProblems(chunks: GovernorChunk[]): string[] {
	const problems: string[] = [];
	chunks.forEach((chunk, k) => {
		const at = `measurement ${k + 1}`;
		if (chunk.presentedFps <= 0) problems.push(`${at} presented no frame`);
		if (chunk.intervalP99Ms > GOVERNOR.stuckMs)
			problems.push(
				`${at} had stuck frames: 1% of its frame intervals took over ${chunk.intervalP99Ms.toFixed(0)} ms`,
			);
		if (chunk.pipelines > 0) problems.push(`${at} built ${chunk.pipelines} pipelines`);
		if (chunk.skippedDraws > 0) problems.push(`${at} skipped ${chunk.skippedDraws} draws`);
	});
	return problems;
}

/** The problems with the walk: its steps, its captures and its frames. */
function walkProblems(result: GovernorResult): string[] {
	const problems: string[] = [];
	if (result.timedOut)
		problems.push(`the governor did not take every step ${result.timedOut} in time`);
	const down = walkStates();
	const expected = [...down, ...down.slice(0, -1).reverse()];
	const seen = result.states.map(stateKey);
	if (seen.join(', ') !== expected.join(', '))
		problems.push(`the steps went ${seen.join(', ')}; expected ${expected.join(', ')}`);
	if (result.captures.length !== expected.length)
		problems.push(`${result.captures.length} frames captured; expected ${expected.length}`);
	for (const capture of result.captures) {
		if (capture.blockLevels > GOVERNOR.captureLevels)
			problems.push(
				`the frame at ${capture.state} differs from the first by ${capture.blockLevels.toFixed(1)} levels in a block`,
			);
		if (capture.mean < 8) problems.push(`the frame at ${capture.state} is black`);
	}
	return problems;
}

/** The problems with the hold: no overload, no step down, or a rate that did not come back. */
function holdProblems(result: GovernorResult): string[] {
	if (result.work === null)
		return ['no load overloaded the GPU, so the governor had nothing to do'];
	const problems: string[] = [];
	const lowest = Math.min(...result.states.map((state) => state.renderScale));
	if (!(lowest < 1)) problems.push('the render scale never dropped');
	const last = result.perSecond.slice(-GOVERNOR.heldSeconds);
	const held = last.filter(
		(second) =>
			Math.min(second.presentedFps, second.completedFps ?? 0) >=
			result.targetHz * GOVERNOR.heldShare,
	).length;
	if (last.length === 0 || held < last.length * GOVERNOR.heldSecondsShare)
		problems.push(
			`${held} of the last ${last.length} seconds held ${GOVERNOR.heldShare * 100}% of ${result.targetHz} fps`,
		);
	return problems;
}

/** The problems with a governor page's result, or none when the stage passed. */
export function governorProblems(result: GovernorResult): string[] {
	return [
		...result.failures.map((code) => `the engine reported ${code}`),
		...(result.stage === 'walk' ? walkProblems(result) : holdProblems(result)),
		...frameProblems(result.chunks),
	];
}

/** A one-line summary of a governor page's result, for the runner's report. */
export function governorSummary(result: GovernorResult): string {
	const lowest = Math.min(1, ...result.states.map((state) => state.renderScale));
	const refresh = result.chunks.flatMap((chunk) => (chunk.refreshHz ? [chunk.refreshHz] : []));
	const budget = refresh.length
		? `, refresh ${Math.min(...refresh)} to ${Math.max(...refresh)} Hz`
		: '';
	if (result.stage === 'walk')
		return `${result.states.length} steps, ${result.captures.length} captures, target ${result.targetHz} fps${budget}`;
	const last = result.perSecond.slice(-GOVERNOR.heldSeconds);
	const rates = last.map((second) =>
		Math.round(Math.min(second.presentedFps, second.completedFps ?? 0)),
	);
	return `loop ${result.work}, lowest scale ${lowest}, last seconds ${rates.join(' ')} fps of ${result.targetHz}${budget}`;
}
