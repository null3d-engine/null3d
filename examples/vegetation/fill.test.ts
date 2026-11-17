import { describe, expect, it } from 'bun:test';
import { createFill } from './fill';

/** A promise that the test settles by hand, so a species finishes when the test says. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

/** Waits for the fills' own promises to run, so a landing that already happened is in the log. */
function settle(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

describe('createFill', () => {
	it('lands each plant as it finishes, in species order', async () => {
		const fill = createFill();
		const alpha = deferred<string>();
		const beta = deferred<string>();
		const landed: string[][] = [];
		const running = fill.fill(['alpha', 'beta'], {
			grow: (id) => (id === 'alpha' ? alpha.promise : beta.promise),
			land: (plants) => landed.push([...plants]),
			progress: () => {},
			discard: () => {},
		});
		// The second species finishes first: it stands at once, while the first still grows.
		beta.resolve('beta plant');
		await settle();
		expect(landed).toEqual([['beta plant']]);
		alpha.resolve('alpha plant');
		await settle();
		expect(landed.at(-1)).toEqual(['alpha plant', 'beta plant']);
		await running;
	});

	it('counts each species as it finishes, and the last count reads the whole field', async () => {
		const fill = createFill();
		const progress: [number, number][] = [];
		await fill.fill(['alpha', 'beta'], {
			grow: async (id) => `${id} plant`,
			land: () => {},
			progress: (done, total) => progress.push([done, total]),
			discard: () => {},
		});
		// A count for every finished species, so the bar moves while the rest still grow.
		expect(progress).toEqual([
			[1, 2],
			[2, 2],
		]);
	});

	it('leaves the slot of a species that cannot grow empty, and the rest still land', async () => {
		const fill = createFill();
		const landed: string[][] = [];
		const failed: string[] = [];
		await fill.fill(['alpha', 'beta'], {
			grow: async (id) => {
				if (id === 'beta') throw new Error('no seed left');
				return 'alpha plant';
			},
			land: (plants) => landed.push([...plants]),
			progress: () => {},
			discard: () => {},
			failed: (id) => failed.push(id),
		});
		expect(landed).toEqual([['alpha plant']]);
		expect(failed).toEqual(['beta']);
	});

	it('lands nothing more for a fill that a newer one took the field from', async () => {
		const fill = createFill();
		const held = deferred<string>();
		const discarded: string[] = [];
		let olderCount = 0;
		let olderLanded = 0;
		const older = fill.fill(['alpha'], {
			grow: () => held.promise,
			land: () => {
				olderLanded++;
			},
			progress: (done) => {
				olderCount = done;
			},
			discard: (plant) => discarded.push(plant),
		});
		await fill.fill(['beta'], {
			grow: async () => 'beta plant',
			land: () => {},
			progress: () => {},
			discard: () => {},
		});
		held.resolve('alpha plant');
		await older;
		// The older fill's plant is taken down again, and its count stops at the takeover.
		expect(discarded).toEqual(['alpha plant']);
		expect(olderLanded).toBe(0);
		expect(olderCount).toBe(0);
	});

	it('tells a grow that the field changed hands, so it can stop early', async () => {
		const fill = createFill();
		const gate = deferred<void>();
		const reads: boolean[] = [];
		const older = fill.fill(['alpha'], {
			grow: async (_id, _index, current) => {
				const before = current();
				await gate.promise;
				reads.push(before, current());
				return 'alpha plant';
			},
			land: () => {},
			progress: () => {},
			discard: () => {},
		});
		await fill.fill(['beta'], {
			grow: async () => 'beta plant',
			land: () => {},
			progress: () => {},
			discard: () => {},
		});
		gate.resolve();
		await older;
		expect(reads).toEqual([true, false]);
	});

	it('settles the fill that owns the field, and no fill that a newer one took over', async () => {
		const fill = createFill();
		const held = deferred<string>();
		let olderSettled = 0;
		let newerSettled = 0;
		const older = fill.fill(['alpha'], {
			grow: () => held.promise,
			land: () => {},
			progress: () => {},
			discard: () => {},
			settled: () => {
				olderSettled++;
			},
		});
		await fill.fill(['beta'], {
			grow: async () => 'beta plant',
			land: () => {},
			progress: () => {},
			discard: () => {},
			settled: () => {
				newerSettled++;
			},
		});
		held.resolve('alpha plant');
		await older;
		expect(newerSettled).toBe(1);
		expect(olderSettled).toBe(0);
	});

	it('takes the field before any work, so an older build stops at once', async () => {
		const fill = createFill();
		const held = deferred<string>();
		const discarded: string[] = [];
		let olderLanded = 0;
		const older = fill.fill(['alpha'], {
			grow: () => held.promise,
			land: () => {
				olderLanded++;
			},
			progress: () => {},
			discard: (plant) => discarded.push(plant),
		});
		// The newer build claims the field before it loads anything, so the older build's plant is
		// taken down even though the newer build has not grown a plant of its own yet.
		const claim = fill.take();
		expect(claim.current()).toBe(true);
		held.resolve('alpha plant');
		await older;
		expect(discarded).toEqual(['alpha plant']);
		expect(olderLanded).toBe(0);
	});

	it('grows under a claim taken earlier, and stands nothing once a newer claim exists', async () => {
		const fill = createFill();
		const claim = fill.take();
		const landed: string[][] = [];
		const running = fill.fill(
			['alpha'],
			{
				grow: async () => 'alpha plant',
				land: (plants) => landed.push([...plants]),
				progress: () => {},
				discard: () => {},
			},
			claim,
		);
		// A newer build claims the field before the older grow returns, so nothing lands.
		fill.take();
		await running;
		expect(landed).toEqual([]);
	});
});
