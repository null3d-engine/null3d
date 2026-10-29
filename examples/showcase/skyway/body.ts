// The hero car's body, with a cockpit: the lane traffic's flying car (from the traffic-lanes add-on),
// lofted through the same sections, with its hover pods, under a taller glass bubble where the
// driver sits. Inside the bubble the body's own top is the cockpit's floor, with a seat, a yoke and a
// dashboard, which carries the car's screens.
//
// Everything is in the body's own units, the lane hull's: the nose points along +Z, the belly sits
// just above y = 0, and the beltline is at 0.66. The hero car scales the body to its size.
import type { MeshGeometry, SketchContext } from '@null3d/engine';
import {
	FLYING_CAR_BODY,
	FLYING_CAR_POD,
	FLYING_CAR_POD_X,
	type HullSection,
	loftHull,
} from '../../addons/traffic-lanes/index';

/**
 * The cockpit: the half width and the half length of the bubble's footprint on the beltline, where
 * the body's top is the cockpit's floor, and the floor's height.
 */
export const COCKPIT = { half: 0.56, length: 1.0, floor: 0.66 };

/** The glass bubble over the cockpit: taller than the traffic's, so a driver sits under it. */
const BUBBLE: readonly HullSection[] = [
	{ z: -1.05, half: 0.28, bottom: 0.6, top: 0.68 },
	{ z: -0.75, half: 0.52, bottom: 0.6, top: 1.02 },
	{ z: -0.2, half: 0.6, bottom: 0.6, top: 1.24 },
	{ z: 0.35, half: 0.57, bottom: 0.6, top: 1.18 },
	{ z: 0.8, half: 0.44, bottom: 0.6, top: 0.95 },
	{ z: 1.05, half: 0.24, bottom: 0.6, top: 0.68 },
];

/**
 * A mesh of lofted places and triangles. Its texture coordinates carry each vertex's place in the
 * body's own space: x and y in the first set, and z in the second. A surface then paints the body
 * from its own axes, however the car turns.
 */
function ownSpace(ctx: SketchContext, positions: number[], indices: number[]): MeshGeometry {
	const count = positions.length / 3;
	const uvs = new Float32Array(count * 2);
	const uvs1 = new Float32Array(count * 2);
	for (let k = 0; k < count; k++) {
		uvs[k * 2] = positions[k * 3] as number;
		uvs[k * 2 + 1] = positions[k * 3 + 1] as number;
		uvs1[k * 2] = positions[k * 3 + 2] as number;
	}
	return ctx.geometry.fromArrays({
		positions: new Float32Array(positions),
		uvs,
		uvs1,
		indices: new Uint32Array(indices),
		computeNormals: true,
	});
}

/** The shell: the flying car's smooth body and its two hover pods. */
export function createShell(ctx: SketchContext): MeshGeometry {
	const { positions, indices } = loftHull([
		{ sections: FLYING_CAR_BODY, ring: 16, squareness: 2.6, flatTail: true },
		...[-1, 1].map((side) => ({
			sections: FLYING_CAR_POD,
			x: side * FLYING_CAR_POD_X,
			ring: 10,
			squareness: 2,
			flatTail: false,
		})),
	]);
	return ownSpace(ctx, positions, indices);
}

/** The glass bubble over the cockpit. */
export function createCanopy(ctx: SketchContext): MeshGeometry {
	const { positions, indices } = loftHull([
		{ sections: BUBBLE, ring: 16, squareness: 2.2, flatTail: false },
	]);
	return ownSpace(ctx, positions, indices);
}

/** One block of the cockpit's inside: its middle and its size, in the body's units. */
export interface Fitting {
	at: readonly [number, number, number];
	size: readonly [number, number, number];
}

/** The cockpit's fittings: the seat's cushion and back, the yoke's column and bar, and the dash. */
export const FITTINGS: readonly Fitting[] = [
	{ at: [0, 0.72, -0.35], size: [0.42, 0.1, 0.4] },
	{ at: [0, 0.9, -0.6], size: [0.42, 0.38, 0.08] },
	{ at: [0, 0.76, 0.28], size: [0.05, 0.05, 0.24] },
	{ at: [0, 0.79, 0.17], size: [0.3, 0.04, 0.04] },
	{ at: [0, 0.8, 0.66], size: [0.72, 0.16, 0.34] },
];

/**
 * The console: the touchscreen on the dashboard's face, below the three screens, in the body's
 * units. Its middle, its width and height, and how far it leans back toward the seat, in radians.
 */
export const CONSOLE = { at: [0, 0.83, 0.46] as const, size: [0.46, 0.17] as const, lean: 0.55 };
