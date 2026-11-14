// A whole plant's turning video, measured: its envelope from views spread evenly round the turn,
// and its crown box at the rubric's eight angles. The crown box comes from the same frames and the
// same measures as the review tool's, so the spread recorded here is the one its summary prints
// beside a render's. The camera is solved from the views' framing as the review page solves it, so
// a camera that looks down on the plant, which mixes the plant's depth into its outline, is named.
import { standCamera } from '../../tests/pages/lib/plant-review/framing.ts';
import { VIEW_SPECS } from '../../tests/pages/lib/plant-review/views.ts';
import {
	crownBoxSpread,
	estimateFraming,
	iou,
	median,
	rubricFrames,
	spread,
} from '../lib/plant-review/compare.ts';
import { probeVideo, type Rgba, videoFrames } from '../lib/plant-review/image.ts';
import { type TurnVideo, WORK_WIDTH } from '../lib/plant-review/references.ts';
import { type HullFit, type HullView, hullEnvelope } from './envelope.ts';
import { closingOverlap, type FrameOutline, frameOutline, outlineGrid } from './silhouettes.ts';

/** Views of the plant over a full turn; a half turn takes half as many at the same step. */
export const VIEWS_PER_TURN = 32;
/** The least share of the views that must show the whole plant for the envelope to be measured. */
const LEAST_VIEWS = 0.75;
/** The least overlap of a full turn's last frame with its first. */
const LEAST_CLOSING = 0.8;
/** The least mean overlap of the envelope's outlines with the views it came from. */
const LEAST_CONSISTENCY = 0.75;
/** The most the plant's height in the frame may change over a turn, largest less smallest over the mean. */
const MOST_HEIGHT_SPREAD = 0.15;
/** The most degrees a camera may look down on the plant's middle. */
const STEEPEST_CAMERA = 20;

/** A view's plant and its outline on the grid, or null where the envelope left it out. */
export type ViewOutline = FrameOutline & { readonly grid: Uint8Array | null };

/** What a turning video gives. */
export interface TurnFit {
	readonly video: string;
	readonly arc: number;
	readonly frames: number;
	/** How far the last frame of a full turn shows the first frame's plant again, or null. */
	readonly closing: number | null;
	/** The envelope, or null when too few views show the whole plant. */
	readonly hull: HullFit | null;
	/** The views the envelope read, and those it left out with the reason. */
	readonly views: readonly number[];
	/** Whole-plant stills the envelope read, with the turn each honours and its outline overlap. */
	readonly stills: readonly {
		readonly file: string;
		readonly turn: number;
		readonly frame: number;
		readonly overlap: number;
	}[];
	/** Every view's plant and outline, read or left out, in turn order. */
	readonly outlines: readonly ViewOutline[];
	readonly skipped: readonly { readonly frame: number; readonly problem: string }[];
	/** The crown box at the rubric's angles: its width and height in work pixels, and their spread. */
	readonly crownBox: {
		readonly angles: readonly number[];
		readonly boxes: readonly ({ readonly width: number; readonly height: number } | null)[];
		readonly spread: { readonly width: number; readonly height: number };
	};
	/**
	 * The camera, solved from the views' framing at the whole view's field of view: its height and
	 * its distance from the plant's axis in plant heights, and the degrees it looks down on the
	 * plant's middle. Null when no view frames the plant's base.
	 */
	readonly camera: {
		readonly height: number;
		readonly distance: number;
		readonly down: number;
	} | null;
	/** Why the reference is poor to measure the envelope from; empty when it is not. */
	readonly problems: readonly string[];
}

/**
 * The plant height the camera is solved at. The solve scales with the plant, apart from the least
 * eye height the review page stands a camera at; a tall plant keeps it out of the way.
 */
const SOLVE_HEIGHT = 1000;

/** The camera that framed a set of views, in plant heights, or null when it cannot be solved. */
function solveCamera(framed: readonly FrameOutline[]): TurnFit['camera'] {
	if (framed.length === 0) return null;
	const framing = estimateFraming(
		framed.map((o) => o.measures),
		framed.map((o) => o.mask),
	);
	if (framing.base === undefined) return null;
	const camera = standCamera({ ...framing, fov: VIEW_SPECS.whole.fov }, SOLVE_HEIGHT);
	if (camera.warning) return null;
	const height = camera.height / SOLVE_HEIGHT;
	const distance = camera.distance / SOLVE_HEIGHT;
	return {
		height: Number(height.toFixed(3)),
		distance: Number(distance.toFixed(3)),
		down: Number(((Math.atan2(height - 0.5, distance) * 180) / Math.PI).toFixed(1)),
	};
}

/** A whole-plant still, whose outline bounds the crown's broad sides. */
export interface FitStill {
	readonly file: string;
	readonly image: Rgba;
	/** Degrees round the plant that the review draws the still at; 0 looks from +Z. */
	readonly turn?: number;
}

/**
 * Measures a turning video of the whole plant.
 *
 * @param video The video, with the arc it turns over.
 * @param frames Its frames, when already read; read through ffmpeg otherwise.
 * @param stills Whole-plant stills whose outlines bound the crown, each at the turn the review
 *   draws it at. They come from afar, so no perspective correction applies to them.
 */
