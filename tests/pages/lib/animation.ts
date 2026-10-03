// The animation page's crowd and how its result reads. The page times the engine core's animation
// step: each frame, every character of the crowd blends two clips at times of its own, and the
// job workers sample, blend and compose the poses into skinning matrices. Nothing draws. The
// runner's animation plan reads the result back. This module uses no browser or Node API, so the
// unit tests and the runner import it too. `crowd-rig.ts` gives the same character to the engine's
// animator, for the animator test page and the allocation check.

/** The crowd and the measurement's settings. */
export const ANIMATION = {
	/** Joints per character: S5's characters have 30 to 60. */
	joints: 48,
	/** Chains of joints that leave the root, like a spine, two arms and two legs. */
	limbs: 5,
	/** Each blend's weights: the first clip's, then the second's. */
	weights: [0.6, 0.4] as const,
	/** Frames before the timed frames, and timed frames. */
	warmupFrames: 60,
	frames: 240,
} as const;

/** A track as the core's `createClip` reads it. */
export interface Track {
	joint: number;
	/** 0 translation, 1 rotation, 2 scale (`ANIMATION_TRANSLATION` and so on). */
	channel: number;
	times: number[];
	values: number[];
}

/** A generated character: each joint's parent, rest pose and inverse bind matrix, and two clips. */
export interface Character {
	parents: number[];
	/** Translation, rotation `(x, y, z, w)` and scale of each joint. */
	rest: number[];
	/** A row-major 3 × 4 matrix per joint. */
	inverseBind: number[];
	clips: Track[][];
}

/** The parent value of a root joint. */
export const NO_PARENT = 0xffffffff;

/** A quaternion `(x, y, z, w)` that turns `angle` radians about a unit axis. */
function axisAngle(axis: readonly number[], angle: number): number[] {
	const s = Math.sin(angle / 2);
	return [(axis[0] ?? 0) * s, (axis[1] ?? 0) * s, (axis[2] ?? 0) * s, Math.cos(angle / 2)];
}

const AXES = [
	[1, 0, 0],
	[0, 0, 1],
	[0.6, 0, 0.8],
] as const;

/**
 * A character of `joints` joints, like the core's own test character: a root with chains of
 * joints that stand straight at rest. One clip has keys every thirtieth of a second for a second,
 * the other every 24th for 0.75 s. Both move the root and bend every joint.
 */
export function crowdCharacter(joints: number): Character {
	const parents: number[] = [];
	const rest: number[] = [];
	const inverseBind: number[] = [];
	const height: number[] = [];
	for (let j = 0; j < joints; j++) {
		const parent = j === 0 ? NO_PARENT : j <= ANIMATION.limbs ? 0 : j - ANIMATION.limbs;
		const y = j === 0 ? 1 : 0.15;
		parents.push(parent);
		rest.push(0, y, 0, 0, 0, 0, 1, 1, 1, 1);
		height.push(y + (parent === NO_PARENT ? 0 : (height[parent] ?? 0)));
		inverseBind.push(1, 0, 0, 0, 0, 1, 0, -(height[j] ?? 0), 0, 0, 1, 0);
	}
	const clips = [
		[30, 30, 1.3],
		[24, 18, 2.1],
	].map(([rate = 30, intervals = 30, speed = 1], c) => {
		const times = Array.from({ length: intervals + 1 }, (_, k) => k / rate);
		const tracks: Track[] = [
			{
				joint: 0,
				channel: 0,
				times,
				values: times.flatMap((t) => [
					0.2 * Math.sin(speed * t),
					1 + 0.05 * Math.cos(2 * speed * t),
					t,
				]),
			},
		];
		for (let j = 0; j < joints; j++) {
			const phase = j * 0.37 + c;
			const axis = AXES[j % 3] ?? AXES[0];
			tracks.push({
				joint: j,
				channel: 1,
				times,
				values: times.flatMap((t) => axisAngle(axis, 0.6 * Math.sin(speed * 6 * t + phase))),
			});
		}
		return tracks;
	});
	return { parents, rest, inverseBind, clips };
}

/** Milliseconds of the frame step: the median, the 90th percentile and the mean. */
export interface StepTimes {
	medianMs: number;
	p90Ms: number;
	meanMs: number;
}

/** What the animation page reports. */
export interface AnimationResult {
	characters: number;
	joints: number;
	jobWorkers: number;
	/** The frames timed. */
	frames: number;
	/** The frame step on the page's thread, which also runs chunks and waits for the job workers. */
	step: StepTimes;
	/** The job workers' busy time per frame, added up over the workers, in milliseconds. */
	jobMsPerFrame: number;
	/** True when every skinning matrix holds finite numbers. */
	finite: boolean;
	/** True when two characters at different times got different matrices. */
	moved: boolean;
}

/** The median, 90th percentile and mean of frame step times in milliseconds. */
export function stepTimes(times: readonly number[]): StepTimes {
	const sorted = [...times].sort((a, b) => a - b);
	const at = (share: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
	const sum = times.reduce((total, t) => total + t, 0);
	return { medianMs: at(0.5), p90Ms: at(0.9), meanMs: times.length ? sum / times.length : 0 };
}

/** What is wrong with an animation page's result, in words; empty when it is sound. */
export function animationProblems(result: AnimationResult): string[] {
	const problems: string[] = [];
	if (!(result.frames > 0)) problems.push('no frame step was timed');
	if (!result.finite) problems.push('a skinning matrix holds a number that is not finite');
	if (!result.moved) problems.push('the characters all got the same pose');
	return problems;
}
