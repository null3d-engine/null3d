// The scene's object tables grow during play, on every GPU path. The objects created before the
// growth must draw exactly as in an engine whose tables never grew, both before and after it, and
// so must an object created after it, in a slot past every slot of the tables the engine started
// with. Each growth moves the tables, and the thread that draws reads the last frame's matrices
// from the old ones while the next frame steps, so every frame drawn during the growth shows
// either the picture before or the one after.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Picture {
	before: string;
	after: string;
	objects: number;
	/** Frames captured back to back while the tables grew, and those that showed neither picture. */
	during: number;
	odd: number;
	latency: string;
	failures: string[];
}

interface GrowthResult {
	error?: string;
	pictures: Record<'grow' | 'reference', Picture>;
}

/** The objects that the growing engine's tables start with room for, as the page sets them. */
const START = 1_000;

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`objects draw the same after the object tables grow during play, on ${gpu}`, async ({
		page,
	}) => {
		await page.goto(`object-growth.html?gpu=${gpu}`);
		const result = await pageResult<GrowthResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		const { grow, reference } = result.pictures;
		expect(grow.failures).toEqual([]);
		expect(reference.failures).toEqual([]);
		// The groups that the growing engine made took more places than the default start offers.
		expect(grow.objects).toBeGreaterThan(16 * START);
		// Pipelined, the thread that draws replays a frame while the next one steps.
		expect(grow.latency).toBe('pipelined');
		expect(grow.during).toBeGreaterThan(0);
		expect(grow.odd).toBe(0);
		expect(grow.before === reference.before).toBe(true);
		expect(grow.after === reference.after).toBe(true);
		// The box that moved, and the one added after the growth, draw.
		expect(grow.after === grow.before).toBe(false);
	});
