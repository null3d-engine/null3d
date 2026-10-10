// The scene's object tables grow during play, on every GPU path. The objects created before the
// growth must draw exactly as in an engine whose tables never grew, both before and after it, and
// so must an object created after it, in a slot past every slot of the tables the engine started
// with. Each growth moves the tables, while the last frame's list still points at the old world
// matrices. The ?replay-delay= switch makes the thread that draws replay each list late, so the
// sketch thread's next step, and its growth, run first. Frames captured back to back meanwhile
// then show any read of matrices that were freed too early: the engine hides every row of the old
// buffers before it frees them, so such a frame lacks the dynamic box. The slow frames are far
// below the target rate, so the sketch turns the frame-budget governor off, and each engine reports
// the render scale of its pictures. The test plays long enough first that a governor left on would
// lower the scale in every run, not only on a slow machine.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Picture {
	before: string;
	after: string;
	objects: number;
	/** Frames captured back to back while the tables grew, and those that showed neither picture. */
	during: number;
	odd: number;
	/**
	 * Each of those frames as B (the picture before), A (the one after) or, for neither, the number
	 * of its picture among the odd ones.
	 */
	sequence: string;
	latency: string;
	/** The render scale of the frames before and after the growth. */
	scales: number[];
	failures: string[];
}

interface GrowthResult {
	error?: string;
	pictures: Record<'grow' | 'reference', Picture>;
}

/** The objects that the growing engine's tables start with room for, as the page sets them. */
const START = 1_000;
/** The thread that draws waits this long before each replay: far longer than a growth's step. */
const REPLAY_DELAY_MS = 50;
/**
 * The least play before the picture before, in ms: past the governor's grace after the first frame
 * and its first second over budget, with time to spare.
 */
const PLAY_MS = 3_500;

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`objects draw the same after the object tables grow during play, on ${gpu}`, async ({
		page,
	}) => {
		await page.goto(
			`object-growth.html?gpu=${gpu}&replay-delay=${REPLAY_DELAY_MS}&play-ms=${PLAY_MS}`,
		);
		const result = await pageResult<GrowthResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		const { grow, reference } = result.pictures;
		expect(grow.failures).toEqual([]);
		expect(reference.failures).toEqual([]);
		// Both engines draw every picture at the highest scale, so the pictures compare.
		expect(grow.scales).toEqual([1, 1]);
		expect(reference.scales).toEqual([1, 1]);
		// The groups that the growing engine made took more places than the default start offers.
		expect(grow.objects).toBeGreaterThan(16 * START);
		// Pipelined, the thread that draws replays a frame while the next one steps.
		expect(grow.latency).toBe('pipelined');
		expect(grow.during).toBeGreaterThan(0);
		// The message tells odd frames from an odd last picture, which makes every frame odd.
		expect(
			grow.odd,
			`frames during the growth: ${grow.sequence}; the last picture matches the reference's: ${grow.after === reference.after}`,
		).toBe(0);
		expect(grow.before === reference.before).toBe(true);
		expect(grow.after === reference.after).toBe(true);
		// The box that moved, and the one added after the growth, draw.
		expect(grow.after === grow.before).toBe(false);
	});
