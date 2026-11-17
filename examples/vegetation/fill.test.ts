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
		const running = fill(['alpha', 'beta'], {
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

	it('counts every finished species, and the last count reads the whole field', async () => {
		const fill = createFill();
		const progress: [number, number][] = [];
		await fill(['alpha', 'beta'], {
			grow: async (id) => `${id} plant`,
			land: () => {},
			progress: (done, total) => progress.push([done, total]),
			discard: () => {},
		});
		expect(progress.at(-1)).toEqual([2, 2]);
	});

	it('leaves the slot of a species that cannot grow empty, and the rest still land', async () => {
		const fill = createFill();
		const landed: string[][] = [];
		const failed: string[] = [];
		await fill(['alpha', 'beta'], {
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
		const older = fill(['alpha'], {
			grow: () => held.promise,
			land: () => {
				olderLanded++;
			},
			progress: (done) => {
				olderCount = done;
			},
			discard: (plant) => discarded.push(plant),
		});
		await fill(['beta'], {
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
		const older = fill(['alpha'], {
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
		await fill(['beta'], {
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
		const older = fill(['alpha'], {
			grow: () => held.promise,
			land: () => {},
			progress: () => {},
			discard: () => {},
			settled: () => {
				olderSettled++;
			},
		});
		await fill(['beta'], {
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
});
