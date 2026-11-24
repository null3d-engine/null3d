import { describe, expect, test } from 'bun:test';
import { importOnce } from './import-once';

describe('importOnce', () => {
	test('loads once for every caller, and the callers go on in the order they called', async () => {
		let loads = 0;
		let finish: (value: string) => void = () => {};
		const load = importOnce(() => {
			loads++;
			return new Promise<string>((resolve) => {
				finish = resolve;
			});
		});
		const order: number[] = [];
		const callers = [1, 2, 3, 4].map(async (caller) => {
			await load();
			order.push(caller);
		});
		finish('module');
		await Promise.all(callers);
		expect(loads).toBe(1);
		expect(order).toEqual([1, 2, 3, 4]);
	});

	test('forgets a load that failed, so the next call tries again', async () => {
		let loads = 0;
		const load = importOnce(async () => {
			loads++;
			if (loads === 1) throw new Error('offline');
			return 'module';
		});
		await expect(load()).rejects.toThrow('offline');
		expect(await load()).toBe('module');
		expect(await load()).toBe('module');
		expect(loads).toBe(2);
	});
});
