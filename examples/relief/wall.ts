// The relief demo's brick wall: bays of brick between brick piers, along a straight line that runs
// down the slope. Each bay's top sits on a whole course above the highest ground under it, so the
// wall steps down with the hill, and the bricks of every bay line up. The bays and piers are flat
// boxes whose bricks get their depth from parallax, and cap stones of sandstone, whose grain is a
// bump map, cover their tops.
import type { Material, MeshGeometry, SketchContext, Texture } from '@null3d/engine';
import { brickColor, bricks, grain, grainColor, maps } from './heights';

/** A brick's length and a course's height, in meters. The brick map holds 4 bricks by 8 courses. */
const [BRICK, COURSE] = [0.36, 0.15];
/** Where the wall starts, its heading from the x axis, its bays, and their and the piers' length. */
const WALL = { x: -6.4, z: -0.6, turn: 0.45, bays: 4, bay: BRICK * 6, pier: BRICK * 1.5 };
/** The heights of the bays' and the piers' boxes, in whole courses, which reach below the ground. */
const [BAY_TALL, PIER_TALL] = [COURSE * 20, COURSE * 24];

/**
 * Builds the wall on the ground that `ground` gives at x and z. `texture` makes a texture of a
 * map's texels, in a color space.
 */
export function buildWall(
	{ scene, geometry, materials }: Pick<SketchContext, 'scene' | 'geometry' | 'materials'>,
	texture: (data: Uint8Array, colorSpace: 'linear' | 'srgb') => Texture,
	ground: (x: number, z: number) => number,
) {
	const [brickHeights, brickColors] = maps(bricks, brickColor);
	const relief = {
		map: texture(brickColors, 'srgb'),
		displacementMap: texture(brickHeights, 'linear'),
	};
	// Each material repeats the bricks so that they keep their size on its boxes.
	const brickwork = (width: number, tall: number) =>
		materials.standard({
			...relief,
			roughness: 0.85,
			displacementScale: 0.04,
			parallax: true,
			uvTransform: { repeat: [width / (BRICK * 4), tall / (COURSE * 8)] },
		});
	const [grainHeights, grainColors] = maps(grain, grainColor);
	const sandstone = materials.standard({
		map: texture(grainColors, 'srgb'),
		roughness: 0.9,
		bumpMap: texture(grainHeights, 'linear'),
		bumpScale: 3,
	});

	const { x: x0, z: z0, turn, bays, bay, pier } = WALL;
	const facing = [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)] as const;
	// The point on the ground plan at a distance along the wall's line, and where each bay starts.
	const onWall = (at: number) => [x0 + Math.cos(turn) * at, z0 - Math.sin(turn) * at] as const;
	const start = (k: number) => pier + k * (bay + pier);
	// Puts a box at a distance along the wall's line, with its top at a height.
	const place = (box: MeshGeometry, material: Material, at: number, top: number, tall: number) => {
		const [x, z] = onWall(at);
		const solid = { castShadows: true, receiveShadows: true };
		scene.createMesh({
			mesh: box,
			material,
			position: [x, top - tall / 2, z],
			rotation: facing,
			...solid,
		});
	};
	// The highest ground under a bay, from points along it.
	const highest = (k: number) => {
		let top = -Infinity;
		for (let i = 0; i <= 8; i++) top = Math.max(top, ground(...onWall(start(k) + (bay * i) / 8)));
		return top;
	};
	const bayBox = geometry.box({ width: bay, height: BAY_TALL, depth: 0.3 });
	const pierBox = geometry.box({ width: pier, height: PIER_TALL, depth: pier });
	const capStone = geometry.box({ width: bay / 4 - 0.012, height: 0.09, depth: 0.42 });
	const pierCap = geometry.box({ width: pier + 0.14, height: 0.12, depth: pier + 0.14 });
	const [bayBricks, pierBricks] = [brickwork(bay, BAY_TALL), brickwork(pier, PIER_TALL)];
	const tops = Array.from(
		{ length: bays },
		(_, k) => Math.ceil((highest(k) + 1.3) / COURSE) * COURSE,
	);
	tops.forEach((top, k) => {
		place(bayBox, bayBricks, start(k) + bay / 2, top, BAY_TALL);
		for (let i = 0; i < 4; i++)
			place(capStone, sandstone, start(k) + (bay / 4) * (i + 0.5), top + 0.09, 0.09);
	});
	for (let k = 0; k <= bays; k++) {
		const top = Math.max(tops[k - 1] ?? -Infinity, tops[k] ?? -Infinity) + COURSE * 2;
		place(pierBox, pierBricks, start(k) - pier / 2, top, PIER_TALL);
		place(pierCap, sandstone, start(k) - pier / 2, top + 0.12, 0.12);
	}
}
