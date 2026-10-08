// The debug API that a sketch reaches as ctx.debug. sketch-debug.ts gives release builds calls that
// draw nothing, with the stats overlay and the frame figures. Only development builds keep draw.ts,
// which adds the drawing, so a release build holds none of it.

import type { Vec3Like } from '../math/types';
import type { ColorInput } from '../scene/color';
import type { Camera, DirectionalLight, Object3D } from '../scene/scene';
import type { FrameStats } from './stats';
import type { StatsOverlayOptions } from './stats-options';

/**
 * Options for `debug.grid`.
 *
 * @category api/debug
 */
export interface DebugGridOptions {
	/** The center of the grid. The default is the origin. */
	center?: Vec3Like;
	/** The color of the grid's lines. The default is `'#888888'`, as in three.js's `GridHelper`. */
	color?: ColorInput;
	/** The color of the two lines through the center. The default is `'#444444'`. */
	centerColor?: ColorInput;
}

/**
 * Options for `debug.light`.
 *
 * @category api/debug
 */
export interface DebugLightOptions {
	/**
	 * Where to draw the light, such as a place in view for a directional light, whose own position
	 * does not change its light. The default is the light's position.
	 */
	position?: Vec3Like;
	/** The size of the drawing in meters. The default is 1. */
	size?: number;
	/** The color of the drawing. The default is the light's own color. */
	color?: ColorInput;
}

/**
 * A debug view of `debug.view`: the materials' own shading with `'lit'`, or one debug shading in
 * place of every material.
 *
 * @category api/debug
 */
export type DebugView = 'lit' | 'normals' | 'depth' | 'wireframe' | 'overdraw' | 'shadows';

/**
 * Debug drawing and frame figures. The drawing calls draw lines that show where things are, such
 * as bounds, directions and axes. Each draws for one frame only, so call it in `onUpdate` in every
 * frame that needs the drawing. Lines are one pixel wide, and objects in front of them hide them.
 * Colors take the same forms as material colors, and positions are in world space. The overlay of
 * `stats` shows frame figures on the page, and `frameStats` gives the sketch the same figures.
 *
 * Only development builds draw. In a release build every drawing call does nothing, and the build
 * holds none of the drawing code. The calls `stats` and `frameStats` work in every build.
 *
 * @category api/debug
 */
export interface Debug {
	/**
	 * Shows an overlay of frame figures over a corner of the canvas, or hides it with `false`: the
	 * GPU path, the quality preset, the render scale, the frame rates, CPU time per frame of each
	 * thread and phase, GPU time, draw calls, triangles and objects drawn, memory, and the page
	 * thread's long tasks and input delay. Its header is a button with the frame rate, which shows
	 * and hides the other figures. Options pick the corner and whether the overlay starts collapsed
	 * to its header. The page draws the overlay and updates it a few times a second. Its code
	 * downloads at the first call. The page's `engine.stats` shows and hides the same overlay, and
	 * the last call wins. Each call sends a message to the page, so call it when the choice
	 * changes, not in every frame.
	 */
	stats(show?: boolean | StatsOverlayOptions): void;
	/**
	 * The figures that the stats overlay shows, for the sketch: means per frame over about the last
	 * half second. Call it each time you need figures, and read them from the object it returns. It
	 * allocates nothing, so a sketch can call it every frame. Its code downloads at the first call,
	 * so the figures are 0 until about half a second after that call. The first call also turns on
	 * the figures that the engine samples, for the engine's life: GPU time on one frame in eleven,
	 * the memory of textures and meshes, and on WebGPU the counts of the objects that the GPU culls.
	 */
	frameStats(): FrameStats;
	/**
	 * Draws the whole scene with one debug shading in place of every material, from the next frame
	 * on, until the next call. `'lit'` draws the materials again. `'normals'` shows each surface's
	 * world-space normal as a color, and `'depth'` its distance from the camera as a gray, white at
	 * the near plane and black at the far plane. `'overdraw'` adds light for each surface that
	 * covers a pixel, so bright pixels cost the most shading. `'wireframe'` draws each triangle's
	 * edges in its material's color. `'shadows'` shows how much of the main directional light's
	 * shadow falls on each surface, as a gray: black in full shadow, white in full light. Surfaces
	 * that face away from the sun are black, and surfaces that receive no shadows are white. Debug
	 * views clear to black and use no tone mapping. Only
	 * development builds draw them: in a release build the call does nothing. A view's first frame
	 * builds its pipelines, so objects can be missing for a few frames after a change.
	 */
	view(view: DebugView): void;
	/**
	 * Places the main directional light's shadow cascades from `camera` instead of from the active
	 * camera, from the next frame on, until the next call. The active camera still draws the frame,
	 * so it can watch from a fixed place how the cascades move as `camera` moves and turns: shadow
	 * edges that shimmer or crawl show at once. Call it with no camera to place the cascades from
	 * the active camera again. Only development builds use it: in a release build the call does
	 * nothing.
	 */
	shadowCamera(camera?: Camera): void;
	/** Draws a line from one point to another. The default color is yellow. */
	line(from: Vec3Like, to: Vec3Like, color?: ColorInput): void;
	/**
	 * Draws the edges of a box that lines up with the world's axes, from its lowest corner `min` to
	 * its highest corner `max`. The default color is yellow.
	 */
	box(min: Vec3Like, max: Vec3Like, color?: ColorInput): void;
	/**
	 * Draws a sphere as three circles around its center, one in each plane of the world's axes. The
	 * default color is yellow.
	 */
	sphere(center: Vec3Like, radius: number, color?: ColorInput): void;
	/**
	 * Draws an arrow from `origin` in `direction`, `length` meters long, with a head at its tip. The
	 * direction needs no unit length. The default length is 1, and the default color is yellow.
	 */
	arrow(origin: Vec3Like, direction: Vec3Like, length?: number, color?: ColorInput): void;
	/**
	 * Draws x, y and z axes, in red, green and blue, `size` meters long: at a position, or on an
	 * object. An object's axes take its position and rotation in the frame they draw in, so they
	 * never lag behind it. The default size is 1.
	 */
	axes(target: Object3D | Vec3Like, size?: number): void;
	/**
	 * Draws a square grid on the horizontal plane through its center, `size` meters wide, with
	 * `divisions` cells along each side, as three.js's `GridHelper` does. The defaults are 10 and 10.
	 */
	grid(size?: number, divisions?: number, options?: DebugGridOptions): void;
	/**
	 * Draws the space that a camera sees: its near and far planes and the edges between them, in the
	 * canvas's shape. The camera takes its place in the frame it draws in. The default color is
	 * orange, as in three.js's `CameraHelper`.
	 */
	frustum(camera: Camera, color?: ColorInput): void;
	/**
	 * Draws a directional light as a square that faces its light, with an arrow in the direction its
	 * light travels. The light takes its place and direction in the frame it draws in.
	 */
	light(light: DirectionalLight, options?: DebugLightOptions): void;
	/**
	 * Draws the skeleton that animates an object, such as the copy of a model that
	 * `scene.instantiate` made: a line from each joint of the model's skins to its parent joint, in
	 * the pose of the frame it draws in. As in three.js's `SkeletonHelper`, each line is blue at the
	 * joint and green at its parent, unless `color` gives one color. An object without an animator
	 * draws nothing.
	 */
	skeleton(object: Object3D, color?: ColorInput): void;
}
