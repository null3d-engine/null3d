// The clearance guard of the showcase scenes' Auto route: the route never passes through an object
// unless the shot intends to reveal an inside. It raycasts the scene's own geometry (D-30), the same
// set that a query reaches, and keeps a margin from a surface. The Manual camera is free and may
// pass through anything, so it does not use this guard.
//
// An object whose inside a visitor may see is put on `INTERIOR_LAYER` alone, and what fills the air,
// such as snow, on `EFFECT_LAYER` alone: the guard never tests either, so a snowflake is not a wall
// and a cave may be entered. The scene's camera must draw both layers.
//
// The guard allocates nothing per call: it holds its ray and its one hit result, made once.
import { type RaycastHit, type SketchContext, type Vec3Like, vec3 } from '@null3d/engine';
import { SOLID_LAYERS } from './layers';

export { EFFECT_LAYER, INTERIOR_LAYER, markEffect, markInterior } from './layers';

/** How the clearance guard is made. */
export interface ClearanceOptions {
	/** How far the camera stays from a surface, in meters. The default is 0.5. */
	margin?: number;
}

/** The clearance guard of a showcase scene. */
export interface Clearance {
	/**
	 * The farthest point from `from` toward `to` that no surface blocks, into `out`, keeping the
	 * margin. Returns true when it moved the point.
	 */
	move(from: Vec3Like, to: Vec3Like, out: Vec3Like): boolean;
}

/**
 * Makes the clearance guard of a showcase scene's Auto route: `move` clamps a straight move so the
 * camera slides along a surface instead of passing through it. The Manual camera is free and does
 * not use it.
 */
export function createClearance(ctx: SketchContext, options: ClearanceOptions = {}): Clearance {
	const margin = options.margin ?? 0.5;
	const origin = vec3.create();
	const direction = vec3.create();
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: vec3.create(),
		normal: vec3.create(),
		distance: 0,
		triangle: -1,
	};
	const solids = { layers: SOLID_LAYERS };
	/** The raycast along a unit direction, up to a distance. True with the nearest hit. */
	const cast = (
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
	): boolean => {
		origin[0] = ox;
		origin[1] = oy;
		origin[2] = oz;
		direction[0] = dx;
		direction[1] = dy;
		direction[2] = dz;
		return ctx.scene.raycast(origin, direction, solids, hit);
	};
	return {
		move(from, to, out) {
			const ax = (to[0] as number) - (from[0] as number);
			const ay = (to[1] as number) - (from[1] as number);
			const az = (to[2] as number) - (from[2] as number);
			const length = Math.hypot(ax, ay, az);
			out[0] = to[0] as number;
			out[1] = to[1] as number;
			out[2] = to[2] as number;
			if (length <= margin) return false;
			const dx = ax / length;
			const dy = ay / length;
			const dz = az / length;
			// A move is only stopped by a surface ahead of it. An origin already within the margin
			// of a surface, such as the ground, never pins the move: the point may move away from
			// it freely.
			if (!cast(from[0] as number, from[1] as number, from[2] as number, dx, dy, dz)) return false;
			if (hit.distance <= margin || hit.distance >= length - margin) return false;
			const stop = hit.distance - margin;
			out[0] = (from[0] as number) + dx * stop;
			out[1] = (from[1] as number) + dy * stop;
			out[2] = (from[2] as number) + dz * stop;
			return true;
		},
	};
}
