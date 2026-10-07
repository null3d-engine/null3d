// The room scene, defined once for GPU occlusion culling's image tests, its behavior test and its
// cost page. It is plain data with no engine imports: a square room whose four walls each have a
// doorway, and a field of detailed spheres outside it. The walls are occluders. From the camera
// in the room they hide almost every sphere; a few show through the doorway that the camera
// faces. The views turn the camera by a quarter turn or more at a time, so each faces another
// wall than the view before it.
import { PARITY_CANVAS } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const ROOM_IMAGE = PARITY_CANVAS;

/** The camera's eye height and lens. It stands in the middle of the room. */
export const ROOM_CAMERA = { height: 1.6, fov: 60, near: 0.1, far: 200 } as const;

/** The directions the camera faces in turn, as angles in degrees about the vertical axis. */
export const ROOM_VIEWS: readonly number[] = [0, 95, 180, 300, 30, 210];

/** The point that the camera looks at in the view of `degrees`, 10 m away at eye height. */
export function viewTarget(degrees: number): Vec3 {
	const radians = (degrees * Math.PI) / 180;
	return [Math.sin(radians) * -10, ROOM_CAMERA.height, Math.cos(radians) * -10];
}

/** Half the room's width, from its middle to each wall's inner face, in meters. */
const ROOM = 8;
/** The walls' height and thickness, and the doorway's width and height. */
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 0.4;
const DOOR_WIDTH = 3;
const DOOR_HEIGHT = 3;

/** A box of the scene: its size and the position of its center. */
export interface RoomBox {
	size: Vec3;
	position: Vec3;
}

/**
 * The walls: on each side of the room, the parts left and right of its doorway and the lintel
 * above it, along x for the walls in front and behind and along z for the walls at the sides.
 */
export const ROOM_WALLS: readonly RoomBox[] = (() => {
	const walls: RoomBox[] = [];
	const side = ROOM + WALL_THICKNESS;
	const part = side - DOOR_WIDTH / 2;
	const middle = DOOR_WIDTH / 2 + part / 2;
	const center = ROOM + WALL_THICKNESS / 2;
	const lintel = WALL_HEIGHT - DOOR_HEIGHT;
	for (const sign of [1, -1]) {
		for (const along of [1, -1]) {
			walls.push({
				size: [part, WALL_HEIGHT, WALL_THICKNESS],
				position: [along * middle, WALL_HEIGHT / 2, sign * center],
			});
			walls.push({
				size: [WALL_THICKNESS, WALL_HEIGHT, part],
				position: [sign * center, WALL_HEIGHT / 2, along * middle],
			});
		}
		walls.push({
			size: [DOOR_WIDTH, lintel, WALL_THICKNESS],
			position: [0, DOOR_HEIGHT + lintel / 2, sign * center],
		});
		walls.push({
			size: [WALL_THICKNESS, lintel, DOOR_WIDTH],
			position: [sign * center, DOOR_HEIGHT + lintel / 2, 0],
		});
	}
	return walls;
})();

/** The ground under the room and the field: a flat box, its top at height 0. */
export const ROOM_GROUND: RoomBox = { size: [100, 0.2, 100], position: [0, -0.1, 0] };

/** The spheres' radius, and the segments around and up each, which make them about 1,000 triangles. */
export const SPHERE_RADIUS = 0.8;
export const SPHERE_SEGMENTS = [32, 16] as const;
/** The spacing of the field's grid, and how far it reaches from the room's middle. */
const SPACING = 2.5;
const FIELD = 40;
/** The nearest that a sphere's center lies to the room's middle along either axis. */
const FIELD_INNER = 11;

/**
 * The centers of the field's spheres: a grid around the room, its rows at a few heights. The lowest
 * float a little above the ground, so no sphere's surface meets another surface, where the order
 * in which the GPU appends objects would pick the pixel.
 */
export const ROOM_SPHERES: readonly Vec3[] = (() => {
	const spheres: Vec3[] = [];
	const steps = Math.floor(FIELD / SPACING);
	for (let i = -steps; i <= steps; i++) {
		for (let k = -steps; k <= steps; k++) {
			const [x, z] = [i * SPACING, k * SPACING];
			if (Math.max(Math.abs(x), Math.abs(z)) < FIELD_INNER) continue;
			const y = SPHERE_RADIUS + 0.1 + ((i * 7 + k * 3) & 3) * 0.6;
			spheres.push([x, y, z]);
		}
	}
	return spheres;
})();

/** The sRGB colors of the walls, the ground and the spheres, each sphere's by its place. */
export const ROOM_COLORS = {
	wall: '#b8b0a4',
	ground: '#4a5240',
	spheres: ['#d0603c', '#3c80d0', '#d0b43c', '#58a868'],
	background: '#9cc0e0',
} as const;

/**
 * The share of the spheres that the walls hide from the camera in the view of `degrees`, with a
 * view of `aspect`: every sphere but those wholly or partly inside the view and seen through the
 * doorway that it faces. A sphere shows through a doorway when the angles under which the eye sees
 * the doorway's two sides, across, overlap those of the sphere's two sides. The walls hide the rest,
 * since the eye stands below their tops and every sphere is lower than they reach in its line.
 */
export function hiddenShare(degrees: number, aspect: number): number {
	const turn = (degrees * Math.PI) / 180;
	const halfAcross = Math.atan(Math.tan((ROOM_CAMERA.fov * Math.PI) / 360) * aspect);
	const doorHalf = Math.atan(DOOR_WIDTH / 2 / ROOM);
	let shown = 0;
	for (const [x, , z] of ROOM_SPHERES) {
		const distance = Math.hypot(x, z);
		const angle = Math.atan2(-x, -z);
		const half = Math.asin(Math.min(1, SPHERE_RADIUS / distance));
		const offView = Math.abs(wrap(angle - turn)) - half > halfAcross;
		// The doorway that faces the sphere's direction: the nearest of the four axes.
		const axis = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
		const offDoor = Math.abs(wrap(angle - axis)) - half > doorHalf;
		if (!offView && !offDoor) shown++;
	}
	return 1 - shown / ROOM_SPHERES.length;
}

/** An angle wrapped into the half turn each side of zero. */
function wrap(angle: number): number {
	return Math.atan2(Math.sin(angle), Math.cos(angle));
}
