// The camera that a framing in screen shares asks for: a reference picture says where its horizon,
// its plant's top and its plant's base sit in the frame, and the review page stands its camera so
// the render's plant lands on the same rows. The review tools measure the shares and the page
// solves the camera, both from this file.

/**
 * Where a whole plant lands in the frame, in screen shares: the horizon's row, the plant's top
 * row, and either its base row or the camera's height when the base is out of frame.
 */
export interface ScreenFraming {
	/** The vertical field of view in degrees. */
	readonly fov: number;
	/** The frame's width over its height. */
	readonly aspect: number;
	/** The horizon's row share. */
	readonly horizon: number;
	/** The plant top's row share. */
	readonly top: number;
	/** The plant base's row share, where the plant meets the ground. */
	readonly base?: number;
	/** The camera's height above the ground in metres, used when `base` is absent. */
	readonly eye?: number;
	/** The column share of the plant's axis. */
	readonly targetX: number;
}

/** A camera that stands on the ground plane's normal side, at a distance from the plant's axis. */
export interface StandCamera {
	/** The horizontal distance from the plant's axis, in metres. */
	readonly distance: number;
	/** The camera's height above the ground, in metres. */
	readonly height: number;
	/** The camera's pitch in radians: positive looks up. */
	readonly pitch: number;
	/** The camera's turn away from the plant's axis in radians: positive puts the plant right. */
	readonly yaw: number;
	/** What the solve had to give up, such as a camera that would stand under the ground. */
	readonly warning?: string;
}

/** The angle in radians, up from the optical axis, of the ray through a row share. */
export function rowAngle(row: number, fov: number): number {
	const half = Math.tan((fov * Math.PI) / 360);
	return Math.atan((0.5 - row) * 2 * half);
}

/** A cut piece's frame, sized in leaf lengths: its height, the camera's distance, and its turn. */
export interface LeafFrame {
	/** The frame's height in metres. */
	readonly tall: number;
	/** The piece's run across the frame in metres, which a rolled frame lengthens. */
	readonly run: number;
	/** The camera's distance from the piece in metres. */
	readonly distance: number;
	/** The camera's roll about its line of sight, in radians. */
	readonly roll: number;
}

/**
 * The frame that a cut piece takes when its photograph was measured in leaf lengths: the frame's
 * height is that many leaves of the length the photograph was measured in, and a roll lays the
 * piece across the frame. A blade far longer than the photographed leaf frames at the photograph's
 * scale only when its length is named, since the frame counts leaves, not the plant's own size.
 */
export function leafFrame(
	leaves: number,
	length: number,
	rollDegrees: number,
	aspect: number,
	fov: number,
): LeafFrame {
	const roll = (rollDegrees * Math.PI) / 180;
	const tall = leaves * length;
	const run = Math.abs(Math.sin(roll)) > Math.SQRT1_2 ? tall * aspect : tall;
	return { tall, run, distance: tall / 2 / Math.tan((fov * Math.PI) / 360), roll };
}

/**
 * The least height a camera stands at, in metres: one that would stand lower is raised to it. A
 * photograph of a low plant such as a sedge or a hosta is taken from a few decimetres up, so the
 * floor clears the ground without refusing the picture's own viewpoint. A plant a hand's width tall
 * asks for a camera near its own foot, so the floor sits at a decimetre and the solve frames a herb
 * or a low shrub as its photograph framed it.
 */
const LOWEST_EYE = 0.1;

/**
 * The camera that puts a plant `height` metres tall where a framing asks: the horizon's row sets
 * the pitch, and the top and base rows set the distance and the camera's height. Without a base
 * row, the camera stands at `eye` and only the top row sets the distance.
 */
export function standCamera(framing: ScreenFraming, height: number): StandCamera {
	const pitch = -rowAngle(framing.horizon, framing.fov);
	const topRay = rowAngle(framing.top, framing.fov) + pitch;
	const half = Math.tan((framing.fov * Math.PI) / 360);
	const yaw = Math.atan((framing.targetX - 0.5) * 2 * half * framing.aspect);
	// The solve works along the optical axis; a camera turned off the plant stands further back by
	// the cosine of its turn, so the plant's axis still lands on the rows asked for.
	const along = Math.cos(yaw);
	if (framing.base !== undefined) {
		const baseRay = rowAngle(framing.base, framing.fov) + pitch;
		const spread = Math.tan(topRay) - Math.tan(baseRay);
		if (spread > 1e-6) {
			const forward = height / spread;
			const eye = -forward * Math.tan(baseRay);
			if (eye >= LOWEST_EYE) return { distance: forward / along, height: eye, pitch, yaw };
		}
	}
	const eye = Math.max(LOWEST_EYE, framing.eye ?? 1.6);
	const rise = Math.tan(topRay);
	if (rise > 1e-6 && height > eye)
		return {
			distance: (height - eye) / rise / along,
			height: eye,
			pitch,
			yaw,
			...(framing.base !== undefined
				? { warning: 'the base row sits above the horizon, so the camera stands at eye height' }
				: {}),
		};
	// A top row at or under the horizon cannot hold a plant taller than the eye: stand far enough
	// back that the plant fills the frame's height at a level camera.
	return {
		distance: height / (2 * half) / along,
		height: Math.min(eye, height / 2),
		pitch,
		yaw,
		warning: 'the top row sits at or under the horizon, so the camera stands back at plant height',
	};
}

