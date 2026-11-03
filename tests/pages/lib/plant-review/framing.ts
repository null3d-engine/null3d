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

/** The least height a camera stands at, in metres: one that would stand lower is raised to it. */
const LOWEST_EYE = 0.3;

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

/** The row share at which a point `y` metres up the plant's axis lands for a stand camera. */
export function projectRow(camera: StandCamera, y: number, fov: number): number {
	const elevation = Math.atan2(y - camera.height, camera.distance * Math.cos(camera.yaw));
	const half = Math.tan((fov * Math.PI) / 360);
	return 0.5 - Math.tan(elevation - camera.pitch) / (2 * half);
}
