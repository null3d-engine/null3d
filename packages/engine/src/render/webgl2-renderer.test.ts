import { describe, expect, it } from 'bun:test';
import type { CoreDevice } from '../page/limits';
import type { RenderCanvas } from './renderer';
import { createRenderer } from './webgl2-renderer';

type ContextRequest = { type: string; settings: unknown };

/**
 * A canvas that records each request for a context. Like a browser's canvas, it keeps the first
 * request's context, whose settings later requests cannot change.
 */
function fakeCanvas(): { canvas: RenderCanvas; requests: ContextRequest[] } {
	const requests: ContextRequest[] = [];
	let context: object | undefined;
	const canvas = {
		width: 300,
		height: 150,
		addEventListener() {},
		removeEventListener() {},
		getContext(type: string, settings?: unknown) {
			requests.push({ type, settings });
			context ??= { canvas, isContextLost: () => false };
			return context;
		},
	};
	return { canvas: canvas as unknown as RenderCanvas, requests };
}

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
					depth: false,
					stencil: false,
					powerPreference: 'low-power',
				},
			},
		]);
	});
});
