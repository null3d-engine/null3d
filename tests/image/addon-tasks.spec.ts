// An add-on's task on the engine's job workers, in every thread mode. The test page's sketch queues
// a sort through the add-on's public task in each round, awaits the answer, and moves a marker to
// the slot of the smallest value that the answer gives. The test checks that each task ran in a job
// worker rather than the thread that ran the sketch, that each answer reached a later frame than
// the one that queued it, that the rounds reached the frames in the order that they were queued,
// and that the last answer is the one that the drawn frame shows.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface Round {
	round: number;
	queued: number;
	applied: number;
	worker: string;
	order: number[];
}

interface Run {
	start: number;
	end: number;
	centre: number;
}

interface Result {
	error?: string;
	tier: string;
	mode: { build: string; sketchThread: string; latency: string; renderThread: string };
	rounds: Round[];
	bright: Run[];
	width: number;
	height: number;
}

/** The rounds that the sketch sorts, and the values of a round. */
const ROUNDS = 4;
const COUNT = 5;
/** The marker's distance, in metres, from the camera, which stands 4 metres from it. */
const DISTANCE = 4;
const FOV = 60;
const SLOTS = 5;

/** Where the middle row shows the marker of `slot`, in pixels, for a canvas of this size. */
function slotCentre(slot: number, width: number, height: number): number {
	const halfHeight = Math.tan((FOV / 2) * (Math.PI / 180)) * DISTANCE;
	const halfWidth = halfHeight * (width / height);
	return width / 2 + ((slot - (SLOTS - 1) / 2) / halfWidth) * (width / 2);
}

/** The values of a round, smallest first, as the sketch writes them in reverse. */
function sortedValues(round: number): number[] {
	return Array.from({ length: COUNT }, (_, i) => Math.min(SLOTS - 1, SLOTS - 1 - i + round)).sort(
		(a, b) => a - b,
	);
}

for (const mode of ENGINE_MODES) {
	test(`an add-on's task runs on a job worker and its answer reaches the frame in order, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`addon-tasks.html?${mode.query}`);
		const result = await pageResult<Result>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(modeProblems(result.mode, mode)).toEqual([]);
		// The task runs in a job worker, or in the task worker where the engine starts no job
		// workers. It never runs in the thread that ran the sketch.
		const worker = mode.build === 'single' ? /^null3d-tasks/ : /^null3d-job-/;
		expect(result.rounds).toHaveLength(ROUNDS);
		for (const round of result.rounds) expect(round.worker).toMatch(worker);
		// Each round ran to its end, with its answer returned whole and sorted.
		expect(result.rounds.map((round) => round.round)).toEqual([0, 1, 2, 3]);
		for (const round of result.rounds) expect(round.order).toEqual(sortedValues(round.round));
		// An answer never lands in the frame that queued its task, and each round starts after the
		// frame that drew the round before it, so the frames see the rounds in order.
		for (const round of result.rounds) expect(round.applied).toBeGreaterThan(round.queued);
		for (let i = 1; i < result.rounds.length; i++) {
			const before = result.rounds[i - 1] as Round;
			const round = result.rounds[i] as Round;
			expect(round.queued).toBeGreaterThanOrEqual(before.applied);
		}
		// Only the last answer is drawn: one bright marker, in the slot of the smallest value.
		expect(result.bright).toHaveLength(1);
		const marker = result.bright[0] as Run;
		expect(marker.end - marker.start).toBeGreaterThan(8);
		const lastSlot = (ROUNDS - 1) % SLOTS;
		expect(
			Math.abs(marker.centre - slotCentre(lastSlot, result.width, result.height)),
		).toBeLessThanOrEqual(8);
	});
}
