// The engine's rule for a mesh's levels of detail, as a sketch reads it: the distance at which one
// of a part's levels switches in, the distances at which a view measures a part's bounds, and the
// level that a distance picks. The core picks the level of every source that a frame draws by this
// rule (`crates/null3d-core/src/levels.rs`), so a scene that budgets its triangles asks the same
// rule instead of copying it. A copy is a shadow of the core and drifts from it as soon as the
// core's figures change.
//
// A level's switch measure is its error, a hand-set distance, or the share of the render's height
// that the bounds cover. An error is the largest distance between the level's surface and the base
// mesh's, in the units of the base mesh's positions. The switch distance follows:
//
// ```text
// error:    error × scale × factor / bias
// distance: distance × scale / bias
// coverage: radius × P[1][1] / (coverage × bias)
// ```
//
// `scale` is the largest axis scale of the source's world matrix and `factor` is the render height
// in pixels times the projection's `P[1][1]`, over twice the threshold in pixels. A level given by
// its error is compared with a distance halfway into the bounds, so a large mesh keeps its fine
// levels until its near side shows them; a level given by a distance or by a coverage, and a
// distance band, compare the distance to the bounds' nearest point.

/**
 * A view that measures levels of detail: the height it renders, its vertical field of view, and the
 * threshold under which a coarser level draws.
 *
 * @category api/geometry
 */
export interface LevelView {
	/** The render height in pixels. */
	readonly height: number;
	/** The vertical field of view in degrees, between 0 and 180. */
	readonly fov: number;
	/**
	 * The largest change, in pixels, that a coarser level may make to the picture. The default is 1,
	 * the setting of the presets that High and above draw. A larger threshold draws coarser levels
	 * from nearer.
	 */
	readonly threshold?: number;
	/**
	 * True for an orthographic camera, whose pixels do not shrink with distance. The default is
	 * false. An orthographic view compares a level's error at a distance of 1, so the source's scale
	 * alone picks the level.
	 */
	readonly orthographic?: boolean;
	/**
	 * The source's threshold bias, as the inverse of Godot's `lod_bias`: a Godot bias of 2 is
	 * about a null3D bias of 0.5. Above 1 switches every level nearer, so coarser levels draw, and
	 * below 1 keeps its detail. The default is 1.
	 */
	readonly bias?: number;
}

/**
 * One of a mesh's lower levels and the measure that sets its switch: give exactly one. The fields
 * have the meanings that `MeshLevel` gives them.
 *
 * @category api/geometry
 */
export type LevelSwitch =
	| { readonly error: number }
	| { readonly distance: number }
	| { readonly coverage: number };

/**
 * A source's world bounds about the camera: the center of its bounding sphere relative to the
 * camera, and the sphere's radius.
 *
 * @category api/geometry
 */
export interface LevelBounds {
	/** The bounding sphere's center, relative to the camera. */
	readonly centre: readonly [number, number, number];
	/** The bounding sphere's radius, in meters. */
	readonly radius: number;
}

/**
 * The two distances that the rule compares for a source's bounds. A level given by its error reads
 * `error`, and a level given by a distance or by a coverage, a draw range and the rule that hides a
 * small bound read `camera`.
 *
 * @category api/geometry
 */
export interface LevelDistances {
	/** The distance to the nearest point of the bounds, which a distance or a coverage compares. */
	readonly camera: number;
	/** The distance at which an error is compared, which a level given by its error compares. */
	readonly error: number;
}

/**
 * The smallest distance that the rule measures, in meters: a camera inside the bounds reads it.
 *
 * @category api/geometry
 */
export const LEAST_LEVEL_DISTANCE = 1e-3;

/** The share of the bounds' radius that an error's distance takes off the distance to the center. */
const ERROR_RADIUS_SHARE = 0.5;

/** The multiple of the distance to the nearest point that caps an error's distance. */
const ERROR_NEAREST_SHARE = 2;

/** The projection's `P[1][1]` for a perspective view of `fov` degrees, which a coverage reads. */
function projection(fov: number): number {
	return Math.abs(1 / Math.tan((fov * Math.PI) / 360));
}

/** The factor that turns a level's error into a switch distance: height × `P[1][1]` / (2 × threshold). */
function factor(view: LevelView): number {
	const threshold = view.threshold ?? 1;
	return threshold > 0 && view.height > 0
		? (view.height * projection(view.fov)) / (2 * threshold)
		: 0;
}

