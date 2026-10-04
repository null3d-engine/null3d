// The built-in environments, which `assets.builtinEnvironment` imports the first time, so a page
// without one never downloads this. The thread that draws makes each one's cube map on the GPU
// (D-19), so the engine's package ships no file for it. Only the nine coefficients of each one's
// diffuse light live here.

/** A built-in environment: the size and the levels of its cube map, and its diffuse light. */
export interface BuiltinEnvironment {
	/** The width of the largest faces of its cube map. */
	readonly size: number;
	/** Its cube map's mip levels, one for each roughness step. */
	readonly levels: number;
	/** The nine coefficients' red, green and blue values, in three.js's order. */
	readonly sh: Float32Array;
}

/**
 * The nine spherical harmonics coefficients of the room's diffuse light, in three.js's order. The
 * room is white, so red, green and blue are the same. They are those of the asset tool's
 * `--builtin room` map, which a test of the tool checks. The room never changes, so its diffuse
 * light needs no work on the GPU, and none read back from it.
 */
const ROOM_SH = [
	3.7117193, 1.725998, 1.5873853, 0.25796816, 0.19504821, 1.0360302, 1.1947244, -0.339987,
	-0.609752,
];

/** The built-in environments, by name. Each cube map has faces of 256 texels down to 8. */
export const BUILTIN_ENVIRONMENTS = {
	/** The room that three.js's `RoomEnvironment` builds: a white room with boxes and lit panels. */
	room: { size: 256, levels: 6, sh: Float32Array.from(ROOM_SH.flatMap((c) => [c, c, c])) },
} as const satisfies Record<string, BuiltinEnvironment>;
