// Finds the places in a page's code that allocate, with Chrome's heap profiler, as
// `bun run bench:allocation` samples the engine's frame code. The page offers a loop, which runs
// the code under test many times. Once Chrome has optimized the loop, the profiler samples the
// allocations of a long run.
//
// Until Chrome fully optimizes a function, it stores fractions as number objects, so the warm-up
// runs the loop many times in short runs. Chrome optimizes in the background, and on a busy
// machine a round can still sample code that it has not finished. So a check samples again after
// more warm-up, a few times at most. Code that allocates does so in every round.
//
// A page whose engine runs on the page's own thread draws the engine's frames between the loop's
// runs, and the profiler samples those frames too. In the first seconds after the start, the
// browser has not yet optimized the code that runs once per frame, so that code boxes the numbers
// it computes, a few in each frame, until about 14 s after the start. The frame loop's own
// allocation check, `bun run bench:allocation`, waits 30 s for this reason. One frame in a sample
// then counts against the loop. So the check pauses such an engine first, as the loop under test
// needs no frames.
import type { Page } from '@playwright/test';

/** How a check warms the loop up and samples it. */
export interface SamplingPlan {
	/** Short runs of the loop before each round's sample, so that the browser optimizes it. */
	warmUpRuns: number;
	/** Iterations of each short run. */
	warmUpIterations: number;
	/** Iterations while the profiler samples. */
	sampledIterations: number;
	/** The source files whose allocations count, by their address. */
	counted: RegExp;
	/**
	 * True for a page that runs an engine on its own thread. The check then pauses it through the
	 * page's `__null3dSetPaused`, so no frame runs while the profiler samples.
	 */
	pauseEngine?: boolean;
}

/** A place that allocates: its function, file and line, and its bytes per iteration. */
export interface Allocation {
	place: string;
	bytesPerIteration: number;
}

interface ProfileNode {
	callFrame: { functionName: string; url: string; lineNumber: number };
	selfSize: number;
	children: ProfileNode[];
}

/** The time the browser gets to finish optimizing in the background, before each sample. */
const OPTIMIZE_MS = 500;
/** The most rounds of warm-up and sampling. */
const ROUNDS = 3;
/** Bytes between allocation samples: small, so even one object per iteration shows many times. */
const SAMPLING_INTERVAL = 64;
/**
 * The most bytes per iteration that a place may allocate: sampling noise, a few objects in a whole
 * run. One number object per iteration, the smallest real allocation, is 12 bytes per iteration.
 */
const MAX_BYTES_PER_ITERATION = 0.01;

/** The bytes that each place in the counted files allocated, by its function and line. */
function placesIn(node: ProfileNode, counted: RegExp, found: Map<string, number>): void {
	const { functionName, url, lineNumber } = node.callFrame;
	if (node.selfSize > 0 && counted.test(url)) {
		const place = `${functionName || '(anonymous)'} ${url}:${lineNumber + 1}`;
		found.set(place, (found.get(place) ?? 0) + node.selfSize);
	}
	for (const child of node.children) placesIn(child, counted, found);
}

/**
 * The places in the counted files that allocate more than sampling noise per iteration of the
 * page's loop. `runLoop` runs the loop in the page: `runs` runs of `iterations` iterations each.
 */
export async function allocatingPlaces(
	page: Page,
	plan: SamplingPlan,
	runLoop: (iterations: number, runs: number) => Promise<unknown>,
): Promise<Allocation[]> {
	if (plan.pauseEngine)
		await page.evaluate(() => {
			const setPaused = (globalThis as { __null3dSetPaused?: (paused: boolean) => void })
				.__null3dSetPaused;
			if (!setPaused) throw new Error('the page offers no __null3dSetPaused to pause its engine');
			setPaused(true);
		});
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('HeapProfiler.enable');
	let over: Allocation[] = [];
	for (let round = 0; round < ROUNDS; round++) {
		await runLoop(plan.warmUpIterations, plan.warmUpRuns);
		await page.waitForTimeout(OPTIMIZE_MS);
		// Garbage that an iteration makes dies young, so the profiler must keep the samples that
		// collections free.
		await cdp.send('HeapProfiler.startSampling', {
			samplingInterval: SAMPLING_INTERVAL,
			includeObjectsCollectedByMinorGC: true,
			includeObjectsCollectedByMajorGC: true,
		});
		await runLoop(plan.sampledIterations, 1);
		const { profile } = await cdp.send('HeapProfiler.stopSampling');
		const found = new Map<string, number>();
		placesIn(profile.head as ProfileNode, plan.counted, found);
		over = [...found]
			.map(([place, bytes]) => ({ place, bytesPerIteration: bytes / plan.sampledIterations }))
			.filter(({ bytesPerIteration }) => bytesPerIteration > MAX_BYTES_PER_ITERATION);
		if (over.length === 0) break;
	}
	return over;
}
