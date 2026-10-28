// Frames read from a page's running engine, for the browser tests that compare pictures. A page
// publishes its engine behind the `?bench` switch, as it does for a benchmark tool, so a test needs
// nothing added to the page to read its frames.
import type { Page } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';

/** One frame of the canvas: its size and its RGBA pixels, top row first. */
export interface Frame {
	width: number;
	height: number;
	data: Uint8Array;
}

/**
 * The canvas as the scene draws it, read through the demo's engine: the canvas exactly, at its own
 * size, and the page's own elements, such as the controls panel, the toast, the caption and the
 * stats overlay, are not in it.
 *
 * A browser screenshot cannot serve here. Both ways of taking one wait on the browser's own frame
 * work: an element's picture waits for its box to hold still across two of the page's animation
 * frames, and a page picture waits on the compositor for a frame to capture. A software GPU busy with
 * several demos starves both, for the whole of a test's budget. The engine's own reader instead waits
 * on the engine's frame loop, which keeps its turn, and gives the frame drawn last when no new frame
 * comes: measured here, one read took 17 ms where the screenshots ran the test out.
 */
export async function readFrame(page: Page): Promise<Frame> {
	const base64 = await page.evaluate(async () => {
		const engine = (globalThis as { __null3dEngine?: { capture(): Promise<Blob> } }).__null3dEngine;
		if (!engine)
			throw new Error('the page publishes its engine behind ?bench, and it has not started one');
		const bytes = new Uint8Array(await (await engine.capture()).arrayBuffer());
		let text = '';
		// Each chunk keeps the argument count of fromCharCode inside its own limit.
		for (let at = 0; at < bytes.length; at += 0x8000)
			text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
		return btoa(text);
	});
	return decodePngRgba(Buffer.from(base64, 'base64'), 'the canvas');
}

/** The mean difference of two frames' colour, in steps of 255, over every pixel and channel. */
export function frameDifference(a: Frame, b: Frame): number {
	let sum = 0;
	for (let i = 0; i < a.data.length; i += 4)
		for (let c = 0; c < 3; c++)
			sum += Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
	return sum / ((a.data.length / 4) * 3);
}
