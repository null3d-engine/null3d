// The trap page's settings and how its result reads: a page on a software renderer whose first
// step below the whole render scale makes every frame slower. The governor must take that step
// once, find that it did not pay, and return to the whole scale. It must not step below it again,
// since the device draws on the CPU, where the two-step upscale costs about what the smaller scene
// saves (D-237). The page chooses a canvas size that puts the whole scale's frames over the target
// rate and well under half a second, so the step down is judged at once and the frames after it
// are held frames.
//
// This module uses no browser or Node API, so the page and the browser test import it too.

/** The settings of the trap page and how the browser test judges it. */
export const TRAP = {
	/** The lowest render scale, one step of 0.05 below the whole canvas. */
	minScale: 0.95,
	/** The canvas's CSS size of the first try, in pixels, which the page tunes toward a slow rate. */
	first: [320, 180] as const,
	/** The sides that the page tunes the canvas between, in pixels. */
	smallestSide: 160,
	largestSide: 2560,
	/**
	 * The band of a whole-scale frame time that the page tunes into, in ms: well over the target
	 * rate's, and high enough that the two-step upscale's frames can pass half a second.
	 */
	quickestMs: 280,
	slowestMs: 460,
	/** How long a size settles after a resize, and then draws before the page reads its rate, in s. */
	settleSeconds: 0.6,
	measureSeconds: 1.2,
	/** How long the page waits for the step down, and then for the return to the whole scale, in s. */
	stepSeconds: 30,
	returnSeconds: 30,
	/**
	 * How long the page watches the whole scale after the return, for a further step, in s. The
	 * level's wait is shorter than this, so a device that does not keep the whole scale would step
	 * again in the watch.
	 */
	watchSeconds: 16,
	/** The highest target rate that the governor aims for, in hertz, as the engine's. */
	maxTargetHz: 60,
	/**
	 * The engine's gap between frames, in ms (`GAP_MS` in `quality/governor.ts`), which tells a held
	 * frame from a pause. The page uses it to judge how quickly the step came back.
	 */
	gapMs: 500,
	/**
	 * The most frames between the step and its return, when a held frame decided the trial. The
	 * held frame is judged at the frame after it, and a frame or two more cover a completion record
	 * that lands late. A slow software renderer draws few frames a second, so its record arrives a
	 * frame later than this Mac's does: CI measured four, against the two or three recorded here.
	 * A trial that only its 4 s bound ended still takes several frames more than this.
	 */
	mostHeldFramesBetween: 5,
	/** The most frames between the step and its return, when a judged second did. */
	mostJudgedFramesBetween: 8,
	/** The most scale changes the page allows after the return. */
	mostLaterSteps: 0,
} as const;

/** One change of the render scale, as the sketch posts it. */
export interface TrapState {
	/** Seconds since the page turned the governor on. */
	at: number;
	renderScale: number;
	/** The sketch's own count of its frames when the change reached it. */
	frame: number;
}

/** What the trap page reports. */
export type TrapResult = {
	tier: string;
	/** The canvas's device-pixel size that the page tuned to. */
	canvas: { width: number; height: number };
	/** The whole scale's frames, as the page measured them before it turned the governor on. */
	wholeFps: number;
	wholeFrameMs: number;
	/** The target rate the governor defends, in hertz. */
	targetHz: number;
	/** The render scale changes after the governor came on. */
	states: TrapState[];
	/** The first step down and the return to the whole scale, in seconds, or null when one did not come. */
	steppedAt: number | null;
	returnedAt: number | null;
	/** The scale changes after the return. */
	laterSteps: number;
	/** Error codes that the engine reported. */
	failures: string[];
};

/** The problems with a trap page's result, or none when it passed. */
export function trapProblems(result: TrapResult): string[] {
	const problems: string[] = result.failures.map((code) => `the engine reported ${code}`);
	const { minScale } = TRAP;
	if (result.states.length === 0) problems.push('the governor took no step');
	if (result.steppedAt === null)
		problems.push(`no step below the whole scale came within ${TRAP.stepSeconds} s`);
	if (result.returnedAt === null)
		problems.push(`no return to the whole scale came within ${TRAP.returnSeconds} s`);
	const step = result.states.find((state) => state.renderScale === minScale);
	const returned = result.states.slice(result.states.indexOf(step as TrapState) + 1);
	if (step && returned.length === 0) problems.push('the scale went down and never came back');
	// The step down must be the one that the trial takes back, and the scale must not go below it.
	const lowest = Math.min(...result.states.map((state) => state.renderScale));
	if (lowest < minScale) problems.push(`the scale fell to ${lowest} below the one allowed step`);
	if (result.laterSteps > TRAP.mostLaterSteps)
		problems.push(`the scale changed ${result.laterSteps} times after the return`);
	// A step back by a held frame comes at the first frame after the step, which the frame count
	// shows: a slow frame filled the windows, and nothing else could have judged it. A trial that a
	// judged second ended takes the second that its windows fill.
	const between =
		step && returned.length > 0 ? (returned[0] as TrapState).frame - (step as TrapState).frame : 0;
	const delayMs = step && returned.length > 0 ? (returned[0] as TrapState).at - step.at : 0;
	const allowed =
		delayMs * 1000 >= TRAP.gapMs ? TRAP.mostHeldFramesBetween : TRAP.mostJudgedFramesBetween;
	if (between > allowed) problems.push(`${between} frames came between the step and its return`);
	return problems;
}

/** A one-line summary of a trap page's result, for the browser test's report. */
export function trapSummary(result: TrapResult): string {
	const times = (value: number | null) => (value === null ? 'none' : `${value.toFixed(2)} s`);
	const delay =
		result.steppedAt !== null && result.returnedAt !== null
			? `${((result.returnedAt - result.steppedAt) * 1000).toFixed(0)} ms`
			: 'none';
	return `${result.canvas.width}x${result.canvas.height}, ${result.wholeFps.toFixed(1)} fps at the whole scale, step ${times(result.steppedAt)}, return ${times(result.returnedAt)} after ${delay}, ${result.states.length} changes, ${result.laterSteps} later`;
}
