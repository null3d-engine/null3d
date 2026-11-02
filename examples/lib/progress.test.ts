import { describe, expect, it } from 'bun:test';
import { LoadMeter, reportLoading } from './progress';

describe('reportLoading', () => {
	/** The messages that a scene posts, driven by the assets progress that it registers. */
	function scene() {
		const posted: { name: string; data: unknown }[] = [];
		let handler: ((loaded: number, total: number) => void) | undefined;
		reportLoading({
			assets: {
				onProgress: (next: (loaded: number, total: number) => void) => {
					handler = next;
					return () => {};
				},
			},
			page: { post: (name: string, data: unknown) => posted.push({ name, data }) },
		} as unknown as Parameters<typeof reportLoading>[0]);
		return { posted, send: (loaded: number, total: number) => handler?.(loaded, total) };
	}

	it('posts the bytes that arrived against the bytes that the responses announced', () => {
		const { posted, send } = scene();
		send(2 * 1024 * 1024, 8 * 1024 * 1024);
		expect(posted).toEqual([
			{
				name: 'loading',
				data: { text: 'Downloading scene files', detail: '2.0 MB of 8.0 MB', value: 0.25 },
			},
		]);
	});

	it('posts a count without a fraction while no response has announced a length', () => {
		const { posted, send } = scene();
		send(640 * 1024, 0);
		const data = posted[0]?.data as { value?: number; detail?: string };
		expect(data.value).toBeUndefined();
		expect(data.detail).toBe('640 KB so far');
	});
});

describe('LoadMeter', () => {
	it('rounds a phase to the whole percent that a card shows', () => {
		const meter = new LoadMeter();
		expect(meter.show({ key: 'files', text: 'Files', value: 0.004 }).value).toBe(0);
		expect(meter.show({ key: 'files', text: 'Files', value: 0.335 }).value).toBe(0.34);
		expect(meter.show({ key: 'files', text: 'Files', value: 1 }).value).toBe(1);
	});

	it('keeps a phase from falling when more files grow its total', () => {
		const meter = new LoadMeter();
		expect(meter.show({ key: 'files', text: 'Files', value: 0.8 }).value).toBe(0.8);
		// A further file's length arrives, so the bytes so far are a smaller share of the new total.
		expect(meter.show({ key: 'files', text: 'Files', value: 0.42 }).value).toBe(0.8);
		expect(meter.show({ key: 'files', text: 'Files', value: 0.91 }).value).toBe(0.91);
	});

	it('starts a new measure when the phase changes', () => {
		const meter = new LoadMeter();
		expect(meter.show({ key: 'engine', text: 'Engine', value: 1 }).value).toBe(1);
		expect(meter.show({ key: 'files', text: 'Files', value: 0.2 }).value).toBe(0.2);
	});

	it('leaves a phase without a figure indeterminate, and clamps one outside 0 to 1', () => {
		expect(new LoadMeter().show({ key: 'build', text: 'Building' }).value).toBeUndefined();
		expect(
			new LoadMeter().show({ key: 'build', text: 'Building', value: Number.NaN }).value,
		).toBeUndefined();
		expect(new LoadMeter().show({ key: 'build', text: 'Building', value: 2 }).value).toBe(1);
		expect(new LoadMeter().show({ key: 'build', text: 'Building', value: -1 }).value).toBe(0);
	});
});
