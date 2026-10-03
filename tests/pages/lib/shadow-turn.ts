// The cameras that turn on the spot in the shadow turn sketch and in the shadow contact sketch's
// turn view, and the map between their frames, which the tests that turn them need.

/** Where the camera stands, how far it looks down, and its vertical field of view. */
export const TURN = {
	position: [0, 6, 0] as const,
	pitchDegrees: -35,
	fovDegrees: 50,
};

/** How far above the watched box's base each view of the shadow contact sketch aims, in meters. */
export const CONTACT_AIM_HEIGHT = 0.3;

/**
 * The shadow contact sketch's turn view: where the camera stands relative to the box it looks at,
 * and its vertical field of view.
 */
export const CONTACT_TURN = { from: [-12.5, 19.5, -15] as const, fovDegrees: 40 };

/** How far the contact sketch's turn view looks down, in degrees. */
export const CONTACT_TURN_PITCH =
	(Math.atan2(
		CONTACT_AIM_HEIGHT - CONTACT_TURN.from[1],
		Math.hypot(CONTACT_TURN.from[0], CONTACT_TURN.from[2]),
	) *
		180) /
	Math.PI;

/** A frame of a camera that turns on the spot: its size in pixels and its lens. */
export interface TurnFrame {
	width: number;
	height: number;
	fovDegrees: number;
	pitchDegrees: number;
}

/**
 * The pixel of the first frame that shows what pixel (x, y) of a frame turned left by `yaw` degrees
 * about the world's up shows, or undefined where the first frame does not see it at least `margin`
 * pixels inside its edges. A turn on the spot moves every point of the image by a map that the
 * camera's angles give, whatever its distance.
 */
export function inFirstFrame(
	frame: TurnFrame,
	x: number,
	y: number,
	yaw: number,
	margin: number,
): [number, number] | undefined {
	const { width, height } = frame;
	const tanY = Math.tan((frame.fovDegrees * Math.PI) / 360);
	const tanX = (tanY * width) / height;
	// The ray through the pixel in the turned camera's view.
	const u = (((x + 0.5) / width) * 2 - 1) * tanX;
	const v = (1 - ((y + 0.5) / height) * 2) * tanY;
	// Into the first camera's view: tilt up, turn by the yaw, tilt down again.
	const pitch = (frame.pitchDegrees * Math.PI) / 180;
	const [sp, cp] = [Math.sin(pitch), Math.cos(pitch)];
	const [sy, cy] = [Math.sin((yaw * Math.PI) / 180), Math.cos((yaw * Math.PI) / 180)];
	const [ay, az] = [cp * v - sp * -1, sp * v + cp * -1];
	const [bx, bz] = [cy * u + sy * az, -sy * u + cy * az];
	const [cY, cZ] = [cp * ay + sp * bz, -sp * ay + cp * bz];
	if (cZ >= 0) return undefined;
	const x0 = ((bx / -cZ / tanX + 1) / 2) * width - 0.5;
	const y0 = ((1 - cY / -cZ / tanY) / 2) * height - 0.5;
	const [px, py] = [Math.round(x0), Math.round(y0)];
	const inside = (p: number, size: number) => p >= margin && p < size - margin;
	return inside(px, width) && inside(py, height) ? [px, py] : undefined;
}
