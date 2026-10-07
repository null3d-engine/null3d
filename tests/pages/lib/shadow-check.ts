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
// - Contact: the light between the foot of each caster and the start of its shadow.
// - Acne: shadow on flat surfaces that the reference lights all around, such as the stripes and
//   rings of self-shadow on a pavement slab's top.

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
	| 'reference'
	/** The normals view of the scene's own frame, which shows where sides meet the ground. */
	| 'normals';

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

/**
 * The widest that a row's edge counts, in pixels, in the seam check. A wider span between the
 * edge's light and its shadow crosses another object's shadow, so the row is left out.
 */
export const SEAM_WIDEST_EDGE = 10;

/**
 * How sharply the softness of a shadow edge that crosses each row of `box` changes from one row to
 * the next, in pixels: a seam line where one cascade hands over to the next. Each row's soft width
 * is the span between the first places, from the left, where the shadow factor crosses 0.9 and
 * 0.1. A median of each three neighboring rows takes out the texels' small steps. The figure is
 * the largest change of that median between neighboring rows. A cascade's texels are larger than
 * the cascade's before it, so its edges are softer. Where the cascades meet with no blend, the
 * width jumps by pixels in one row; a blend spreads the change over the band's rows.
 */
export function seamJump(factors: Float32Array, width: number, box: PixelBox): number {
	const [x0, y0, x1, y1] = box;
	const widths: number[] = [];
	for (let y = y0; y < y1; y++) {
		const row = y * width;
		const cross = (level: number) => {
			for (let x = x0; x + 1 < x1; x++) {
				const [a, b] = [factors[row + x] ?? 0, factors[row + x + 1] ?? 0];
				if ((a - level) * (b - level) <= 0 && a !== b) return x + (level - a) / (b - a);
			}
			return Number.NaN;
		};
		const soft = cross(0.1) - cross(0.9);
		if (soft >= 0 && soft <= SEAM_WIDEST_EDGE) widths.push(soft);
	}
	const medians = widths
		.slice(1, -1)
		.map(
			(_, k) =>
				[widths[k], widths[k + 1], widths[k + 2]].sort((a, b) => (a ?? 0) - (b ?? 0))[1] ?? 0,
		);
	let jump = 0;
	for (let k = 1; k < medians.length; k++)
		jump = Math.max(jump, Math.abs((medians[k] ?? 0) - (medians[k - 1] ?? 0)));
	return jump;
}

/**
 * The contact check's thresholds. A pixel of the normals view counts as level, such as the ground
 * or a roof, where its normal points up within about 25 degrees, and as a side where its normal
 * lies within 30 degrees of level. A side pixel darker than `dark` faces away from the sun or lies
 * in shadow. The ground at its foot should then start in shadow too, and a shadow starts at the
 * first pixel darker than `dark`. Each figure reads up to `reach` pixels from the side.
 */
export const CONTACT = { levelUp: 0.9, sideLevel: 0.5, dark: 0.1, reach: 4 } as const;

/** The contact figures of a frame: where shadows meet the casters that cast them. */
export interface ContactFigures {
	/** The feet found: columns where a dark side meets the ground and a shadow starts below. */
	feet: number;
	/**
	 * The mean light between a foot and the start of its shadow, in pixels of full light: each
	 * ground pixel adds its shadow factor. 0 where every shadow starts at its caster's foot.
	 */
	meanGapPixels: number;
	/** The share of feet, in percent, whose gap holds at least half a pixel of full light. */
	gapPercent: number;
	/** The top edges found: columns where a level top, such as a roof, rises from a dark side. */
	tops: number;
	/**
	 * The mean shadow on a top just past its edge, in pixels of full shadow: each pixel of the top
	 * adds one less its shadow factor. A caster that shadows its own lit top near the edge raises
	 * it, as casters moved too far toward the light do. 0 where tops are lit to the edge.
	 */
	meanRimPixels: number;
}

/** The up component of the normal that a normals-view pixel shows, from its green channel. */
function normalUp(normals: Uint8Array, i: number): number {
	return ((normals[i * 4 + 1] ?? 128) / 255) * 2 - 1;
}

/**
 * The contact figures of a shadows-view frame `factors` and a normals-view frame `normals` (RGBA)
 * of the same view, `width` pixels across. Each column holds sides in shadow, each with a level
 * surface below it, its foot on the ground, or above it, a top. An edge pixel that blends the two
 * may lie between them. The side is dark, so the light that the edge pixel shows comes from the
 * level surface.
 *
 * Below a foot, the ground should lie in its caster's shadow: each ground pixel down to the first
 * one in shadow adds its light to the foot's gap. A foot whose ground has no shadow within the
 * reach is left out, as its caster's shadow falls elsewhere. Above a top edge, the top should be
 * lit: each of its pixels within the reach adds its shadow to the edge's rim.
 */
