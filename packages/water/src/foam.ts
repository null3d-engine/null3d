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
	/** How far the foam reaches around an obstacle, in meters. It is 0.35 by default. */
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
	if (reach <= 0) throw new Error('@null3d/water: a foam reach must be above 0');
	// The map's cells are square, so one texel covers the same distance along both axes.
	const texel = size[0] / width;
	const near = new Float32Array(width * height);
	for (const { x, z, r } of obstacles) {
		const [i0, i1] = [(x - r - reach - origin[0]) / texel, (x + r + trail - origin[0]) / texel];
		const [j0, j1] = [(z - r - reach - origin[1]) / texel, (z + r + reach - origin[1]) / texel];
		for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(height - 1, Math.ceil(j1)); j++) {
			for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(width - 1, Math.ceil(i1)); i++) {
				const dx = i * texel + origin[0] - x;
				const dz = j * texel + origin[1] - z;
				// Downstream, the distance counts less, so the foam trails behind the obstacle.
				const along = dx > 0 && trail > 0 ? dx * (reach / trail) : dx;
				const edge = Math.hypot(along, dz) - r;
				const value = 1 - Math.min(Math.max(edge / reach, 0), 1);
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
