// Camera controls in a live engine. Playwright's drags, wheel and touches reach null3D's controls
// through the engine's input, and three.js's controls on the same canvas through their DOM
// listeners. Both cameras must reach the same pose. After the orbit drags, the engine's frame must
// match the image test manifest's controls test, which makes the same moves through the controls'
// own calls in hold mode. And the controls' update allocates nothing, through every gesture.
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { allocatingPlaces } from '../lib/allocations.ts';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { borrowedRun, environmentNamed, imageProblems } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import type { ItemResult } from '../lib/runs.ts';
import { CONTROLS_MOVES, CONTROLS_VIEW } from '../pages/lib/controls-view.ts';
import { manifestRun } from './manifest.ts';

interface Pose {
	position: number[];
	target: number[];
	/** The fingers that the sketch read in its last frame. */
	fingers?: number;
	/** The sketch's frame. */
	frame?: number;
}

interface Poses {
	null3d: Pose;
	three: Pose;
}

/** Mouse drags reach both cameras exactly, so they may differ only by rounding to 32-bit floats. */
const MOUSE_TOLERANCE = 1e-4;

/** Opens the controls page, which publishes its result once the engine draws. */
async function open(page: Page, query: string): Promise<Record<string, unknown>> {
	await page.goto(`controls.html?${query}`);
	const result = await pageResult<Record<string, unknown>>(page, 30_000);
	expect(result.error).toBeUndefined();
	return result;
}

/** Runs in the page: both cameras' poses. */
const readPoses = () =>
	(globalThis as { controlsPoses?: () => Promise<Poses> }).controlsPoses?.() as Promise<Poses>;

/** The largest difference between the two poses, relative to the size of each value. */
function apart({ null3d, three }: Poses): number {
	let largest = 0;
	const values = [
		[null3d.position, three.position],
		[null3d.target, three.target],
	] as const;
	for (const [ours, theirs] of values)
		for (const [k, value] of theirs.entries())
			largest = Math.max(
				largest,
				Math.abs((ours[k] as number) - value) / Math.max(1, Math.abs(value)),
			);
	return largest;
}

/**
 * Waits until the sketch has taken the drags, which it reads at its next frames, and both cameras
 * agree. Returns the poses.
 */
async function expectSamePose(page: Page, tolerance: number): Promise<Poses> {
	await expect.poll(async () => apart(await page.evaluate(readPoses))).toBeLessThan(tolerance);
	return page.evaluate(readPoses);
}

/**
 * Waits until three.js's controls have taken an event that moved their camera from `before`, and
 * the sketch's camera has followed. The next event then reaches the sketch in a later frame.
 */
async function expectStep(page: Page, before: Pose): Promise<void> {
	await expect
		.poll(async () => {
			const poses = await page.evaluate(readPoses);
			const moved = apart({ null3d: before, three: poses.three }) > 1e-9;
			return moved ? apart(poses) : Number.POSITIVE_INFINITY;
		})
		.toBeLessThan(MOUSE_TOLERANCE);
}

/** How far three.js's camera is from where it started, so a test knows that the input moved it. */
function travel(poses: Poses): number {
	const [x, y, z] = CONTROLS_VIEW.position;
	const [px = 0, py = 0, pz = 0] = poses.three.position;
	return Math.sqrt((px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2);
}

/** A mouse drag with one button, in CSS pixels from the canvas's top-left corner. */
async function drag(
	page: Page,
	[x, y]: readonly [number, number],
	[dx, dy]: readonly number[],
	button: 'left' | 'middle' | 'right',
): Promise<void> {
	await page.mouse.move(x, y);
	await page.mouse.down({ button });
	await page.mouse.move(x + (dx as number), y + (dy as number), { steps: 6 });
	await page.mouse.up({ button });
}

/** The controls test's moves: a left drag, a right drag, and wheel scroll, each checked. */
async function orbitMoves(page: Page): Promise<void> {
	const { turn, pan, wheel } = CONTROLS_MOVES;
	await drag(page, [100, 90], turn, 'left');
	expect(travel(await expectSamePose(page, MOUSE_TOLERANCE))).toBeGreaterThan(1);
	await drag(page, [200, 60], pan, 'right');
	await expectSamePose(page, MOUSE_TOLERANCE);
	await page.mouse.move(160, 90);
	await page.mouse.wheel(0, wheel);
	await expectSamePose(page, MOUSE_TOLERANCE);
}

for (const mode of ENGINE_MODES)
	test(`orbit controls reach three.js's pose after drags and the wheel, ${mode.name}`, async ({
		page,
	}) => {
		await open(page, mode.query);
		await orbitMoves(page);
	});

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`the engine draws the pose that the orbit drags reach, on ${tier}`, async ({
		page,
	}, testInfo) => {
		const result = await open(page, `gpu=${tier}`);
		await orbitMoves(page);
		// The thread that draws runs a frame or two behind the sketch.
		const { frame: now = 0 } = (await page.evaluate(readPoses)).null3d;
		await expect
			.poll(async () => (await page.evaluate(readPoses)).null3d.frame ?? 0)
			.toBeGreaterThan(now + 3);
		const frame = await page.evaluate(() =>
			(
				globalThis as { captureControls?: () => Promise<Record<string, unknown>> }
			).captureControls?.(),
		);
		const run = borrowedRun(manifestRun('controls', tier, 'pipelined'), 'controls-drags');
		const place = { environment: environmentNamed(testInfo.project.name) };
		const drawn = { ...result, ...frame } as unknown as ItemResult;
		expect(imageProblems(run, drawn, place)).toEqual([]);
	});

