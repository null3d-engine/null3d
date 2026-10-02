import { describe, expect, it } from 'bun:test';
import { patientFetch } from './patient-fetch.ts';

/** A fetch whose first `lost` requests never answer, as Safari's lost requests do. */
function losingFetch(lost: number) {
	const calls: RequestInit[] = [];
	const get = (_url: string, init: RequestInit) => {
		calls.push(init);
		if (calls.length > lost) return Promise.resolve(new Response('stored', { status: 200 }));
		return new Promise<Response>((_, reject) =>
			init.signal?.addEventListener('abort', () =>
				reject(new DOMException('aborted', 'AbortError')),
			),
		);
	};
	return { calls, get };
}

describe('patientFetch', () => {
	it('sends a request again when the first one never answers', async () => {
		const { calls, get } = losingFetch(1);
		const response = await patientFetch(
			'/__null3d/runs/r/mac-safari/page',
			{ method: 'POST', body: '{}' },
			{ attemptMs: 20, get },
		);
		expect(response).toEqual({ status: 200, ok: true, text: 'stored' });
		expect(calls).toHaveLength(2);
		expect(calls.every((init) => init.method === 'POST' && init.body === '{}')).toBe(true);
	});

	it('fails with the address once every attempt passed its time limit', async () => {
		const { calls, get } = losingFetch(5);
		await expect(patientFetch('/x', {}, { attemptMs: 10, attempts: 3, get })).rejects.toThrow(
			'no answer to /x within 0.01 s, after 3 attempts',
		);
		expect(calls).toHaveLength(3);
	});

	it('fails at once on an error that is not a time limit', async () => {
		let calls = 0;
		const get = () => {
			calls++;
			return Promise.reject(new TypeError('Load failed'));
		};
		await expect(patientFetch('/x', {}, { attemptMs: 10, get })).rejects.toThrow('Load failed');
		expect(calls).toBe(1);
	});
});
