// What a feature costs on this device: a page's engine plays a scene with the feature off and on in
// turns, and the page measures each side over the same seconds, so heat slows both sides alike.
// The bloom and environment cost pages share it.
import type { Engine } from '@null3d/engine';

/** Seconds of play before the first measurement. */
const WARM_UP_SECONDS = 2;
/** Seconds of each measurement, and how many each side gets. */
const SECONDS = 2;
const ROUNDS = 3;

/** The medians of one side's measurements: GPU time where the device has a timer, frame interval and CPU time. */
export interface SideCost {
	gpuMs: number | null;
	intervalMs: number | null;
	cpuMs: number | null;
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
): Promise<{ off: SideCost; on: SideCost }> {
	await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
	const sides = {
		off: { gpuMs: [] as number[], intervalMs: [] as number[], cpuMs: [] as number[] },
		on: { gpuMs: [] as number[], intervalMs: [] as number[], cpuMs: [] as number[] },
	};
	for (let round = 0; round < ROUNDS; round++) {
		for (const side of ['off', 'on'] as const) {
			await turn(side === 'on');
			const stats = await engine.measure(SECONDS);
			if (stats.gpuMs) sides[side].gpuMs.push(stats.gpuMs.median);
			sides[side].intervalMs.push(stats.intervalMs.median);
			sides[side].cpuMs.push(stats.cpuMs.median);
		}
	}
	const summary = (side: 'off' | 'on'): SideCost => ({
		gpuMs: median(sides[side].gpuMs),
		intervalMs: median(sides[side].intervalMs),
		cpuMs: median(sides[side].cpuMs),
	});
	return { off: summary('off'), on: summary('on') };
}
