// The large-world jitter check: a camera flies sideways past flat objects, one step per frame, at
// the origin and far from it, and each frame's objects are found again in the frame. The jitter
// sketch builds the scene, the jitter page draws the flights, and the browser tests and the device
// runner judge the figures that this module computes.
//
// The camera looks along -z and moves along +x. Each object is a flat square that faces it, at its
// own depth, in its own band of rows of the frame. A camera that moves along the plane of such a
// square moves its image along the frame by the same number of pixels in every frame: the focal
// length in pixels, times the step, over the depth. So each object's outline should move by the
// camera's motion only, as at the origin. Where positions round to coarse steps far from the
// origin, the image moves in jumps instead, as the rounding of the camera's position changes.
//
// The figure of a flight compares each frame-to-frame motion of each object with the same step of
// the flight at the origin, which draws the same view. The objects' centers come from the weight of
// every pixel of their band, so they keep a small fraction of a pixel, and the same view drawn
// twice gives the same centers.

/** The frame's size in pixels. */
export const JITTER_SIZE = { width: 480, height: 270 } as const;
/** The camera's vertical field of view, in degrees. */
export const JITTER_FOV = 60;
/** The frames of each flight: the camera's places, one step apart. */
export const JITTER_STEPS = 16;
/** How far the camera moves along +x in each step, in meters: a run at about 7 m/s at 60 Hz. */
export const STEP_METERS = 0.12;
/**
 * The frames that the sketch draws at each of the camera's places before it tells the page, so
 * that the frame which the page reads back holds the place in every thread mode.
 */
export const SETTLE_FRAMES = 2;
/** The direction from the origin of the world to the flight, a unit vector off every axis. */
export const FLIGHT_DIRECTION = [0.6, 0.48, 0.64] as const;
/** The rows of the frame in each object's band. */
export const BAND_ROWS = 45;
/** The height of each object's image, in pixels. */
export const OBJECT_PIXELS = 24;

/** How the sketch places an object: a root mesh, a child of a turned parent, or a batch's rows. */
export type JitterObjectKind = 'mesh' | 'child' | 'batch';

/** The objects, by band from the top of the frame: each one's depth in meters and its kind. */
export const JITTER_OBJECTS: readonly { depth: number; kind: JitterObjectKind }[] = [
	{ depth: 4, kind: 'mesh' },
	{ depth: 6, kind: 'child' },
	{ depth: 9, kind: 'batch' },
	{ depth: 14, kind: 'mesh' },
	{ depth: 22, kind: 'child' },
	{ depth: 35, kind: 'batch' },
];

/** The focal length of the camera, in pixels. */
export const FOCAL_PIXELS = JITTER_SIZE.height / 2 / Math.tan((JITTER_FOV * Math.PI) / 360);

/** A flight: its name, how far from the origin it flies, and whether the grid cells are full. */
export interface Flight {
	name: string;
	/** The distance of the scene from the world's origin, in meters. */
	distance: number;
	/**
	 * True when the sketch takes every grid cell before it builds the scene, so that the scene's
	 * objects and the camera go into the origin's cell, as without cells.
	 */
	cellsFull: boolean;
}

/** The Earth's radius, in meters. */
export const EARTH_RADIUS = 6_378_137;

/**
 * The flights of the check, the one at the origin first: then 1,000 km and the Earth's radius, with
 * cells as the engine uses them, and the two far flights again with every cell taken.
 */
export const FLIGHTS: readonly Flight[] = [
	{ name: 'origin', distance: 0, cellsFull: false },
	{ name: '1000km', distance: 1_000_000, cellsFull: false },
	{ name: '6378km', distance: EARTH_RADIUS, cellsFull: false },
	{ name: '1000km-cells-off', distance: 1_000_000, cellsFull: true },
	{ name: '6378km-cells-off', distance: EARTH_RADIUS, cellsFull: true },
];

