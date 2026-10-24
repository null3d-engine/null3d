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
	/** Draw calls per frame in the middle of the side's measurements. */
	draws: number | null;
	/** Each part of the frame's GPU time, in the order that the device reported it. */
	passes: PassCost[];
	/** The median busy time per frame of each thread, by name. */
	threads: Record<string, number | null>;
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
	await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
	const sides = {
		off: {
			gpuMs: [] as number[],
			intervalMs: [] as number[],
			cpuMs: [] as number[],
			draws: [] as number[],
			passes: new Map<string, number[]>(),
		},
		on: {
			gpuMs: [] as number[],
			intervalMs: [] as number[],
			cpuMs: [] as number[],
			draws: [] as number[],
			passes: new Map<string, number[]>(),
		},
	};
	const threads = { off: new Map<string, number[]>(), on: new Map<string, number[]>() };
	const rounds = options.rounds ?? ROUNDS;
	for (let round = 0; round < rounds; round++) {
		const order =
			options.alternate && round % 2 === 1 ? (['on', 'off'] as const) : (['off', 'on'] as const);
		for (const side of order) {
			await turn(side === 'on');
			const stats = await engine.measure(SECONDS);
			if (stats.gpuMs) sides[side].gpuMs.push(stats.gpuMs.median);
			sides[side].intervalMs.push(stats.intervalMs.median);
			sides[side].cpuMs.push(stats.cpuMs.median);
			sides[side].draws.push(stats.drawCalls.median);
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
		draws: median(sides[side].draws),
		passes: [...sides[side].passes].map(([name, values]) => ({ name, ms: median(values) })),
		threads: Object.fromEntries(
			[...threads[side]]
				.map(([name, values]) => [name, median(values)] as const)
				.filter(([, ms]) => ms !== null && ms > 0),
		),
	});
	return { off: summary('off'), on: summary('on') };
}
