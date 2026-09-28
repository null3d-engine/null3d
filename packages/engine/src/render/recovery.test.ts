import { describe, expect, it } from 'bun:test';
import { Slot } from '../shared/control';
import { Drawing, MAX_RECOVERIES, type Recoverable } from './recovery';

type Loop = { stop(): void; stopped: boolean };
type FakeRenderer = Recoverable & { lose(reason: string): void; destroyed: boolean };

/** A renderer whose loss the test triggers, and which records whether it was destroyed. */
function fakeRenderer(): FakeRenderer {
	let lose: (reason: string) => void = () => {};
	const lost = new Promise<string>((resolve) => {
		lose = resolve;
	});
	return {
		lost,
		destroyed: false,
		lose,
		simulateLoss() {
			lose('simulated');
		},
		destroy() {
			this.destroyed = true;
		},
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(create?: () => Promise<FakeRenderer>) {
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
		drawing.stop();
		release(replacement);
		await settle();
		expect(replacement.destroyed).toBe(true);
		expect(failures).toEqual([]);
	});
});
