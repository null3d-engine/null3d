// What both engines' desert pages report beside the protocol's timings, in one shape, so the
// benchmark's summary reads both alike and checks that both drew the same pixels.

import type { DesertView } from '../../scenes/desert';

/** A size in device pixels. */
export interface PixelSize {
	width: number;
	height: number;
}

/** The desert figures of one timed run of one engine's page. */
export interface DesertFigures {
	/** The engine and how it draws, such as `null3d` or `three.js r187 meshlets`. */
	engine: string;
	view: DesertView;
	/** The sun's shadows: null3D's cascades, or 1 for three.js's one map; null without shadows. */
	shadows: number | null;
	/** The size of the image that the engine drew, read back from the engine after the timing. */
	drawn: PixelSize;
	/** The median time between frames, which a browser without its frame cap leaves to the engine. */
	intervalMs: number;
	/** The median GPU time per frame, or null where the browser times no GPU work. */
	gpuMs: number | null;
	/** The median triangles that a frame drew, over every pass. */
	triangles: number | null;
	/**
	 * Draw calls per frame: null3D's median, the count of three.js's last measured frame on its
	 * standard pipeline, and null on its meshlet pipeline, whose draws three.js does not count.
	 */
	drawCalls: number | null;
	/** Milliseconds from the page's start to the engine's first frame. */
	firstFrameMs: number;
	/** Settings that tell how the engine drew, such as the quality preset or the drawing pipeline. */
	settings: Record<string, unknown>;
}
