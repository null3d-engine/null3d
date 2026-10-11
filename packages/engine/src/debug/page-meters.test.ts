import { afterEach, describe, expect, it, jest } from 'bun:test';
import {
	countSharedOnce,
	FIRST_ANSWER_LIMIT_MS,
	MainThreadWindow,
	type MemoryMeasurement,
	PageMemorySampler,
	resetPageMeasurement,
} from './page-meters';

const MIB = 1024 * 1024;

/** A measurement whose breakdown has an entry of each size, in MiB. */
function measurement(...mib: number[]): MemoryMeasurement {
	const breakdown = mib.map((size) => ({
		bytes: size * MIB,
		attribution: [{ scope: 'DedicatedWorkerGlobalScope', url: 'worker.js' }],
	}));
	return { bytes: breakdown.reduce((sum, entry) => sum + entry.bytes, 0), breakdown };
}

describe('countSharedOnce', () => {
	it('counts a shared memory once, where each thread that holds it adds it to its own figure', () => {
		// The page and two workers hold a shared memory of 64 MiB, on top of their own heaps of 10,
		// 3 and 2 MiB, and a fourth worker holds none.
		const result = measurement(74, 67, 66, 5);
		expect(countSharedOnce(result, 64 * MIB)).toBe((74 + 67 + 66 + 5 - 2 * 64) * MIB);
	});

	it("keeps the browser's figure without a shared memory, or with one thread that holds it", () => {
		const result = measurement(74, 5);
		expect(countSharedOnce(result, 0)).toBe(result.bytes);
		expect(countSharedOnce(result, 64 * MIB)).toBe(result.bytes);
		expect(countSharedOnce(measurement(3, 5), 64 * MIB)).toBe(8 * MIB);
	});
});

describe('PageMemorySampler', () => {
	const real = Object.getOwnPropertyDescriptor(performance, 'measureUserAgentSpecificMemory');
	afterEach(() => {
		jest.useRealTimers();
		resetPageMeasurement();
		if (real) Object.defineProperty(performance, 'measureUserAgentSpecificMemory', real);
		else
			delete (performance as { measureUserAgentSpecificMemory?: unknown })
				.measureUserAgentSpecificMemory;
	});

	it('gives no figures where the browser has no measurement', () => {
		delete (performance as { measureUserAgentSpecificMemory?: unknown })
			.measureUserAgentSpecificMemory;
		const sampler = new PageMemorySampler(() => 64 * MIB);
		sampler.start();
		expect(PageMemorySampler.supported).toBe(false);
		expect(sampler.page).toBeNull();
	});

	it("measures, and gives the corrected figure beside the browser's own", async () => {
		const result = measurement(74, 67, 5);
		let calls = 0;
		Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
			configurable: true,
			value: () => {
				calls++;
				return Promise.resolve(result);
			},
		});
		const heard: number[] = [];
		const sampler = new PageMemorySampler(
			() => 64 * MIB,
			(sample) => heard.push(sample.bytes),
		);
		sampler.start();
		// Before the first measurement ends, the figures are still unknown.
		expect(sampler.page).toEqual({ bytes: null, browserBytes: null });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sampler.page).toEqual({ bytes: (74 + 67 + 5 - 64) * MIB, browserBytes: result.bytes });
		expect(heard).toEqual([result.bytes]);
		sampler.stop();
		expect(calls).toBe(1);
	});

	it('names why the browser refused a measurement', async () => {
		Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
			configurable: true,
			value: () => Promise.reject(new Error('the page is not cross-origin isolated')),
		});
		const sampler = new PageMemorySampler();
		sampler.start();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sampler.failure).toBe(
			'the browser refused the measurement: the page is not cross-origin isolated',
		);
	});

	it('counts a measurement that throws at once as a refusal', async () => {
		Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
			configurable: true,
			value: () => {
				throw new Error('performance.measureUserAgentSpecificMemory is not available.');
			},
		});
		const sampler = new PageMemorySampler();
		sampler.start();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sampler.failure).toBe(
			'the browser refused the measurement: performance.measureUserAgentSpecificMemory is not available.',
		);
		expect(sampler.page).toBeNull();
	});

	/**
	 * Gives the page a measurement that answers only when the test says so, and counts its
	 * requests.
	 */
	function heldMeasurement() {
		const held = { calls: 0, answer: (_: MemoryMeasurement) => {} };
		Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
			configurable: true,
			value: () => {
				held.calls++;
				return new Promise<MemoryMeasurement>((resolve) => {
					held.answer = resolve;
				});
			},
		});
		return held;
	}

	it('stops asking and hides the figures when the browser never answers the first request', () => {
		jest.useFakeTimers();
		const held = heldMeasurement();
		const sampler = new PageMemorySampler();
		sampler.start();
		expect(sampler.page).toEqual({ bytes: null, browserBytes: null });
		jest.advanceTimersByTime(FIRST_ANSWER_LIMIT_MS - 1);
		expect(sampler.page).toEqual({ bytes: null, browserBytes: null });
		jest.advanceTimersByTime(1);
		expect(sampler.page).toBeNull();
		// No request follows, even from a sampler that starts again or a new one.
		sampler.stop();
		sampler.start();
		new PageMemorySampler().start();
		jest.advanceTimersByTime(10 * FIRST_ANSWER_LIMIT_MS);
		expect(held.calls).toBe(1);
		expect(sampler.page).toBeNull();
	});

	it('shows an answer that comes after the page stopped asking, and asks no more', async () => {
		jest.useFakeTimers();
		const held = heldMeasurement();
		const sampler = new PageMemorySampler();
		sampler.start();
		jest.advanceTimersByTime(FIRST_ANSWER_LIMIT_MS);
		expect(sampler.page).toBeNull();
		const result = measurement(30);
		held.answer(result);
		await Promise.resolve();
		expect(sampler.page).toEqual({ bytes: result.bytes, browserBytes: result.bytes });
		jest.advanceTimersByTime(10 * FIRST_ANSWER_LIMIT_MS);
		expect(held.calls).toBe(1);
	});

	it('keeps one request in flight while samplers stop, start and join it', async () => {
		jest.useFakeTimers();
		const held = heldMeasurement();
		const first = new PageMemorySampler();
		const second = new PageMemorySampler();
		first.start();
		first.stop();
		first.start();
		second.start();
		expect(held.calls).toBe(1);
		// The answer reaches both, within the limit, and the next request follows a gap later.
		jest.advanceTimersByTime(FIRST_ANSWER_LIMIT_MS / 2);
		const result = measurement(30);
		held.answer(result);
		await Promise.resolve();
		expect(first.page?.browserBytes).toBe(result.bytes);
		expect(second.page?.browserBytes).toBe(result.bytes);
		jest.advanceTimersByTime(FIRST_ANSWER_LIMIT_MS);
		expect(held.calls).toBe(2);
		// A later request that takes longer than the limit hides nothing: the page has an answer.
		jest.advanceTimersByTime(10 * FIRST_ANSWER_LIMIT_MS);
		expect(first.page?.browserBytes).toBe(result.bytes);
		expect(held.calls).toBe(2);
	});
});

describe('MainThreadWindow', () => {
	it('gives no figures where the browser reports no long tasks', () => {
		const watch = new MainThreadWindow();
		expect(watch.take()).toBeNull();
		watch.stop();
	});
});
