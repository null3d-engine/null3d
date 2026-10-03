// The shadow checks: what the shadow check sketch does to a scene, and the figures that the visual
// page, the browser tests and the device runner read from its frames. Each frame is drawn in the
// shadows debug view, where a pixel's gray is the shadow factor: 0 in full shadow, 1 in full light.
//
// - Stability: a still observer camera watches the scene while the scene's own camera, which places
//   the shadow cascades, moves and turns by less than a texel per frame. Nothing in the scene moves,
//   so any pixel whose shadow changes between frames shows cascades that shimmer or crawl.
// - Edges: the same frame against a reference drawn the same way with the largest shadow map and
//   the widest filter. The reference's edges are as smooth as the engine draws them, so how far
//   the frame's edges stray from them measures the steps that coarse texels leave.
// - Stair steps: the position of one long straight shadow edge, row by row, against the straight
//   line through it. Steps of coarse texels move the edge back and forth across the line.

/** The still scene of the shadow checks, `shadow-scene-sketch.ts`. */
export const SHADOW_SCENE = {
	camera: {
		position: [-1, 6, 3] as [number, number, number],
		target: [-1, 0, -14] as [number, number, number],
		fov: 50,
	},
	sun: [-1, -1.2, -0.25] as [number, number, number],
	shadow: { cascades: 3, mapSize: 1024, distance: 60 },
	/** A wall along the view: its center on the ground, its length, height and turn in degrees. */
	wall: { center: [2, -18] as [number, number], length: 24, height: 3, yawDegrees: 8 },
} as const;

/** How the shadow check sketch draws a scene. */
export type ShadowCheck =
	/** The shadows view of the scene's own frame. */
	| 'view'
	/** The shadows view from a still observer, while the scene's camera moves frame by frame. */
	| 'stability'
	/** The shadows view with the reference's shadow map and filter. */
	| 'reference';

/**
 * How far the scene's camera moves in each frame of the stability check: along its view and to its
 * side over the ground, in meters, and its turn about the world's up, in degrees. Each is a fraction
 * of a texel of a near cascade, as a slow walk or a slow turn moves a camera.
 */
export const CHECK_MOTION = { forward: 0.004, side: 0.0025, yawDegrees: 0.03 } as const;
/** The frames of the stability check, at steps of 1/60 s from the scene's held time. */
export const STABILITY_FRAMES = 6;
/** The steps per second of the stability check's frames. */
export const FRAME_RATE = 60;
/** The reference's shadow map, texels on each side: the largest that the engine draws. */
export const REFERENCE_MAP_SIZE = 4096;
/** The reference's filter: the widest square of texels that the engine blends. */
export const REFERENCE_FILTER = 5;
/** The consecutive frames of a moving scene that a visual page captures as PNG files. */
export const MOVING_FRAMES = 4;

/**
 * The change of the shadow factor that counts a pixel as changed between two frames: more than the
 * dithering of the engine's output, 1/255, and well under the change that a moved edge makes.
 */
export const CHANGE_STEP = 8 / 255;
/** The shadow factor of each pixel of a shadows-view frame: its red channel from 0 to 1. */
export function shadowFactors(rgba: Uint8Array): Float32Array {
	const out = new Float32Array(rgba.length / 4);
	for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4] ?? 0) / 255;
	return out;
}

/** The share of pixels, from 0 to 1, whose shadow factor is under one half. */
export function shadowedShare(factors: Float32Array): number {
	let shadowed = 0;
	for (const value of factors) if (value < 0.5) shadowed++;
	return shadowed / Math.max(1, factors.length);
}

/** The share of pixels, from 0 to 1, whose shadow factor changed by more than the change step. */
export function changedShare(before: Float32Array, after: Float32Array): number {
	let changed = 0;
	for (let i = 0; i < before.length; i++)
		if (Math.abs((before[i] ?? 0) - (after[i] ?? 0)) > CHANGE_STEP) changed++;
	return changed / Math.max(1, before.length);
}

/** The stability figures of the frames of a stability check, in order. */
export interface StabilityFigures {
	/** The largest share of pixels, in percent, whose shadow changed from one frame to the next. */
	changedPercent: number;
	/** The mean of that share over each pair of frames, in percent. */
	meanChangedPercent: number;
	/** The share of the first frame's pixels in shadow, in percent. */
	shadowedPercent: number;
}