export function contactFigures(
	factors: Float32Array,
	normals: Uint8Array,
	width: number,
): ContactFigures {
	const height = Math.floor(factors.length / width);
	const level = (row: number, x: number) =>
		row >= 0 && row < height && normalUp(normals, row * width + x) > CONTACT.levelUp;
	const side = (row: number, x: number) =>
		row >= 0 && row < height && Math.abs(normalUp(normals, row * width + x)) <= CONTACT.sideLevel;
	const factor = (row: number, x: number) => factors[row * width + x] ?? 1;
	/**
	 * The first row past a side's row, one `step` away, when a level surface starts there or past
	 * an edge pixel that is neither side nor level, or -1.
	 */
	const beside = (row: number, x: number, step: number) =>
		level(row + step, x) || (!side(row + step, x) && level(row + 2 * step, x)) ? row + step : -1;
	let [feet, gapSum, gapped, tops, rimSum] = [0, 0, 0, 0, 0];
	for (let x = 0; x < width; x++)
		for (let y = 0; y < height; y++) {
			if (!side(y, x)) continue;
			if (factor(y, x) >= CONTACT.dark) continue;
			const foot = beside(y, x, 1);
			if (foot >= 0) {
				let gap = 0;
				let shadowed = false;
				for (let row = foot; row < Math.min(height, foot + 1 + CONTACT.reach); row++) {
					if (row > foot && !level(row, x)) break;
					shadowed = factor(row, x) < CONTACT.dark;
					if (shadowed) break;
					gap += factor(row, x);
				}
				if (shadowed) {
					feet++;
					gapSum += gap;
					if (gap >= 0.5) gapped++;
				}
			}
			const top = beside(y, x, -1);
			if (top >= 0) {
				let rim = 0;
				for (let row = top; row >= Math.max(0, top - CONTACT.reach); row--) {
					if (row < top && !level(row, x)) break;
					rim += 1 - factor(row, x);
				}
				tops++;
				rimSum += rim;
			}
		}
	return {
		feet,
		meanGapPixels: feet === 0 ? 0 : gapSum / feet,
		gapPercent: feet === 0 ? 0 : (100 * gapped) / feet,
		tops,
		meanRimPixels: tops === 0 ? 0 : rimSum / tops,
	};
}

/**
 * The acne check's thresholds. A pixel counts as open lit ground where the normals view shows a
 * level surface, as the contact check reads it, and the reference shows at least `lit` there and
 * at every pixel within `margin` pixels. The margin keeps out the frame's shadow edges, which a
 * coarser map softens and moves by a pixel or two. A pixel under `shadowed` counts as shadowed.
 */
export const ACNE = { lit: 0.95, margin: 3, shadowed: 0.5 } as const;

/** The acne figures of a frame: shadow on flat surfaces that the reference shows in full light. */
export interface AcneFigures {
	/** The pixels of open lit ground: level, and in full light in the reference all around. */
	pixels: number;
	/**
	 * The mean shadow on those pixels in the frame, in percent: each pixel adds one less its shadow
	 * factor. Stripes and rings of self-shadow on a flat caster's lit top raise it. 0 where the frame
	 * lights them all, as the reference does.
	 */
	meanShadowPercent: number;
	/** The share of those pixels, in percent, that the frame shows in shadow. */
	shadowedPercent: number;
}

/**
 * The acne figures of a shadows-view frame `factors` against the reference frame `reference` and
 * the normals-view frame `normals` (RGBA) of the same view, `width` pixels across. The reference's
 * fine map leaves no acne on flat surfaces, so shadow in the frame where the reference is lit all
 * around comes from the frame's coarser texels comparing a surface with its own caster.
 */
export function acneFigures(
	factors: Float32Array,
	reference: Float32Array,
	normals: Uint8Array,
	width: number,
): AcneFigures {
	const height = Math.floor(factors.length / width);
	const { lit, margin, shadowed } = ACNE;
	// The pixels within the margin of a pixel that the reference does not show in full light: first
	// along each row, then along each column of that.
	const dark = new Uint8Array(factors.length);
	for (let i = 0; i < dark.length; i++) dark[i] = (reference[i] ?? 0) < lit ? 1 : 0;
	const across = new Uint8Array(dark.length);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			let near = 0;
			for (let dx = Math.max(0, x - margin); dx <= Math.min(width - 1, x + margin) && !near; dx++)
				near = dark[y * width + dx] ?? 0;
			across[y * width + x] = near;
		}
	let [pixels, shadowSum, inShadow] = [0, 0, 0];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			if (normalUp(normals, i) <= CONTACT.levelUp) continue;
			let near = 0;
			for (let dy = Math.max(0, y - margin); dy <= Math.min(height - 1, y + margin) && !near; dy++)
				near = across[dy * width + x] ?? 0;
			if (near) continue;
			const factor = factors[i] ?? 1;
			pixels++;
			shadowSum += 1 - factor;
			if (factor < shadowed) inShadow++;
		}
	return {
		pixels,
		meanShadowPercent: pixels === 0 ? 0 : (100 * shadowSum) / pixels,
		shadowedPercent: pixels === 0 ? 0 : (100 * inShadow) / pixels,
	};
}

/** The box of the shadow scene's 480 x 270 frame that the wall's shadow edge crosses. */
export const SHADOW_SCENE_EDGE: PixelBox = [215, 92, 320, 195];
