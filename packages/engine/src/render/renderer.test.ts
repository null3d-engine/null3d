import { describe, expect, it } from 'bun:test';
import { FORMAT_RG11B10_UFLOAT, PERMUTATION_HALF } from '../generated/gpu';
import { releaseContext } from '../gpu/webgl2/context';
import type { CoreDevice } from '../page/limits';
import { createRenderer, type RenderCanvas } from './renderer';

type ContextRequest = { type: string; settings: unknown };

/**
 * A canvas that records each request for a context. Like a browser's canvas, it keeps the first
 * request's context, whose settings later requests cannot change. `loseContext` and
 * `restoreContext` act out a loss as a browser does: the context counts as lost at once, and the
 * event follows. The context's `WEBGL_lose_context` acts as a browser's does: its loss event runs
 * in a later task, and a restore works only after that event ran and was cancelled.
 */
function fakeCanvas() {
	const requests: ContextRequest[] = [];
	let lost = false;
	let restorable = false;
	const canvas = Object.assign(new EventTarget(), {
		width: 300,
		height: 150,
		getContext(type: string, settings?: unknown) {
			requests.push({ type, settings });
			return context;
		},
	});
	const extension = {
		loseContext() {
			lost = true;
			setTimeout(() => {
				const event = new Event('webglcontextlost', { cancelable: true });
				canvas.dispatchEvent(event);
				restorable = event.defaultPrevented;
			}, 0);
		},
		restoreContext() {
			if (!lost || !restorable) return;
			restorable = false;
			setTimeout(() => {
				lost = false;
				canvas.dispatchEvent(new Event('webglcontextrestored'));
			}, 0);
		},
	};
	const context = {
		canvas,
		isContextLost: () => lost,
		// A lost context has no extensions.
		getExtension: (name: string) => (name === 'WEBGL_lose_context' && !lost ? extension : null),
	};
	return {
		canvas: canvas as unknown as RenderCanvas,
		requests,
		/** Loses the context, and returns the loss event, which a listener may cancel. */
		loseContext() {
			lost = true;
			const event = new Event('webglcontextlost', { cancelable: true });
			canvas.dispatchEvent(event);
			return event;
		},
		restoreContext() {
			lost = false;
			canvas.dispatchEvent(new Event('webglcontextrestored'));
		},
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the WebGL2 renderer', () => {
	it('asks the canvas for its context once, with the engine settings, before anything else', async () => {
		const { canvas, requests } = fakeCanvas();
		const renderer = await createRenderer(canvas, {
			tier: 'webgl2',
			device: {} as CoreDevice,
			powerPreference: 'low-power',
		});
		expect(renderer.tier).toBe('webgl2');
		expect(requests).toEqual([
			{
				type: 'webgl2',
				settings: {
					antialias: false,
					alpha: false,
					premultipliedAlpha: true,
					depth: false,
					stencil: false,
					powerPreference: 'low-power',
				},
			},
		]);
	});

	it('asks for alpha on a transparent canvas', async () => {
		const { canvas, requests } = fakeCanvas();
		await createRenderer(canvas, {
			tier: 'webgl2',
			device: { transparent: true } as CoreDevice,
		});
		expect(requests[0]?.settings).toMatchObject({ alpha: true, premultipliedAlpha: true });
	});

	it('keeps a context lost while it starts, waits for it to come back, and hears only later losses', async () => {
		const { canvas, loseContext, restoreContext } = fakeCanvas();
		const starting = createRenderer(canvas, { tier: 'webgl2', device: {} as CoreDevice });
		let started = false;
		void starting.then(() => {
			started = true;
		});
		// Without a cancelled loss event, the browser never offers the context back.
		expect(loseContext().defaultPrevented).toBe(true);
		await settle();
		expect(started).toBe(false);
		restoreContext();
		const renderer = await starting;
		let heard = false;
		void renderer.lost.then(() => {
			heard = true;
		});
		await settle();
		expect(heard).toBe(false);
		expect(loseContext().defaultPrevented).toBe(true);
		await settle();
		expect(heard).toBe(true);
	});

	it('gives the context up when destroyed, and a later renderer on the canvas takes it back', async () => {
		const { canvas } = fakeCanvas();
		const options = { tier: 'webgl2', device: {} as CoreDevice } as const;
		const first = await createRenderer(canvas, options);
		let heard = false;
		void first.lost.then(() => {
			heard = true;
		});
		first.destroy();
		const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
		expect(gl.isContextLost()).toBe(true);
		const second = await createRenderer(canvas, options);
		expect(gl.isContextLost()).toBe(false);
		// The first renderer gave the context up itself, so it heard no loss.
		expect(heard).toBe(false);
		second.destroy();
		expect(gl.isContextLost()).toBe(true);
	});

	it('gives up the canvas own context when the renderer drew through a wrapper of it', async () => {
		const { canvas } = fakeCanvas();
		const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
		// A stand-in like call timing's: it reads the canvas, and its extensions are its own.
		releaseContext({ canvas, getExtension: () => null } as unknown as WebGL2RenderingContext);
		expect(gl.isContextLost()).toBe(true);
		await createRenderer(canvas, { tier: 'webgl2', device: {} as CoreDevice });
		expect(gl.isContextLost()).toBe(false);
	});
});

describe('the WebGPU renderer', () => {
	/** Gives the thread a WebGPU adapter with `features`, and lists the features each device asks for. */
	function fakeGpu(features: string[]) {
		const requests: string[][] = [];
		const adapter = {
			features: new Set(features),
			async requestDevice(descriptor: GPUDeviceDescriptor) {
				requests.push([...(descriptor.requiredFeatures ?? [])]);
				throw new Error('the fake adapter makes no device');
			},
		};
		const scope = navigator as { gpu?: unknown };
		const before = scope.gpu;
		Object.defineProperty(navigator, 'gpu', {
			configurable: true,
			value: { requestAdapter: async () => adapter },
		});
		const restore = () =>
			Object.defineProperty(navigator, 'gpu', { configurable: true, value: before });
		return { requests, restore };
	}

	for (const [feature, device] of [
		['shader-f16', { shaderBits: PERMUTATION_HALF }],
		['rg11b10ufloat-renderable', { shaderBits: 0, effectsSceneColor: FORMAT_RG11B10_UFLOAT }],
	] as const) {
		it(`fails with a clear message when the adapter lacks ${feature}, which the engine chose`, async () => {
			const { requests, restore } = fakeGpu(['core-features-and-limits']);
			try {
				const options = {
					tier: 'webgpu' as const,
					device: { capabilities: 0, storageBindingBytes: 1 << 27, ...device } as CoreDevice,
				};
				await expect(createRenderer(fakeCanvas().canvas, options)).rejects.toThrow(
					`the GPU adapter lacks the WebGPU feature ${feature}`,
				);
				expect(requests).toEqual([]);
			} finally {
				restore();
			}
		});
	}
});