export function stabilityFigures(frames: readonly Float32Array[]): StabilityFigures {
	const [first] = frames;
	if (!first) throw new Error('the stability check drew no frames');
	const shares = frames.slice(1).map((frame, k) => changedShare(frames[k] as Float32Array, frame));
	return {
		changedPercent: 100 * Math.max(0, ...shares),
		meanChangedPercent: (100 * shares.reduce((sum, s) => sum + s, 0)) / Math.max(1, shares.length),
		shadowedPercent: 100 * shadowedShare(first),
	};
}

/**
 * How far a frame's shadow edges stray from the reference's, in pixels: the pixels on one side of
 * the half-shadow line in one frame and on the other side in the reference, over the length of the
 * reference's line in pixels. A filter blurs an edge evenly to both sides, so it keeps the line
 * where it is, and softer or sharper shadows change the figure little. Coarse texels move the
 * line back and forth in steps, and so does an edge drawn in the wrong place. 0 where the lines
 * match. The frames' size is `width` pixels across.
 */
export function edgeOffset(frame: Float32Array, reference: Float32Array, width: number): number {
	const dark = (values: Float32Array, i: number) => (values[i] ?? 1) < 0.5;
	let apart = 0;
	let line = 0;
	for (let i = 0; i < frame.length; i++) {
		if (dark(frame, i) !== dark(reference, i)) apart++;
		// A pixel of the reference's line: in shadow, beside a pixel in light.
		const x = i % width;
		if (
			dark(reference, i) &&
			((x > 0 && !dark(reference, i - 1)) ||
				(x + 1 < width && !dark(reference, i + 1)) ||
				(i >= width && !dark(reference, i - width)) ||
				(i + width < reference.length && !dark(reference, i + width)))
		)
			line++;
	}
	return line === 0 ? 0 : apart / line;
}

/** A box of a frame's pixels: its first column and row, and the column and row past its last. */
export type PixelBox = readonly [x0: number, y0: number, x1: number, y1: number];

/** The stair-step figures of a shadow edge that crosses each row of a box. */
export interface StairSteps {
	/** The rows where the edge was found. */
	rows: number;
	/** The root mean square of the edge's distance from its straight line, in pixels. */
	rmsPixels: number;
	/** The largest distance of the edge from its straight line, in pixels. */
	maxPixels: number;
}

/**
 * Finds a shadow edge in each row of `box`: the first place, from the left, where the shadow
 * factor crosses one half, between two pixels in proportion to their factors. Then fits a straight
 * line through the places by least squares, and measures how far they stray from it.
 */
export function stairSteps(factors: Float32Array, width: number, box: PixelBox): StairSteps {
	const [x0, y0, x1, y1] = box;
	const ys: number[] = [];
	const xs: number[] = [];
	for (let y = y0; y < y1; y++) {
		const row = y * width;
		for (let x = x0; x + 1 < x1; x++) {
			const [a, b] = [factors[row + x] ?? 0, factors[row + x + 1] ?? 0];
			if ((a - 0.5) * (b - 0.5) > 0 || a === b) continue;
			ys.push(y);
			xs.push(x + (0.5 - a) / (b - a));
			break;
		}
	}
	const n = ys.length;
	if (n < 3) return { rows: n, rmsPixels: 0, maxPixels: 0 };
	const meanY = ys.reduce((s, v) => s + v, 0) / n;
	const meanX = xs.reduce((s, v) => s + v, 0) / n;
	let syy = 0;
	let sxy = 0;
	for (let k = 0; k < n; k++) {
		const dy = (ys[k] as number) - meanY;
		syy += dy * dy;
		sxy += dy * ((xs[k] as number) - meanX);
	}
	const slope = syy === 0 ? 0 : sxy / syy;
	let sum = 0;
	let max = 0;
	for (let k = 0; k < n; k++) {
		const off = Math.abs((xs[k] as number) - (meanX + slope * ((ys[k] as number) - meanY)));
		sum += off * off;
		max = Math.max(max, off);
	}
	return { rows: n, rmsPixels: Math.sqrt(sum / n), maxPixels: max };
}

/** The box of the shadow scene's 480 x 270 frame that the wall's shadow edge crosses. */
export const SHADOW_SCENE_EDGE: PixelBox = [215, 92, 320, 195];
