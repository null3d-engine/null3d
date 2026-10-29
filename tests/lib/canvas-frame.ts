// Frames read from a page's running engine, for the browser tests that compare pictures. A page
// publishes its engine behind the `?bench` switch, as it does for a benchmark tool, so a test needs
// nothing added to the page to read its frames.
import type { Page } from '@playwright/test';
import { decodePngRgba } from '../../packages/cli/src/png.js';

/**
 * How long a read keeps asking for a canvas that holds still, for a page still finding its size. A
 * page on a software GPU can take most of a minute to draw its first frame, and until it does the
 * canvas keeps the browser's default size, so a read before that frame finds nothing to take. One
 * showcase page measured its first frame at 55 seconds on CI's software GPU.
 */
const SETTLE_READ_MS = 90_000;
/**
 * How old the last laid-out frame may be when a read gives up on a size that holds. The engine hands
 * back the frame it drew last when no new one comes, so a page that stopped and one that keeps
 * drawing look alike here; what this bounds is the read's own staleness, so a canvas that has held
 * nothing the page laid out for the last part of the budget is refused rather than read.
 */
const STALE_FRAME_MS = 2_000;
/**
 * The canvas a browser makes when a page has not sized one. A read that gets this size has caught a
 * page before its layout, whatever pixels it holds, so the read keeps waiting.
 */
const DEFAULT_CANVAS = { width: 300, height: 150 };

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
 * canvas, so the read waits for a frame of the page's own size. It prefers one that holds that size
 * across two reads, since a page still laying out changes its canvas between them, but a page that
 * keeps changing its size still draws frames: the read then gives the last of them, and a picture
 * compared against a frame of another size names the two sizes rather than failing on the read.
 */
export async function readFrame(page: Page): Promise<Frame> {
	const deadline = Date.now() + SETTLE_READ_MS;
	let previous: Frame | null = null;
	/** The last frame the page had laid out, in case it never holds one size. */
	let drawn: Frame | null = null;
	/** When that frame was read, so a page that stopped drawing is not read as one that moves. */
	let drawnAt = 0;
	/** The sizes read, for a read that finds none it can use. */
	const seen: string[] = [];
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
		seen.push(frame.data.length === 0 ? 'no pixels' : `${frame.width} by ${frame.height}`);
		if (seen.length > 8) seen.shift();
		// A fractional layout rounds the canvas's height differently from read to read, so a page
		// that has settled can still move by a pixel; the read waits for the size to hold within one.
		const laidOut =
			frame.data.length > 0 &&
			!(frame.width === DEFAULT_CANVAS.width && frame.height === DEFAULT_CANVAS.height);
		if (laidOut) {
			if (
				previous !== null &&
				Math.abs(previous.width - frame.width) <= 1 &&
				Math.abs(previous.height - frame.height) <= 1
			)
				return frame;
			previous = frame;
			drawn = frame;
			drawnAt = Date.now();
		}
		if (Date.now() >= deadline) {
			// A page whose canvas changes size keeps drawing frames all the same. Hand back the last
			// one, since a picture compared against a frame of another size names the two sizes,
			// which tells a reader more than a read that gave up. A frame the recent reads never
			// laid out is not that: it would put an old picture behind a canvas that is moving.
			if (drawn !== null && Date.now() - drawnAt <= STALE_FRAME_MS) {
				console.log(
					`canvas read for ${SETTLE_READ_MS} ms without a size that held, so it gives a frame read ${Date.now() - drawnAt} ms ago: ${seen.join(', ')}`,
				);
				return drawn;
			}
			throw new Error(
				`the canvas held no frame the page had laid out in ${SETTLE_READ_MS} ms: ${seen.join(', ')}`,
			);
		}
		// A read of the browser's default canvas says nothing about the page's size, and a page still
		// laying out changes it, so the read keeps asking.
		await page.waitForTimeout(50);
	}
}

/**
 * The mean difference of two frames' colour, in steps of 255, over every pixel and channel. A frame
 * with no pixels has no difference to give, so it is an error rather than a figure.
 *
 * Two frames a pixel apart in size are compared over the part they share. A fractional layout rounds
 * a canvas's height differently from read to read, so a settled page can hand back 640 by 319 after
 * 640 by 320, and refusing that pair would fail on the layout rather than on the picture. Anything
 * wider apart is a resize, and its frames are an error: comparing a shorter frame against a prefix of
 * a longer one is not a difference at all.
 */
export function frameDifference(a: Frame, b: Frame): number {
	if (a.data.length === 0 || b.data.length === 0)
		throw new Error(
			`a frame holds no pixels: ${a.width} by ${a.height} against ${b.width} by ${b.height}`,
		);
	const width = Math.min(a.width, b.width);
	const height = Math.min(a.height, b.height);
	if (Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1)
		throw new Error(
			`the frames differ in size: ${a.width} by ${a.height} against ${b.width} by ${b.height}`,
		);
	let sum = 0;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * a.width + x) * 4;
			const j = (y * b.width + x) * 4;
			for (let c = 0; c < 3; c++)
				sum += Math.abs((a.data[i + c] as number) - (b.data[j + c] as number));
		}
	return sum / (width * height * 3);
}