test("map controls reach three.js's pose after a drag over the ground, a turn and the wheel", async ({
	page,
}) => {
	await open(page, 'map');
	await drag(page, [160, 120], [50, -30], 'left');
	expect(travel(await expectSamePose(page, MOUSE_TOLERANCE))).toBeGreaterThan(1);
	await drag(page, [100, 100], [40, 20], 'right');
	await expectSamePose(page, MOUSE_TOLERANCE);
	await page.mouse.move(160, 90);
	await page.mouse.wheel(0, -180);
	await expectSamePose(page, MOUSE_TOLERANCE);
	await drag(page, [60, 150], [90, -60], 'left');
	await expectSamePose(page, MOUSE_TOLERANCE);
});

test.describe('touch', () => {
	test.use({ hasTouch: true });

	/** Sends one touch event with these fingers down, through Chrome's input. */
	const touch = (
		cdp: CDPSession,
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		fingers: { x: number; y: number; id: number }[],
	) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers });

	test("orbit controls reach three.js's pose with one finger and with two", async ({ page }) => {
		await open(page, '');
		const cdp = await page.context().newCDPSession(page);
		for (let step = 0; step <= 6; step++)
			await touch(cdp, step === 0 ? 'touchStart' : 'touchMove', [
				{ x: 100 + 9 * step, y: 90 + 4 * step, id: 1 },
			]);
		await touch(cdp, 'touchEnd', []);
		expect(travel(await expectSamePose(page, MOUSE_TOLERANCE))).toBeGreaterThan(1);
		// Two fingers pan as they move together, and dolly as they spread. three.js takes each
		// finger's move on its own, so one finger moves at a time, and the sketch takes each move
		// in a frame of its own before the next.
		const first = { x: 120, y: 100, id: 2 };
		const second = { x: 200, y: 110, id: 3 };
		await touch(cdp, 'touchStart', [first, second]);
		await expect.poll(async () => (await page.evaluate(readPoses)).null3d.fingers).toBe(2);
		for (let step = 1; step <= 8; step++) {
			const before = (await page.evaluate(readPoses)).three;
			const finger = step % 2 === 1 ? first : second;
			finger.x += step <= 4 ? 12 : finger === first ? -10 : 10;
			finger.y -= step <= 4 ? 6 : 0;
			await touch(cdp, 'touchMove', [first, second]);
			await expectStep(page, before);
		}
		await touch(cdp, 'touchEnd', []);
		await expectSamePose(page, MOUSE_TOLERANCE);
	});
});

test("the controls' update allocates nothing, through every gesture", async ({ page }) => {
	await page.goto('controls-loop.html');
	await pageResult(page, 30_000);
	const runLoop = (iterations: number, runs: number) =>
		page.evaluate(
			({ iterations, runs }) => {
				const loop = (globalThis as { __null3dControlsRun?: (frames: number) => void })
					.__null3dControlsRun;
				for (let run = 0; run < runs; run++) loop?.(iterations);
			},
			{ iterations, runs },
		);
	const plan = {
		warmUpRuns: 40,
		warmUpIterations: 2_500,
		sampledIterations: 60_000,
		// The controls, and the engine's math helpers that they call.
		counted: /\/packages\/controls\/src\/|\/packages\/engine\/src\/math\//,
	};
	expect(await allocatingPlaces(page, plan, runLoop)).toEqual([]);
});