/** The source's threshold bias, and 1 for a bias that is not above 0. */
function bias(view: LevelView): number {
	const value = view.bias ?? 1;
	return value > 0 ? value : 1;
}

/** The distance at which a level switches in, given the view's factor and bias. */
function switchDistance(
	view: LevelView,
	levelFactor: number,
	level: LevelSwitch,
	scale: number,
	radius: number,
): number {
	if ('error' in level) return (level.error * scale * levelFactor) / bias(view);
	if ('distance' in level) return (level.distance * scale) / bias(view);
	const p11 = projection(view.fov);
	return level.coverage > 0 && p11 > 0
		? (radius * p11) / (level.coverage * bias(view))
		: Number.POSITIVE_INFINITY;
}

/**
 * The distance at which one of a part's levels switches in.
 *
 * An error switches where it covers the view's threshold in pixels; a distance at its own figure,
 * scaled by the source; and a coverage where the bounds' radius covers that share of the render
 * height. A bias above 1 divides every result, so the level switches nearer.
 *
 * @param view The view that measures the level.
 * @param level The level's switch measure.
 * @param scale The largest axis scale of the source's world matrix.
 * @param radius The radius of the source's world bounds, in meters, which a coverage reads.
 * @returns The distance in meters at which the level draws, or `Infinity` for a coverage that is
 * not above 0.
 * @category api/geometry
 */
export function levelSwitchDistance(
	view: LevelView,
	level: LevelSwitch,
	scale: number,
	radius = 0,
): number {
	return switchDistance(view, factor(view), level, scale, radius);
}

/**
 * Both distances that a view's rule compares for a source's bounds. An error measures to a point
 * halfway into the sphere, capped at twice the distance to its nearest point, so a camera beside a
 * large mesh measures the surface below it. A distance or a coverage, and a distance band, measure
 * to the nearest point. Both are at least `LEAST_LEVEL_DISTANCE`. An orthographic view compares an
 * error at a distance of 1, since its pixels do not shrink with distance, and keeps the nearest
 * point for the other measures.
 *
 * @param view The view that measures the source.
 * @param bounds The source's bounds, with the center relative to the camera.
 * @returns The two distances, in meters.
 * @category api/geometry
 */
export function levelDistances(view: LevelView, bounds: LevelBounds): LevelDistances {
	const [x, y, z] = bounds.centre;
	const length = Math.hypot(x, y, z);
	const nearest = (radius: number) => Math.max(length - radius, LEAST_LEVEL_DISTANCE);
	const camera = nearest(bounds.radius);
	const error = view.orthographic
		? 1
		: Math.min(
				nearest(ERROR_RADIUS_SHARE * bounds.radius),
				ERROR_NEAREST_SHARE * nearest(bounds.radius),
			);
	return { camera, error };
}

/**
 * The level of detail that a source draws: 0 for the base mesh, 1 for the first lower level, and so
 * on, as `setLevels` takes them. The level is the last one whose switch distance lies under the
 * distance, which is how the core's culling picks every source. This gives the level alone, not
 * whether the source draws at all: a bound that covers fewer pixels than the threshold is hidden,
 * and a draw range hides a source outside it.
 *
 * @param view The view that measures the levels.
 * @param levels The lower levels, from the finest to the coarsest.
 * @param scale The largest axis scale of the source's world matrix.
 * @param radius The radius of the source's world bounds, in meters, which a coverage reads.
 * @param distance A distance, which both measures read as a camera does, or the two distances that
 * `levelDistances` gives.
 * @returns The level's index among the base mesh and `levels`.
 * @category api/geometry
 */
export function levelAt(
	view: LevelView,
	levels: readonly LevelSwitch[],
	scale: number,
	radius: number,
	distance: number | LevelDistances,
): number {
	const levelFactor = factor(view);
	if (!(levelFactor > 0) || levels.length === 0) return 0;
	const at: LevelDistances =
		typeof distance === 'number' ? { camera: distance, error: distance } : distance;
	let level = 0;
	for (const measure of levels) {
		const compare = 'error' in measure ? at.error : at.camera;
		if (!(switchDistance(view, levelFactor, measure, scale, radius) < compare)) break;
		level++;
	}
	return level;
}
