// The island's garden pools as real water, drawn by the water add-on. A pool follows its own
// house's ground, so its surface has its own level: the pools within reach of the camera, those
// that share the nearest pool's level band, draw as one body, and the far pools keep the gardens'
// flat quads. The body reads the island's one wind field, so a gust crosses the pools as it crosses
// the trees.
import type { Camera, SketchContext } from '@null3d/engine';
import { createWater, type LakeShape, type Water } from '@null3d/water';
import type { WindField } from '@null3d/wind';
import { POOLS } from './plan';

/** How far two pools' water levels may differ and still share one body's surface, in meters. */
export const POOL_BAND = 0.08;
/** How far a body's surface lies above the pools' drawn water, so the two never fight for a depth. */
const POOL_LIFT = 0.006;
/** How far from the camera a pool draws with the water add-on, in meters. */
export const POOL_NEAR = 70;
/** The side of the cell in which the body is rebuilt as the camera moves, in meters. */
const NEAR_CELL = 20;
/**
 * The side of a pool body's mesh cell, in meters. The add-on runs a surface two cells past its shore
 * so that the water fades against a natural bank; a pool ends at a coping, so the two cells and the
 * grid step that follows them must stay within the coping's width and out of sight under it.
 */
const POOL_CELL = 0.08;
/** A pool's water, which shares the wind's crests. */
const POOL_MATERIAL = {
	attenuationColor: '#2e7f9c',
	attenuationDistance: 2.4,
	roughness: 0.06,
} as const;

/** A pool's water as a lake: its rectangle in the world, turned with its garden. */
function lake(pool: (typeof POOLS)[number]): LakeShape {
	const { lot, water } = pool;
	const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
	const at = (u: number, v: number): [x: number, z: number] => [
		lot.x + u * c + v * s,
		lot.z - u * s + v * c,
	];
	return {
		kind: 'lake',
		shore: [
			at(water.x0, water.z0),
			at(water.x1, water.z0),
			at(water.x1, water.z1),
			at(water.x0, water.z1),
		],
		depth: 1.2,
		shoreWidth: 0.3,
	};
}

/** The world place of a pool's water, for the body's reach. */
function centre(pool: (typeof POOLS)[number]): readonly [x: number, z: number] {
	const { lot, water } = pool;
	const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
	const [u, v] = [(water.x0 + water.x1) / 2, (water.z0 + water.z1) / 2];
	return [lot.x + u * c + v * s, lot.z - u * s + v * c];
}

/** Water for a band's lakes at one level, reading the island's own wind when the page passes one. */
function water(
	ctx: SketchContext,
	camera: Camera,
	wind: WindField | undefined,
	lakes: readonly LakeShape[],
	level: number,
): Water {
	return createWater(ctx, {
		shapes: lakes,
		level: level + POOL_LIFT,
		camera,
		...(wind && { wind }),
		bed: 'shape',
		mesh: { cell: POOL_CELL },
		// The surface lies a few millimeters above the pools' drawn water, which is the bed behind it,
		// so a shore fade measured in centimeters would hide the surface almost completely. A pool ends
		// at a coping rather than a beach, so its waterline is hard.
		softness: 0.001,
		// A pool is small beside a long swell, so its own short crests take the island's air: the
		// surface's reflection moves with the same gusts that sway the trees. Calm air leaves it a
		// still mirror, which is what a sheltered courtyard pool is.
		windRipple: 1,
		waveAmplitude: 0.01,
		ripple: 0,
		reflectionScale: 0.5,
		// A pool lies far below the eye line and spans a few meters, so its mirror repeats a scene that
		// the eye barely reads in it: at High the body draws its reflection every second frame.
		reflectionEvery: { high: 3 },
		material: POOL_MATERIAL,
	});
}

/**
 * The pools' water: the pools within reach of the camera, at the nearest pool's level, in one body.
 * A page that passes no wind field draws still water, which a control picture can compare against.
 * The page's own frame loop calls `update`, after the shared wind field has stepped.
 */
export function createPoolWater(
	ctx: SketchContext,
	camera: Camera,
	wind: WindField | undefined,
): { readonly bodies: number; update(): void } {
	let waters: Water[] = [];
	let cell = '';
	const here: [number, number, number] = [0, 0, 0];
	/** The pools in reach, at the nearest pool's level, in one body; none when the camera is away. */
	const rebuild = () => {
		const [x, , z] = here;
		const inReach = POOLS.map((pool) => {
			const [px, pz] = centre(pool);
			return { pool, distance: Math.hypot(px - x, pz - z) };
		})
			.filter(({ distance }) => distance <= POOL_NEAR)
			.sort((a, b) => a.distance - b.distance);
		for (const body of waters) body.destroy();
		waters = [];
		const nearest = inReach[0];
		if (!nearest) return;
		const band = Math.round(nearest.pool.level / POOL_BAND);
		const banded = inReach.filter(({ pool }) => Math.round(pool.level / POOL_BAND) === band);
		const level = Math.max(...banded.map(({ pool }) => pool.level));
		waters = [
			water(
				ctx,
				camera,
				wind,
				banded.map(({ pool }) => lake(pool)),
				level,
			),
		];
	};
	camera.getPosition(here);
	cell = `${Math.floor(here[0] / NEAR_CELL)},${Math.floor(here[2] / NEAR_CELL)}`;
	rebuild();
	return {
		get bodies() {
			return waters.length;
		},
		update() {
			camera.getPosition(here);
			const next = `${Math.floor(here[0] / NEAR_CELL)},${Math.floor(here[2] / NEAR_CELL)}`;
			if (next !== cell) {
				cell = next;
				rebuild();
			}
			for (const body of waters) body.update();
		},
	};
}