/**
 * The horizontal distance that keeps a plant point inside a share of the frame's width: `across`
 * metres off the plant's axis and `toward` metres nearer than it. A reference picture leaves a
 * margin round its plant, so a whole view stands back until the render's widest point keeps that
 * margin rather than running off the frame's sides.
 */
export function widthDistance(
	across: number,
	toward: number,
	share: number,
	aspect: number,
	fov: number,
): number {
	const half = Math.tan((fov * Math.PI) / 360);
	return toward + across / (Math.max(0.05, Math.min(1, share)) * half * aspect);
}

/** The row share at which a point `y` metres up the plant's axis lands for a stand camera. */
export function projectRow(camera: StandCamera, y: number, fov: number): number {
	const elevation = Math.atan2(y - camera.height, camera.distance * Math.cos(camera.yaw));
	const half = Math.tan((fov * Math.PI) / 360);
	return 0.5 - Math.tan(elevation - camera.pitch) / (2 * half);
}

/**
 * The least share of the frame's height between the row that a bole's top lands on and the row its
 * foot lands on: nearer rows would ask the camera to stand so far back that the bole spans them.
 */
export const LEAST_ROW_GAP = 0.1;

/** The rows on which a cut piece's highest and lowest points land, as shares of the frame. */
export interface CutRows {
	readonly top: number;
	readonly base: number;
}

/** A cut piece's camera: metres back from its target, and metres its target stands above the centre. */
export interface CutCamera {
	readonly distance: number;
	readonly lift: number;
}

/**
 * The distance at which a part's span fills the frame across it: a photograph of a part of a piece,
 * such as one pinna of a frond, frames that part rather than the whole piece, and the span names the
 * metres it shows across the frame.
 */
export function spanDistance(span: number, fov: number, aspect: number): number {
	const half = Math.tan((fov * Math.PI) / 360);
	return span / 2 / Math.max(half * aspect, 0.0001);
}

/**
 * The camera that puts a cut piece's points on the rows its photograph puts them on: its highest
 * point on the top row and its lowest on the base row, the frame centred across the piece. The camera
 * looks along `forward`, with `right` and `up` as its frame's axes, at a target straight above or
 * below `centre`. A piece too wide for the frame at that size is framed from further back, so it
 * fits between the side margins, with its lowest point still on the base row.
 */
export function cutCamera(
	points: ArrayLike<number>,
	centre: readonly number[],
	forward: readonly number[],
	right: readonly number[],
	up: readonly number[],
	fov: number,
	aspect: number,
	rows: CutRows,
	margin: number,
): CutCamera {
	const half = Math.tan((fov * Math.PI) / 360);
	const topSlope = (1 - 2 * rows.top) * half;
	const baseSlope = (1 - 2 * rows.base) * half;
	const n = Math.floor(points.length / 3);
	if (n === 0) return { distance: 1, lift: 0 };
	const a = new Float64Array(n);
	const w = new Float64Array(n);
	let nearest = 0;
	let wide = 0;
	for (let i = 0; i < n; i++) {
		const dx = (points[i * 3] as number) - (centre[0] as number);
		const dy = (points[i * 3 + 1] as number) - (centre[1] as number);
		const dz = (points[i * 3 + 2] as number) - (centre[2] as number);
		a[i] = dx * (up[0] as number) + dy * (up[1] as number) + dz * (up[2] as number);
		w[i] = dx * (forward[0] as number) + dy * (forward[1] as number) + dz * (forward[2] as number);
		const across = Math.abs(
			dx * (right[0] as number) + dy * (right[1] as number) + dz * (right[2] as number),
		);
		nearest = Math.max(nearest, -(w[i] as number));
		wide = Math.max(wide, across / (half * aspect * (1 - 2 * margin)) - (w[i] as number));
	}
	// For a camera `distance` back, the least lift that keeps every point under the top row, and the
	// most that keeps every point over the base row. The first falls and the second rises as the
	// camera steps back, and they meet where the piece spans the two rows exactly.
	const lowest = (distance: number) => {
		let most = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < n; i++)
			most = Math.max(most, (a[i] as number) - topSlope * ((w[i] as number) + distance));
		return most;
	};
	const highest = (distance: number) => {
		let least = Number.POSITIVE_INFINITY;
		for (let i = 0; i < n; i++)
			least = Math.min(least, (a[i] as number) - baseSlope * ((w[i] as number) + distance));
		return least;
	};
	let near = nearest + 1e-3;
	let far = Math.max(near * 2, 1);
	while (lowest(far) > highest(far) && far < 1e6) far *= 2;
	for (let k = 0; k < 60; k++) {
		const middle = (near + far) / 2;
		if (lowest(middle) > highest(middle)) near = middle;
		else far = middle;
	}
	const distance = Math.max(far, wide);
	return { distance, lift: highest(distance) };
}
