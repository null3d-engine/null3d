import { describe, expect, it } from 'bun:test';
import { LoadMeter, LoadPhases, reportLoading, StartMeter } from './progress';

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
				data: {
					text: 'Downloading scene files',
					kind: 'files',
					detail: '2.0 MB of 8.0 MB',
					value: 0.25,
				},
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

describe('LoadPhases', () => {
	it('holds one phase per lane, and a new phase ends the one it replaces', () => {
		const phases = new LoadPhases();
		expect(phases.list()).toEqual([]);
		phases.show('engine', { key: 'engine-download', text: 'Downloading the engine' });
		phases.show('engine', { key: 'core', text: 'Starting the engine' });
		expect(phases.list()).toEqual([
			{ lane: 'engine', phase: { key: 'core', text: 'Starting the engine' } },
		]);
	});

	it('keeps a phase of each lane, drawn in lane order', () => {
		const phases = new LoadPhases();
		phases.show('scene', { key: 'text:Building', text: 'Building the studio' });
		phases.show('files', { key: 'files:Downloading', text: 'Downloading scene files' });
		phases.show('engine', { key: 'workers', text: 'Starting the workers' });
		expect(phases.list()).toEqual([
			{ lane: 'engine', phase: { key: 'workers', text: 'Starting the workers' } },
			{ lane: 'files', phase: { key: 'files:Downloading', text: 'Downloading scene files' } },
			{ lane: 'scene', phase: { key: 'text:Building', text: 'Building the studio' } },
		]);
	});

	it('ends a lane phase when its work is over', () => {
		const phases = new LoadPhases();
		phases.show('engine', { key: 'core', text: 'Starting the engine' });
		phases.show('scene', { key: 'build', text: 'Building the scene', value: 0.5 });
		phases.clear('scene');
		expect(phases.list()).toEqual([
			{ lane: 'engine', phase: { key: 'core', text: 'Starting the engine' } },
		]);
	});
});

describe('StartMeter', () => {
	it('fills a fixed share for each counted stretch of the start', () => {
		const meter = new StartMeter();
		expect(meter.value(0)).toBe(0);
		meter.engine(0.5);
		expect(meter.value(0)).toBeCloseTo(0.1, 5);
		meter.engine(1);
		expect(meter.value(0)).toBeCloseTo(0.2, 5);
		meter.files(0.5);
		expect(meter.value(0)).toBeCloseTo(0.575, 5);
		meter.build(1);
		expect(meter.value(0)).toBeCloseTo(0.98, 5);
	});

	it('never falls when a growing total makes the counted share smaller', () => {
		const meter = new StartMeter();
		meter.files(0.8);
		expect(meter.value(0)).toBeCloseTo(0.71, 5);
		meter.files(0.2);
		expect(meter.value(0)).toBeCloseTo(0.71, 5);
	});

	it('eases through work without a count, and holds below a whole bar', () => {
		const meter = new StartMeter();
		meter.begin(0);
		expect(meter.value(0)).toBeCloseTo(0, 5);
		meter.core(0);
		expect(meter.value(0)).toBeCloseTo(0, 5);
		expect(meter.value(2600)).toBeGreaterThan(0.2);
		expect(meter.value(2600)).toBeLessThan(0.45);
		expect(meter.moving(2600)).toBe(true);
		expect(meter.value(100_000)).toBeCloseTo(0.45, 3);
		expect(meter.moving(100_000)).toBe(false);
	});

	it('keeps easing after a counted stretch ends, until the next count or the frame', () => {
		const meter = new StartMeter();
		meter.files(1, 0);
		expect(meter.value(0)).toBeCloseTo(0.8, 5);
		expect(meter.value(100_000)).toBeCloseTo(0.9, 3);
		meter.build(1, 0);
		expect(meter.value(100_000)).toBeCloseTo(0.99, 3);
	});

	it('counts the first frame as a whole bar', () => {
		const meter = new StartMeter();
		meter.begin(0);
		meter.finish();
		expect(meter.value(0)).toBe(1);
		expect(meter.moving(0)).toBe(false);
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
