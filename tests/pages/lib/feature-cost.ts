// What a feature costs on this device: a page's engine plays a scene with the feature off and on in
// turns, and the page measures each side over the same seconds, so heat slows both sides alike.
// The effect and environment cost pages share it.
import type { Engine } from '@null3d/engine';

/** Seconds of play before the first measurement. */
const WARM_UP_SECONDS = 2;
/** Seconds of each measurement, and how many each side gets. */
const SECONDS = 2;
const ROUNDS = 3;

/** The medians of one part of a frame's GPU time, as the device reports it. */
export interface PassCost {
	name: string;
	ms: number | null;
}

/** The medians of one side's measurements: GPU time where the device has a timer, frame interval and CPU time. */
export interface SideCost {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
	/** The display's refresh rate in hertz, where the device measured one. */
	refreshHz: number | null;
	/** Draw calls per frame in the middle of the side's measurements. */
	draws: number | null;
	/** Each part of the frame's GPU time, in the order that the device reported it. */
	passes: PassCost[];
	/** The median busy time per frame of each thread, by name. */
	threads: Record<string, number | null>;
	/** Each round's GPU time, in the order the rounds ran; empty without a timer. */
	gpuRoundsMs: number[];
	/** Each round's frame interval, in the order the rounds ran. */
	intervalRoundsMs: number[];
	/** Each round's CPU time, in the order the rounds ran. */
	cpuRoundsMs: number[];
	/** Each part's own time in each round, by name, in the order the rounds ran. */
	passRoundsMs: Record<string, number[]>;
	/** The step between the GPU's timestamps, as the last measurement that saw one reported it. */
	stepMs: number | null;
}

/** How a cost page measures its sides. */
export interface FeatureCostOptions {
	/**
	 * True measures the sides in the opposite turns on alternate rounds, so a clock or a cache that
	 * changes during the run does not favour one side.
	 */
	alternate?: boolean;
	/** The rounds of each side. Three by default, and an even count is best with `alternate`. */
	rounds?: number;
	/**
	 * Seconds of each measurement. Two by default. A short measurement turns the sides over more
	 * often, which shares a clock's drift between them, while it gives the GPU timer fewer frames to
	 * median.
	 */
	seconds?: number;
	/** Seconds of play before the first measurement. Two by default. */
	warmUpSeconds?: number;
}

/** The middle of some numbers, or null without any. */
function median(values: number[]): number | null {
	const sorted = [...values].sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Plays the engine's scene for a warm-up, then measures it with the feature off and on in turns,
 * ROUNDS times each. `turn` switches the feature, and resolves once the next frames draw with it.
 */
export async function featureCost(
	engine: Engine,
	turn: (on: boolean) => Promise<void>,
	measured?: (side: 'off' | 'on') => Promise<void>,
	options: FeatureCostOptions = {},
): Promise<{ off: SideCost; on: SideCost }> {
	await new Promise((resolve) =>
		setTimeout(resolve, (options.warmUpSeconds ?? WARM_UP_SECONDS) * 1000),
	);
	const seconds = options.seconds ?? SECONDS;
	const sides = {
		off: {
			gpuMs: [] as number[],
			intervalMs: [] as number[],
			cpuMs: [] as number[],
			refreshHz: [] as number[],
			draws: [] as number[],
			passes: new Map<string, number[]>(),
			steps: [] as number[],
		},
		on: {
			gpuMs: [] as number[],
			intervalMs: [] as number[],
			cpuMs: [] as number[],
			refreshHz: [] as number[],
			draws: [] as number[],
			passes: new Map<string, number[]>(),
			steps: [] as number[],
		},
	};
	const threads = { off: new Map<string, number[]>(), on: new Map<string, number[]>() };
	const rounds = options.rounds ?? ROUNDS;
	for (let round = 0; round < rounds; round++) {
		const order =
			options.alternate && round % 2 === 1 ? (['on', 'off'] as const) : (['off', 'on'] as const);
		for (const side of order) {
			await turn(side === 'on');
			const stats = await engine.measure(seconds);
			if (stats.gpuMs) sides[side].gpuMs.push(stats.gpuMs.median);
			sides[side].intervalMs.push(stats.intervalMs.median);
			sides[side].cpuMs.push(stats.cpuMs.median);
			if (stats.refreshHz) sides[side].refreshHz.push(stats.refreshHz);
			sides[side].draws.push(stats.drawCalls.median);
			if (stats.gpuStepMs !== null) sides[side].steps.push(stats.gpuStepMs);
			for (const pass of stats.gpuPassMs ?? []) {
				const values = sides[side].passes.get(pass.name) ?? [];
				values.push(pass.ms.median);
				sides[side].passes.set(pass.name, values);
			}
			for (const [name, thread] of Object.entries(stats.threads)) {
				const values = threads[side].get(name) ?? [];
				values.push(thread.busyMs.median);
				threads[side].set(name, values);
			}
			await measured?.(side);
		}
	}
	const summary = (side: 'off' | 'on'): SideCost => ({
		gpuMs: median(sides[side].gpuMs),
		intervalMs: median(sides[side].intervalMs),
		cpuMs: median(sides[side].cpuMs),
		refreshHz: median(sides[side].refreshHz),
		draws: median(sides[side].draws),
		passes: [...sides[side].passes].map(([name, values]) => ({ name, ms: median(values) })),
		threads: Object.fromEntries(
			[...threads[side]]
				.map(([name, values]) => [name, median(values)] as const)
				.filter(([, ms]) => ms !== null && ms > 0),
		),
		gpuRoundsMs: [...sides[side].gpuMs],
		intervalRoundsMs: [...sides[side].intervalMs],
		cpuRoundsMs: [...sides[side].cpuMs],
		passRoundsMs: Object.fromEntries(
			[...sides[side].passes].map(([name, values]) => [name, values]),
		),
		stepMs: sides[side].steps.length > 0 ? (sides[side].steps.at(-1) as number) : null,
	});
	return { off: summary('off'), on: summary('on') };
}