export function fitTurn(
	video: TurnVideo,
	frames?: readonly Rgba[],
	stills?: readonly FitStill[],
): TurnFit {
	const images = frames ?? videoFrames(video.path, probeVideo(video.path), WORK_WIDTH);
	const n = images.length;
	const cache = new Map<number, FrameOutline>();
	const outline = (k: number) => {
		let known = cache.get(k);
		if (!known) {
			known = frameOutline(images[k] as Rgba, k);
			cache.set(k, known);
		}
		return known;
	};
	const span = n - 1;
	const count = Math.round((VIEWS_PER_TURN * video.arc) / 360);
	const step = span / count;
	const frameList = Array.from({ length: count }, (_, i) => Math.min(span, Math.round(i * step)));
	const axis =
		median(
			frameList.flatMap((k) => (outline(k).foot === null ? [] : [outline(k).foot as number])),
		) ?? 0;
	const gridOf = (k: number) => outlineGrid(outline(k), axis);
	const views: HullView[] = [];
	const skipped: { frame: number; problem: string }[] = [];
	const read: ViewOutline[] = [];
	for (const k of frameList) {
		const grid = gridOf(k);
		read.push({ ...outline(k), grid });
		if (grid) views.push({ frame: k, turn: (((video.arc * k) / span) * Math.PI) / 180, grid });
		else skipped.push({ frame: k, problem: outline(k).problem ?? 'no outline' });
	}
	const videoViewCount = views.length;
	const enough = videoViewCount >= Math.max(2, Math.ceil(LEAST_VIEWS * count));
	const framed = read.filter((o) => o.grid);
	const camera = solveCamera(framed);
	const distance = camera?.distance ?? Number.POSITIVE_INFINITY;
	// The way the video turns is a property of its own camera and outline: the stills must not move
	// it, because they are seen from afar and are not rigid views of the video's tree.
	const direction = views.length >= 2 ? hullEnvelope(views, video.file, distance).direction : 1;
	// A still bounds the crown at the turn the review draws it at, so its own widening lands on the
	// view it is judged against rather than between two views.
	const pageAngle = (k: number) => direction * ((video.arc * k) / span);
	const apart = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
	const matched: {
		readonly file: string;
		readonly turn: number;
		readonly frame: number;
		readonly overlap: number;
	}[] = [];
	for (const still of stills ?? []) {
		const turn = still.turn ?? 0;
		const shot = frameOutline(still.image, -1 - matched.length);
		const grid = outlineGrid(shot, shot.foot ?? axis);
		if (!grid || shot.problem) {
			skipped.push({
				frame: shot.frame,
				problem: `${still.file}: ${shot.problem ?? 'no outline'}`,
			});
			continue;
		}
		let near = frameList[0] as number;
		for (const k of frameList)
			if (apart(pageAngle(k), turn) < apart(pageAngle(near), turn)) near = k;
		const nearGrid = gridOf(near);
		if (!nearGrid) {
			skipped.push({ frame: shot.frame, problem: `${still.file}: no frame near its turn` });
			continue;
		}
		matched.push({ file: still.file, turn, frame: near, overlap: iou(grid, nearGrid) });
		views.push({
			frame: shot.frame,
			turn: (direction * turn * Math.PI) / 180,
			grid,
			distance: Number.POSITIVE_INFINITY,
			file: still.file,
			stillTurn: turn,
		});
	}
	const rubric = rubricFrames(video.arc, n);
	const measures = rubric.frames.map((k) => outline(k).measures);
	const crownBox = {
		angles: rubric.angles,
		boxes: measures.map((m) => (m.box ? m.crownBox : null)),
		spread: crownBoxSpread(measures),
	};
	const closing = closingOverlap(gridOf(0), gridOf(span), video.arc);
	// The camera's distance draws the crown's near side larger, which the hull undoes.
	const hull = enough ? hullEnvelope(views, video.file, distance, direction) : null;
	const problems: string[] = [];
	if (!enough)
		problems.push(
			`only ${videoViewCount} of ${count} views show the whole plant on a plain background`,
		);
	if (closing !== null && closing < LEAST_CLOSING)
		problems.push(
			`the last frame shows the first frame's plant with an overlap of only ${closing}: the plant changes shape over the turn, or the turn does not come back to its start`,
		);
	if (hull && hull.consistency.mean < LEAST_CONSISTENCY)
		problems.push(
			`the envelope's outlines match the views it came from with a mean overlap of only ${hull.consistency.mean}: the plant drifts between views, or is too open for a hull to stand for it`,
		);
	const tall = spread(framed.flatMap((o) => (o.box ? [o.box.bottom - o.box.top + 1] : [])));
	if (tall > MOST_HEIGHT_SPREAD)
		problems.push(
			`the plant's height in the frame changes by ${Math.round(tall * 100)} per cent over the turn: its foot or its top is lost against the background in some views`,
		);
	if (camera && camera.down > STEEPEST_CAMERA)
		problems.push(
			`the camera looks down on the plant by ${camera.down} degrees, which mixes the plant's depth into its outline`,
		);
	return {
		video: video.file,
		arc: video.arc,
		frames: n,
		closing,
		hull,
		views: views.map((v) => v.frame),
		stills: matched,
		outlines: read,
		skipped,
		crownBox,
		camera,
		problems,
	};
}
