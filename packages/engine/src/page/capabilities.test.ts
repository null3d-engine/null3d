import { describe, expect, it } from 'bun:test';
import { probeFloatTarget } from './capabilities';

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
		deleteFramebuffer: () => calls.push('delete framebuffer'),
		deleteTexture: () => calls.push('delete texture'),
	};
	return { gl: gl as unknown as WebGL2RenderingContext, calls, errors };
}

const CLEAN_UP = ['unbind', 'delete framebuffer', 'delete texture'];

describe('the float render target test', () => {
	it('passes a texture that renders and reads back, and deletes what it made', () => {
		const { gl, calls } = fakeContext({ complete: true });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({ complete: true, readsBack: true });
		expect(calls).toEqual(['bind', 'clear', 'read', ...CLEAN_UP]);
	});

	it('neither clears nor reads an incomplete framebuffer', () => {
		const { gl, calls } = fakeContext({ complete: false });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({ complete: false, readsBack: false });
		expect(calls).toEqual(['bind', ...CLEAN_UP]);
	});

	it('fails the readback of a texture that clamps values above 1', () => {
		const { gl } = fakeContext({ complete: true, stores: (value) => Math.min(value, 1) });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({ complete: true, readsBack: false });
	});

	it('fails a readback the browser refuses, and leaves no error behind', () => {
		const { gl, errors } = fakeContext({ complete: true, refusesRead: true });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({ complete: true, readsBack: false });
		expect(errors).toEqual([]);
	});

	it('fails a format whose texture the browser refuses to make', () => {
		const { gl, calls } = fakeContext({ complete: true, throws: true });
		expect(probeFloatTarget(gl, GL.RGBA16F)).toEqual({ complete: false, readsBack: false });
		expect(calls).toEqual(CLEAN_UP);
	});
});
