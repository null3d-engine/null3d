// The foam around what breaks the water's surface. A map made once from the things that stand in
// the water — stones, posts, the piers of a bridge — holds how near each point lies to one of them,
// from 1 at its edge to 0 a little way off, and stretches that reach downstream so the foam trails
// behind. The surface shader breaks the map into moving flecks that the current carries away.
import type { SketchContext } from '@null3d/engine';
import type { FoamMap } from './water';

/**
 * Something that breaks the water's surface: its middle and its radius at the surface.
 *
 * @category api/water
 */
export interface FoamObstacle {
	/** The x of the obstacle's middle, in meters. */
	readonly x: number;
	/** The z of the obstacle's middle, in meters. */
	readonly z: number;
	/** The obstacle's radius at the water's surface, in meters. */
	readonly r: number;
	/**
	 * How far this obstacle's foam reaches from its edge, in meters, in place of the map's `reach`.
	 * It suits a scene whose parts of one water carry different foam, such as a creek whose arms
	 * break the surface by different amounts.
	 */
	readonly reach?: number;
}

/**
 * Options of `foamMap`.
 *
 * @category api/water
 */
export interface FoamMapOptions {
	/** The world point that the map's first texel covers, as [x, z] in meters. */
	readonly origin: readonly [x: number, z: number];
	/** The world area that the map covers, as [x, z] in meters. */
	readonly size: readonly [x: number, z: number];
	/** The map's texels along x. It is 1024 by default. */
	readonly width?: number;
	/** The map's texels along z. It is 224 by default. */
	readonly height?: number;
	/**
	 * How far the foam reaches around an obstacle, in meters. It is 0.35 by default, and every
	 * obstacle that gives no reach of its own takes it.
	 */
	readonly reach?: number;
	/**
	 * How far downstream, toward +x, the foam trails behind an obstacle, in meters. It is 1.6 by
	 * default, and 0 leaves a ring.
	 */
	readonly trail?: number;
}

/**
 * Makes the map of the foam around `obstacles`, over the `origin` and `size` area that the water
 * covers. The water samples it as its `foam` map, and the surface breaks it into flecks that drift
 * downstream.
 *
 * @category api/water
 */
export function foamMap(
	{ textures }: SketchContext,
	obstacles: readonly FoamObstacle[],
	options: FoamMapOptions,
): FoamMap {
	const origin = options.origin;
	const size = options.size;
	const width = options.width ?? 1024;
	const height = options.height ?? 224;
	const reach = options.reach ?? 0.35;
	const trail = options.trail ?? 1.6;
	if (width < 1 || height < 1)
		throw new Error('@null3d/water: a foam map needs texels in both axes');
	if (size[0] <= 0 || size[1] <= 0)
		throw new Error('@null3d/water: a foam map size must be above 0');
	// A reach that is not a finite number above 0 lays no foam, or lays it over the whole map.
	if (!(reach > 0) || !Number.isFinite(reach))
		throw new Error('@null3d/water: a foam reach must be a finite number above 0');
	// The map's cells are square, so one texel covers the same distance along both axes.
	const texel = size[0] / width;
	const near = new Float32Array(width * height);
	for (const { x, z, r, reach: own } of obstacles) {
		// Each mark reaches as far as it names, and as far as the map names without one.
		const mark = own ?? reach;
		if (!(mark > 0) || !Number.isFinite(mark))
			throw new Error('@null3d/water: a foam reach must be a finite number above 0');
		// Downstream the foam fades out at the end that the mark's reach gives the trail, which the
		// radius stretches: the loop must run to there, or the map cuts a tail that still foams.
		const end = trail * (1 + r / mark);
		const [i0, i1] = [(x - r - mark - origin[0]) / texel, (x + end - origin[0]) / texel];
		const [j0, j1] = [(z - r - mark - origin[1]) / texel, (z + r + mark - origin[1]) / texel];
		for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(height - 1, Math.ceil(j1)); j++) {
			for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(width - 1, Math.ceil(i1)); i++) {
				const dx = i * texel + origin[0] - x;
				const dz = j * texel + origin[1] - z;
				// Downstream, the distance counts less, so the foam trails behind the obstacle.
				const along = dx > 0 && trail > 0 ? dx * (mark / trail) : dx;
				const edge = Math.hypot(along, dz) - r;
				const value = 1 - Math.min(Math.max(edge / mark, 0), 1);
				const k = j * width + i;
				if (edge > -r && value > (near[k] as number)) near[k] = value;
			}
		}
	}
	const data = new Uint8Array(width * height * 4);
	for (let k = 0; k < near.length; k++) data[k * 4] = Math.round((near[k] as number) * 255);
	return {
		texture: textures.fromData({ width, height, data, colorSpace: 'linear' }),
		origin: [origin[0], origin[1]],
		size: [size[0], size[1]],
	};
}
