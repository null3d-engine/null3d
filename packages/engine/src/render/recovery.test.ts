import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Slot } from '../shared/control';
import { Drawing, MAX_RECOVERIES, type Recoverable } from './recovery';

type Loop = { stop(): void; stopped: boolean };
type Size = { width: number; height: number };
type FakeRenderer = Recoverable & {
	canvas: Size;
	lose(reason: string): void;
	destroyed: boolean;
	/** How many times the renderer was destroyed. */
	destroys: number;
	/** The canvas's size at each blank frame, and when the renderer was destroyed. */
	blanks: Size[];
	destroyedAt?: Size;
};

/**
 * A renderer whose loss the test triggers, and which records its blank frames and whether it was
 * destroyed.
 */
function fakeRenderer(): FakeRenderer {
	let lose: (reason: string) => void = () => {};
	const lost = new Promise<string>((resolve) => {
		lose = resolve;
	});
	return {
		canvas: { width: 640, height: 360 },
		lost,
		destroyed: false,
		destroys: 0,
		blanks: [],
		lose,
		simulateLoss() {
			lose('simulated');
		},
		drawBlank() {
			this.blanks.push({ ...this.canvas });
		},
		destroy() {
			this.destroys++;
			this.destroyed = true;
			this.destroyedAt = { ...this.canvas };
		},
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Long enough for the frames that a stop waits for, which the test's frame timer runs at once. */
const frames = () => new Promise((resolve) => setTimeout(resolve, 5));

const thread = globalThis as { requestAnimationFrame?: (callback: () => void) => unknown };
const browserFrames = thread.requestAnimationFrame;
beforeAll(() => {
	thread.requestAnimationFrame = (callback) => setTimeout(callback, 0);
});
afterAll(() => {
	thread.requestAnimationFrame = browserFrames;
});

function setup(create?: () => Promise<FakeRenderer>, recovers = true) {
	const slots = new Int32Array(32);
	const renderers = [fakeRenderer()];
	const loops: Loop[] = [];
	const failures: string[] = [];
	const drawing = new Drawing<FakeRenderer>(
		renderers[0] as FakeRenderer,
		create ??
			(async () => {
				const next = fakeRenderer();
				renderers.push(next);
				return next;
			}),
		() => {
			const loop: Loop = {
				stopped: false,
				stop() {
					loop.stopped = true;
				},
			};
			loops.push(loop);
			return loop;
		},
		slots,
		(reason) => failures.push(reason),
		recovers,
	);
	const last = () => renderers[renderers.length - 1] as FakeRenderer;
	return { slots, renderers, loops, failures, drawing, last };
}

describe('Drawing', () => {
	it('replaces a lost renderer, starts a new loop and tells the sketch thread', async () => {
		const { slots, renderers, loops, failures, drawing, last } = setup();
		last().lose('driver reset');
		await settle();
		expect(renderers).toHaveLength(2);
		expect(renderers[0]?.destroyed).toBe(true);
		expect(drawing.renderer).toBe(last());
		expect(loops).toHaveLength(2);
		expect(loops[0]?.stopped).toBe(true);
		expect(Atomics.load(slots, Slot.GpuEpoch)).toBe(1);
		expect(failures).toEqual([]);
	});

	it('reports the loss after too many within a minute', async () => {
		const { slots, failures, last } = setup();
		for (let loss = 0; loss <= MAX_RECOVERIES; loss++) {
			last().lose('driver reset');
			await settle();
		}
		expect(Atomics.load(slots, Slot.GpuEpoch)).toBe(MAX_RECOVERIES);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain(`lost ${MAX_RECOVERIES + 1} times within a minute`);
	});

	it('reports the loss when no new renderer starts', async () => {
		const { failures, last } = setup(async () => {
			throw new Error('no adapter');
		});
		last().lose('driver reset');
		await settle();
		expect(failures).toEqual(['driver reset, and no new GPU device started: no adapter']);
	});

	it('reports the first loss at once when it may not recover, as in hold mode', async () => {
		const { slots, renderers, loops, failures, last } = setup(undefined, false);
		last().lose('driver reset');
		await settle();
		expect(renderers).toHaveLength(1);
		expect(renderers[0]?.destroyed).toBe(true);
		expect(loops[0]?.stopped).toBe(true);
		expect(Atomics.load(slots, Slot.GpuEpoch)).toBe(0);
		expect(failures).toEqual(['driver reset, in hold mode, which draws on one device only']);
	});

	it('destroys a replacement that arrives after the engine stopped', async () => {
		let release: (renderer: FakeRenderer) => void = () => {};
		const replacement = fakeRenderer();
		const { drawing, failures, last } = setup(
			() =>
				new Promise<FakeRenderer>((resolve) => {
					release = resolve;
				}),
		);
		last().lose('driver reset');
		await settle();
		const stopped = drawing.stop();
		release(replacement);
		await stopped;
		await frames();
		expect(replacement.destroyed).toBe(true);
		expect(failures).toEqual([]);
	});

	it('waits for a recovery under way before a stop resolves, and never releases a renderer twice', async () => {
		let release: (renderer: FakeRenderer) => void = () => {};
		const replacement = fakeRenderer();
		const { drawing, loops, renderers, last } = setup(
			() =>
				new Promise<FakeRenderer>((resolve) => {
					release = resolve;
				}),
		);
		last().lose('driver reset');
		await settle();
		let resolved = false;
		const stopped = drawing.stop().then(() => {
			resolved = true;
		});
		await frames();
		// The stop holds until the new renderer exists, so that it cannot take the canvas later.
		expect(resolved).toBe(false);
		release(replacement);
		await stopped;
		expect(replacement.destroys).toBe(1);
		expect(replacement.blanks).toEqual([{ width: 1, height: 1 }]);
		expect(renderers[0]?.destroys).toBe(1);
		expect(renderers[0]?.blanks).toEqual([]);
		expect(loops).toHaveLength(1);
	});

	it('releases no renderer again after a recovery that failed', async () => {
		const { drawing, failures, renderers, last } = setup(async () => {
			throw new Error('no adapter');
		});
		last().lose('driver reset');
		await settle();
		await drawing.stop();
		expect(failures).toHaveLength(1);
		expect(renderers[0]?.destroys).toBe(1);
		expect(renderers[0]?.blanks).toEqual([]);
	});

	it('shows a blank frame of one pixel before it destroys the renderer, then restores the canvas', async () => {
		const { drawing, loops, last } = setup();
		const renderer = last();
		const stopped = drawing.stop();
		expect(loops[0]?.stopped).toBe(true);
		expect(renderer.blanks).toEqual([{ width: 1, height: 1 }]);
		expect(renderer.destroyed).toBe(false);
		await stopped;
		expect(renderer.destroyedAt).toEqual({ width: 1, height: 1 });
		expect(renderer.canvas).toEqual({ width: 640, height: 360 });
	});

	it('destroys a renderer whose blank frame fails', async () => {
		const { drawing, last } = setup();
		const renderer = last();
		renderer.drawBlank = () => {
			throw new Error('the GPU is lost');
		};
		await drawing.stop();
		expect(renderer.destroyed).toBe(true);
		expect(renderer.canvas).toEqual({ width: 640, height: 360 });
	});
});
