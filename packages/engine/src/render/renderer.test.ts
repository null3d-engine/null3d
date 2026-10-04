import { describe, expect, it } from 'bun:test';
import type { CoreDevice } from '../page/limits';
import { createRenderer, type RenderCanvas } from './renderer';

type ContextRequest = { type: string; settings: unknown };

/**
 * A canvas that records each request for a context. Like a browser's canvas, it keeps the first
 * request's context, whose settings later requests cannot change. `loseContext` and
 * `restoreContext` act out a loss as a browser does: the context counts as lost at once, and the
 * event follows.
 */
function fakeCanvas() {
	const requests: ContextRequest[] = [];
	let lost = false;
	const canvas = Object.assign(new EventTarget(), {
		width: 300,
		height: 150,
		getContext(type: string, settings?: unknown) {
			requests.push({ type, settings });
			return context;
		},
	});
	const context = { canvas, isContextLost: () => lost };
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
});
