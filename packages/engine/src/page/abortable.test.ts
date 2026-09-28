import { describe, expect, it } from 'bun:test';
import { abortable } from './abortable';

describe('abortable', () => {
	it('settles as the promise does without a signal, or before the signal aborts', async () => {
		expect(await abortable(Promise.resolve(1), undefined)).toBe(1);
		expect(await abortable(Promise.resolve(2), new AbortController().signal)).toBe(2);
		await expect(
			abortable(Promise.reject(new Error('no')), new AbortController().signal),
		).rejects.toThrow('no');
	});

	it("rejects with the signal's reason when it aborts first, or had already aborted", async () => {
		const controller = new AbortController();
		const pending = abortable(new Promise(() => {}), controller.signal);
		controller.abort(new Error('left the page'));
		await expect(pending).rejects.toThrow('left the page');
		await expect(abortable(Promise.resolve(3), controller.signal)).rejects.toThrow('left the page');
	});
});
