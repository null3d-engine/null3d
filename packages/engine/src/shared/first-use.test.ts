import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test';
import { FIRST_RETRY_MS, FirstUse } from './first-use';

/** The clock that `performance.now()` reads, which each test moves by hand. */
let clock = 0;
let now: Mock<() => number>;
beforeEach(() => {
	clock = 0;
	now = spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => now.mockRestore());

/** A load that fails until the test lets it pass, and counts its starts. */
function flaky() {
	let starts = 0;
	let passes = false;
	const load = () => {
		starts++;
		return passes ? Promise.resolve('code') : Promise.reject(new Error('offline'));
	};
	return {
		load,
		starts: () => starts,
		pass: () => {
			passes = true;
		},
	};
}

/** The time until `use` loads again after its failure, found in steps of half a second. */
async function nextWaitOf(use: FirstUse<unknown>, starts: () => number): Promise<number> {
	const before = starts();
	let wait = 0;
	while (starts() === before) {
		wait += 500;
		clock += 500;
		await use.get().catch(() => undefined);
	}
	return wait;
}

/** The reason that `promise` rejects with. */
async function reason(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
		return 'none';
	} catch (error) {
		return (error as Error).message;
	}
}

describe('FirstUse', () => {
	test('loads once, and every use gets that load', async () => {
		const { load, starts, pass } = flaky();
		pass();
		const use = new FirstUse(load);
		expect(use.value).toBeUndefined();
		const [a, b] = await Promise.all([use.get(), use.get()]);
		expect([a, b, use.value]).toEqual(['code', 'code', 'code']);
		expect(starts()).toBe(1);
		await use.get();
		expect(starts()).toBe(1);
	});

	test('loads again after a failure, once the wait has passed, and reports each failure once', async () => {
		const { load, starts, pass } = flaky();
		const failures: string[] = [];
		const use = new FirstUse(load, (error) => failures.push((error as Error).message));
		expect(await reason(use.get())).toBe('offline');
		expect(failures).toEqual(['offline']);
		expect((use.error as Error).message).toBe('offline');
		// Within the wait, a use gets the same failure and starts no load.
		clock += FIRST_RETRY_MS - 1;
		expect(await reason(use.get())).toBe('offline');
		expect(starts()).toBe(1);
		expect(failures).toEqual(['offline']);
		// After it, the next use loads again.
		clock += 1;
		pass();
		expect(await use.get()).toBe('code');
		expect(starts()).toBe(2);
		expect(use.error).toBeUndefined();
	});

	test('doubles the wait with each failure in a row, up to the longest', async () => {
		const { load, starts } = flaky();
		const use = new FirstUse(load);
		await reason(use.get());
		const waits: number[] = [];
		for (let k = 0; k < 7; k++) waits.push(await nextWaitOf(use, starts));
		expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 32000]);
		expect(waits[0]).toBe(FIRST_RETRY_MS);
	});

	test('waits out the wait in untilRetry, and settles whatever the load gave', async () => {
		const { load } = flaky();
		const use = new FirstUse(load);
		await use.settled();
		await reason(use.get());
		expect(await use.settled()).toBeUndefined();
		// With no failure there is no wait.
		const fresh = new FirstUse(() => Promise.resolve(1));
		await fresh.untilRetry();
	});

	test('takes a load that throws at once as a failure', async () => {
		const use = new FirstUse<string>(() => {
			throw new Error('no such module');
		});
		expect(await reason(use.get())).toBe('no such module');
	});
});
