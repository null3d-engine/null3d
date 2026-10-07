import { afterEach, describe, expect, it } from 'bun:test';
import type { WorkerProbe } from '../workers/probe-worker';
import { probeFloatTarget, probeWorker } from './capabilities';

const GL = {
	TEXTURE_2D: 0x0de1,
	FRAMEBUFFER: 0x8d40,
	COLOR_ATTACHMENT0: 0x8ce0,
	FRAMEBUFFER_COMPLETE: 0x8cd5,
	FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8cd6,
	COLOR_BUFFER_BIT: 0x4000,
	RGBA: 0x1908,
	FLOAT: 0x1406,
	RGBA16F: 0x881a,
	RENDERBUFFER: 0x8d41,
	SAMPLES: 0x80a9,
	NO_ERROR: 0,
	INVALID_ENUM: 0x0500,
	INVALID_OPERATION: 0x0502,
};

interface Device {
	/** Whether the framebuffer with the float texture is complete. */
	complete: boolean;
	/** What the texture stores of a cleared value. */
	stores?: (value: number) => number;
	/** The browser refuses to read the pixel back. */
	refusesRead?: boolean;
	/** The browser throws when the texture's storage is made. */
	throws?: boolean;
	/** The sample counts that renderbuffers of the format take, the most first. */
	samples?: number[];
}

/** A WebGL2 context that renders into a float texture as a device might, and the calls it saw. */
function fakeContext(device: Device) {
	const calls: string[] = [];
	const errors: number[] = [];
	let stored: number[] = [];
	const gl = {
		...GL,
		createTexture: () => ({}),
		createFramebuffer: () => ({}),
		bindTexture: () => {},
		texStorage2D: () => {
			if (device.throws) throw new Error('not supported');
		},
		bindFramebuffer: (_target: number, framebuffer: object | null) => {
			calls.push(framebuffer ? 'bind' : 'unbind');
		},
		framebufferTexture2D: () => {},
		checkFramebufferStatus: () =>
			device.complete ? GL.FRAMEBUFFER_COMPLETE : GL.FRAMEBUFFER_INCOMPLETE_ATTACHMENT,
		clearColor: (...color: number[]) => {
			stored = color.map(device.stores ?? ((value) => value));
		},
		clear: () => calls.push('clear'),
		readPixels: (...args: unknown[]) => {
			calls.push('read');
			if (device.refusesRead) errors.push(GL.INVALID_ENUM, GL.INVALID_OPERATION);
			else (args[6] as Float32Array).set(stored);
		},
		getError: () => errors.shift() ?? GL.NO_ERROR,
		getInternalformatParameter: (target: number, _format: number, name: number) => {
			calls.push('samples');
			if (target !== GL.RENDERBUFFER || name !== GL.SAMPLES) throw new Error('unknown query');
			return new Int32Array(device.samples ?? [8, 4, 2]);
		},
		deleteFramebuffer: () => calls.push('delete framebuffer'),
		deleteTexture: () => calls.push('delete texture'),
	};
	return { gl: gl as unknown as WebGL2RenderingContext, calls, errors };
}

const CLEAN_UP = ['unbind', 'delete framebuffer', 'delete texture'];

describe('the float render target test', () => {
	it('passes a texture that renders and reads back, and deletes what it made', () => {
		const { gl, calls } = fakeContext({ complete: true });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({
			complete: true,
			readsBack: true,
			samples: 8,
		});
		expect(calls).toEqual(['bind', 'clear', 'read', 'samples', ...CLEAN_UP]);
	});

	it('neither clears nor reads an incomplete framebuffer', () => {
		const { gl, calls } = fakeContext({ complete: false });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({
			complete: false,
			readsBack: false,
			samples: 0,
		});
		expect(calls).toEqual(['bind', ...CLEAN_UP]);
	});

	it('reports a format that takes no antialiasing samples as 0', () => {
		const { gl } = fakeContext({ complete: true, samples: [] });
		expect(probeFloatTarget(gl, GL.RGBA16F).samples).toBe(0);
	});

	it('fails the readback of a texture that clamps values above 1', () => {
		const { gl } = fakeContext({ complete: true, stores: (value) => Math.min(value, 1) });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toMatchObject({ complete: true, readsBack: false });
	});

	it('fails a readback the browser refuses, and leaves no error behind', () => {
		const { gl, errors } = fakeContext({ complete: true, refusesRead: true });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toMatchObject({ complete: true, readsBack: false });
		expect(errors).toEqual([]);
	});

	it('fails a format whose texture the browser refuses to make', () => {
		const { gl, calls } = fakeContext({ complete: true, throws: true });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({
			complete: false,
			readsBack: false,
			samples: 0,
		});
		expect(calls).toEqual(CLEAN_UP);
	});
});

/** What each fake probe worker does, in the order the page starts them. */
type ProbeBehavior = 'stalls' | 'answers' | 'fails';

const ANSWER: WorkerProbe = {
	requestAnimationFrame: true,
	offscreenWebGL2: true,
	offscreenWebGPU: false,
};

/** What the fake probe workers do, in the order the page starts them, and how many it handled. */
const probes = { behaviors: [] as ProbeBehavior[], started: 0, terminated: 0 };

/**
 * A probe worker that acts as the next of `probes.behaviors` says. The engine's worker starter keeps
 * the first `Worker` class it wraps, so one class serves every test.
 */
class FakeProbeWorker {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: { message: string }) => void) | null = null;
	constructor() {
		const behavior = probes.behaviors[probes.started++] ?? 'stalls';
		setTimeout(() => {
			if (behavior === 'fails') return this.onerror?.({ message: 'the script did not load' });
			this.onmessage?.({ data: 'loaded' });
			if (behavior === 'answers') this.onmessage?.({ data: ANSWER });
		}, 0);
	}
	terminate() {
		probes.terminated++;
	}
}

/** Makes the next probe workers act as `behaviors` say, in turn. */
function fakeProbeWorkers(behaviors: ProbeBehavior[]): typeof probes {
	Object.assign(probes, { behaviors, started: 0, terminated: 0 });
	globalThis.Worker = FakeProbeWorker as unknown as typeof Worker;
	return probes;
}

describe('the worker probe', () => {
	const Native = globalThis.Worker;
	afterEach(() => {
		globalThis.Worker = Native;
	});

	it('starts a second worker, with the next time limit, when the first gives no answer', async () => {
		const counts = fakeProbeWorkers(['stalls', 'answers']);
		expect(await probeWorker([10, 50])).toEqual(ANSWER);
		expect(counts).toMatchObject({ started: 2, terminated: 2 });
	});

	it('reports no answer, with every time limit, when no worker answers', async () => {
		const counts = fakeProbeWorkers(['stalls', 'stalls']);
		expect(await probeWorker([10, 20])).toEqual({
			failure: 'no-answer',
			error: 'no probe worker answered within its time limit (0.01 s, then 0.02 s)',
		});
		expect(counts).toMatchObject({ started: 2, terminated: 2 });
	});

	it('tries no second worker when the first fails to start', async () => {
		const counts = fakeProbeWorkers(['fails', 'answers']);
		expect(await probeWorker([10, 20])).toEqual({
			failure: 'failed-to-start',
			error: 'the script did not load',
		});
		expect(counts).toMatchObject({ started: 1, terminated: 1 });
	});
});