/** The sketch's query for a flight. */
export function flightQuery({ distance, cellsFull }: Flight): string {
	return `distance=${distance}${cellsFull ? '&cellsFull' : ''}`;
}

/** Where an object stands relative to the camera's first place, in meters. */
export function objectPlace(band: number): [number, number, number] {
	const { depth } = JITTER_OBJECTS[band] as { depth: number };
	const row = (band + 0.5) * BAND_ROWS;
	return [
		((JITTER_STEPS - 1) * STEP_METERS) / 2,
		((JITTER_SIZE.height / 2 - row) * depth) / FOCAL_PIXELS,
		-depth,
	];
}

/** The width and height of an object's square, in meters. */
export function objectSize(band: number): number {
	const { depth } = JITTER_OBJECTS[band] as { depth: number };
	return (OBJECT_PIXELS * depth) / FOCAL_PIXELS;
}

/** An object's image in one frame: the center of its weight in pixels, and its weight. */
export interface Spot {
	x: number;
	y: number;
	/** The pixels that the object covers, with partly covered pixels counted in part. */
	area: number;
}

/** A pixel channel under this value counts as background: the dithering moves black by less. */
const BACKGROUND = 2;

/** The linear value of an sRGB channel from 0 to 255. */
function linear(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The linear value of each sRGB channel value, so the frame's loop looks each one up. */
const LINEAR = Float64Array.from({ length: 256 }, (_, k) => (k < BACKGROUND ? 0 : linear(k)));

/**
 * The image of each object in an RGBA frame, by band. Each pixel weighs its linear brightness, which
 * is the share of it that the white object covers, as the engine averages the samples of an edge in
 * linear color.
 */
export function spots(rgba: Uint8Array, width: number, height: number): Spot[] {
	return JITTER_OBJECTS.map((_, band) => {
		let [sum, sx, sy] = [0, 0, 0];
		const end = Math.min(height, (band + 1) * BAND_ROWS);
		for (let y = band * BAND_ROWS; y < end; y++)
			for (let x = 0; x < width; x++) {
				const i = (y * width + x) * 4;
				const w = LINEAR[Math.max(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0)] ?? 0;
				sum += w;
				sx += w * (x + 0.5);
				sy += w * (y + 0.5);
			}
		return sum === 0
			? { x: Number.NaN, y: Number.NaN, area: 0 }
			: { x: sx / sum, y: sy / sum, area: sum };
	});
}

/** The figures of one flight, from its frames' spots. */
export interface FlightFigures {
	name: string;
	distance: number;
	cellsFull: boolean;
	/**
	 * The largest difference, in pixels, between a frame-to-frame motion of an object in this flight
	 * and the same motion in the flight at the origin. 0 for the flight at the origin itself.
	 */
	jitterPixels: number;
	/** The largest difference of a frame-to-frame motion from its object's mean motion, in pixels. */
	ownJitterPixels: number;
	/** Each object's mean motion from one frame to the next, along x, in pixels. */
	motionPixels: number[];
	/**
	 * The smallest area of an object in any frame, over the largest area of the same object, from
	 * 0 to 1. An object that left the frame or its band lowers it.
	 */
	coverage: number;
	/** Each object's center in each frame, `[x, y]` in pixels, by frame and then by band. */
	centers: [number, number][][];
}

/** The motion of each object from each frame to the next, by frame and then by band. */
function motions(frames: readonly Spot[][]): [number, number][][] {
	return frames.slice(1).map((frame, k) =>
		frame.map((spot, band) => {
			const before = frames[k]?.[band] as Spot;
			return [spot.x - before.x, spot.y - before.y];
		}),
	);
}

/** The figures of a flight's frames, against the frames of the flight at the origin. */
export function flightFigures(
	flight: Flight,
	frames: readonly Spot[][],
	origin: readonly Spot[][],
): FlightFigures {
	const moved = motions(frames);
	const reference = motions(origin);
	const bands = JITTER_OBJECTS.length;
	const means = Array.from({ length: bands }, (_, band) => {
		const total = moved.reduce<[number, number]>(
			(sum, step) => [sum[0] + (step[band]?.[0] ?? 0), sum[1] + (step[band]?.[1] ?? 0)],
			[0, 0],
		);
		return [total[0] / moved.length, total[1] / moved.length] as const;
	});
	let [jitter, own, coverage] = [0, 0, 1];
	for (let k = 0; k < moved.length; k++)
		for (let band = 0; band < bands; band++) {
			const [dx, dy] = moved[k]?.[band] ?? [Number.NaN, Number.NaN];
			const [rx, ry] = reference[k]?.[band] ?? [Number.NaN, Number.NaN];
			const [mx, my] = means[band] ?? [0, 0];
			jitter = Math.max(jitter, Math.hypot(dx - rx, dy - ry));
			own = Math.max(own, Math.hypot(dx - mx, dy - my));
		}
	for (let band = 0; band < bands; band++) {
		const areas = frames.map((frame) => frame[band]?.area ?? 0);
		coverage = Math.min(coverage, Math.min(...areas) / Math.max(1e-9, ...areas));
	}
	const anyMissing = frames.some((frame) => frame.some((spot) => !(spot.area > 0)));
	return {
		...flight,
		jitterPixels: anyMissing ? Number.POSITIVE_INFINITY : jitter,
		ownJitterPixels: anyMissing ? Number.POSITIVE_INFINITY : own,
		motionPixels: means.map(([x]) => round(x)),
		coverage: anyMissing ? 0 : coverage,
		centers: frames.map((frame) => frame.map(({ x, y }) => [round(x), round(y)])),
	};
}

/** A number to a ten-thousandth, for a smaller result. */
function round(value: number): number {
	return Math.round(value * 1e4) / 1e4;
}

/** What the jitter page publishes. */
export interface JitterResult {
	error?: string;
	tier: string;
	width: number;
	height: number;
	flights: FlightFigures[];
	/** PNG files of each flight's first and last frames, in base64, by name. */
	images?: Record<string, string>;
}

/**
 * The most that a far flight's frame-to-frame motion may differ from the flight at the origin, in
 * pixels. See .dev/decisions/D-80-large-world-jitter.md for the figures it sits between.
 */
export const JITTER_TOLERANCE_PIXELS = 0.05;
/**
 * The least jitter that a flight with every cell taken must show, in pixels, so that the check can
 * see the jitter that it guards against.
 */
export const CONTROL_JITTER_PIXELS = 0.5;
/** The least coverage of every flight: each object stays whole in its band throughout. */
export const MIN_COVERAGE = 0.95;

/** What is wrong with a jitter page's figures; empty when nothing is. */
export function jitterProblems(result: JitterResult): string[] {
	const problems: string[] = [];
	if (result.flights.length !== FLIGHTS.length)
		problems.push(`the page flew ${result.flights.length} of ${FLIGHTS.length} flights`);
	for (const flight of result.flights) {
		if (flight.coverage < MIN_COVERAGE)
			problems.push(
				`the ${flight.name} flight lost part of an object: its smallest area is ${(100 * flight.coverage).toFixed(1)}% of its largest`,
			);
		const jitter = flight.jitterPixels.toFixed(3);
		if (!flight.cellsFull && flight.jitterPixels > JITTER_TOLERANCE_PIXELS)
			problems.push(
				`the ${flight.name} flight moved up to ${jitter} px apart from the flight at the origin, over the limit of ${JITTER_TOLERANCE_PIXELS} px`,
			);
		if (flight.cellsFull && !(flight.jitterPixels >= CONTROL_JITTER_PIXELS))
			problems.push(
				`the ${flight.name} flight, with every cell taken, showed only ${jitter} px of jitter, under the ${CONTROL_JITTER_PIXELS} px that shows the check can see it`,
			);
	}
	return problems;
}
