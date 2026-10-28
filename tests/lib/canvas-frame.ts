// Frames read from a page's running engine, for the browser tests that compare pictures. A page
// publishes its engine behind the `?bench` switch, as it does for a benchmark tool, so a test needs
// nothing added to the page to read its frames.
import type { Page } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';

/** How long a read waits for the canvas to hold pixels, for a page still finding its size. */
const EMPTY_READ_MS = 10_000;

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
 *
 * A page that has not sized its canvas yet captures nothing, or captures the browser's default
 * canvas, so the read waits until two captures in a row report the same size. A page still laying
 * out changes its canvas between reads; a settled one does not.
 */
export async function readFrame(page: Page): Promise<Frame> {
	const deadline = Date.now() + EMPTY_READ_MS;
	let previous: Frame | null = null;
	for (;;) {
		const base64 = await page.evaluate(async () => {
			const engine = (globalThis as { __null3dEngine?: { capture(): Promise<Blob> } })
				.__null3dEngine;
			if (!engine)
				throw new Error('the page publishes its engine behind ?bench, and it has not started one');
			const bytes = new Uint8Array(await (await engine.capture()).arrayBuffer());
			let text = '';
			// Each chunk keeps the argument count of fromCharCode inside its own limit.
			for (let at = 0; at < bytes.length; at += 0x8000)
				text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
			return btoa(text);
		});
		const frame = decodePngRgba(Buffer.from(base64, 'base64'), 'the canvas');
		// A fractional layout rounds the canvas's height differently from read to read, so a page
		// that has settled can still move by a pixel; the read waits for the size to hold within one.
		if (
			frame.data.length > 0 &&
			previous !== null &&
			Math.abs(previous.width - frame.width) <= 1 &&
			Math.abs(previous.height - frame.height) <= 1
		)
			return frame;
		if (Date.now() >= deadline)
			throw new Error(
				frame.data.length === 0
					? `the canvas held no pixels for ${EMPTY_READ_MS} ms`
					: `the canvas kept changing size for ${EMPTY_READ_MS} ms, last ${frame.width} by ${frame.height}`,
			);
		previous = frame;
		await page.waitForTimeout(50);
	}
}

/**
 * The mean difference of two frames' colour, in steps of 255, over every pixel and channel. A frame
 * with no pixels, or two frames of different sizes, have no difference to give, so they are an error
 * rather than a figure: a canvas that resized between the two reads would otherwise compare the
 * shorter frame's pixels against a prefix of the longer one.
 */
export function frameDifference(a: Frame, b: Frame): number {
	if (a.data.length === 0 || b.data.length === 0)
		throw new Error(
			`a frame holds no pixels: ${a.width} by ${a.height} against ${b.width} by ${b.height}`,
		);
	if (a.data.length !== b.data.length)
		throw new Error(
			`the frames differ in size: ${a.width} by ${a.height} against ${b.width} by ${b.height}`,
		);
	let sum = 0;
	for (let i = 0; i < a.data.length; i += 4)
		for (let c = 0; c < 3; c++)
			sum += Math.abs((a.data[i + c] as number) - (b.data[i + c] as number));
	return sum / ((a.data.length / 4) * 3);
}
