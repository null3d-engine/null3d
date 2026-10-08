import { afterEach, describe, expect, it } from 'bun:test';
import { countSharedOnce, type MemoryMeasurement, PageMemorySampler } from './page-memory';

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
});
