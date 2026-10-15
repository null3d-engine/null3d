// The marks that the decals demo lays on its street: road paint and a zebra crossing, puddles,
// cracks, a scorch mark, moss along the kerbs and mud on the road, plus the wear on the house
// fronts (stains, grime, bare bricks, posters, graffiti and cracks). Each mark is a box with a decal
// material, which projects its maps onto every surface inside it. Batches draw the many dashes,
// stripes and splashes in one draw each. A click throws mud or a scorch from a pool that reuses its
// oldest row.
import {
	type Group,
	type Material,
	math,
	type Quat,
	type SketchContext,
	type Vec3,
	type Vec3Like,
} from '@null3d/engine';
import {
	bricks,
	cracks,
	type DecalTexels,
	graffiti,
	moss,
	mud,
	poster,
	puddle,
	roadPaint,
	scorch,
	stain,
} from './decal-textures';
import { type House, KERB, LENGTH, ROAD } from './street';

/** A rotation that turns a box's +z axis up, so it projects down onto the ground. */
const DOWN: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** The down rotation, turned about the vertical by `angle`. */
const turned = (angle: number): Quat => {
	const [c, s] = [Math.SQRT1_2 * Math.cos(angle / 2), Math.SQRT1_2 * Math.sin(angle / 2)];
	return [-c, s, s, c];
};
/** A rotation that turns a box's +z axis toward the road from the wall on `side` of the street. */
const facing = (side: number): Quat => [0, -side * Math.SQRT1_2, 0, Math.SQRT1_2];
/** Rows of the pool of marks that clicks throw, which reuse the oldest row. */
const THROWN = 24;

/** The marks that the demo has built, and throws more of. */
export interface Marks {
	/** Throws a mud or a scorch mark where `point` lands on the street's ground. */
	throwAt(point: Vec3Like): void;
}

/** Builds every mark on `street` and on the fronts of `houses`, and returns the marks that clicks throw. */
export function buildMarks(
	{ scene, geometry, materials, textures }: SketchContext,
	street: Group,
	houses: House[],
): Marks {
	// Each decal's maps from the code-made textures, with mip levels for the far ones.
	const look = { mipmaps: true, anisotropy: 8 } as const;
	const decal = (texels: DecalTexels, values: Parameters<typeof materials.decal>[0] = {}) => {
		const at = { width: texels.size, height: texels.size, ...look };
		return materials.decal({
			map: textures.fromData({ ...at, data: texels.color, colorSpace: 'srgb' }),
			metalnessRoughnessMap: textures.fromData({ ...at, data: texels.finish }),
			normalMap: textures.fromData({ ...at, data: texels.normal }),
			...values,
		});
	};
	const box = geometry.box();
	const place = (material: Material, position: Vec3, scale: Vec3, rotation = DOWN) =>
		scene.createMesh({ mesh: box, material, position, scale, rotation, parent: street });
	type Row = [position: Vec3, rotation: Quat, size: Vec3];
	/** A batch of decals, one for each row of a position, a rotation and a size. */
	const many = (material: Material, rows: Row[]) => {
		const batch = scene.createInstances(box, rows.length, { material, colors: true });
		rows.forEach(([position, rotation, size], k) => {
			batch.positions.set(position, k * 3);
			batch.rotations.set(rotation, k * 4);
			batch.scales.set(size, k * 3);
		});
		return batch;
	};
	/** `count` rows on the ground, each placed by `at` as a position, a turn and a size. */
	const strewn = (count: number, at: (k: number) => [Vec3, number, Vec3]) =>
		Array.from({ length: count }, (_, k): Row => {
			const [position, angle, size] = at(k);
			return [position, turned(angle), size];
		});

	const paint = decal(roadPaint(), { roughness: 0.6 });
	// The centre line's dashes, with a gap where the zebra crossing runs.
	const dashes = Array.from({ length: 12 }, (_, k) => -LENGTH / 2 + 3 + k * 5).filter(
		(z) => Math.abs(z - 8) > 2,
	);
	many(
		paint,
		strewn(dashes.length, (k) => [[0, 0, dashes[k] as number], 0, [0.22, 2.4, 0.6]]),
	);
	many(
		paint,
		strewn(8, (k) => [[-ROAD + 0.6 + k, 0, 8], 0, [0.6, 3.2, 0.6]]),
	);
	const water = decal(puddle(), { envIntensity: 0.35 });
	place(water, [-1.8, 0, 3], [3.4, 2.6, 0.5]);
	place(water, [2.4, 0, -5], [2.6, 3.4, 0.5], turned(0.6));
	place(water, [-ROAD - 1, KERB, -9], [2.2, 1.8, 0.6], turned(1.2));
	place(water, [1, 0, 13], [3, 2.2, 0.5], turned(2.2));
	const crazing = decal(cracks());
	place(crazing, [1.5, 0, 0], [4, 4, 0.6], turned(0.4));
	place(decal(scorch()), [-2.4, 0, -14], [4.5, 4.5, 1], turned(1));
	many(
		decal(moss()),
		strewn(10, (k) => [
			[(k % 2 ? 1 : -1) * (ROAD + 2.9), KERB, -LENGTH / 2 + 4 + k * 5.5],
			k * 0.9,
			[2.2, 2.2, 3],
		]),
	);
	many(
		decal(mud()),
		strewn(9, (k) => [[(k % 2 ? 1 : -1) * (ROAD - 0.5), 0, -22 + k * 5], k * 1.7, [1.6, 1.6, 0.8]]),
	);

	// The house fronts' wear. Each box stands at the wall, reaching out over the ledges and signs.
	// Stains run down from the window sills, grime from the ledges and the cornice, and the piers
	// beside the doors and shop windows carry posters, graffiti, cracks or bare bricks.
	const wear = new Map<Material, Row[]>();
	const mark = (material: Material, side: number, at: Vec3, width: number, height: number) => {
		const rows = wear.get(material) ?? [];
		wear.set(material, rows);
		rows.push([at, facing(side), [width, height, 0.8]]);
	};
	const sill = decal(stain(128, 10, 6));
	const grime = decal(stain(256, 11, 48));
	const brick = decal(bricks());
	const posters = [0, 1, 2].map((k) => decal(poster(128, 8 + k, k), { roughness: 0.85 }));
	const tags = [0, 1].map((k) => decal(graffiti(256, 9 + k, k)));
	const pick = <T>(list: readonly T[]) => list[Math.floor(math.randFloat(0, list.length))] as T;
	for (const { side, face, z, height, floors } of houses) {
		const x = face - side * 0.2;
		mark(grime, side, [x, height - 0.55, z], 7.6, 0.5);
		for (const y of floors) {
			if (y + 1.4 < height - 0.4) mark(grime, side, [x, y + 1.09, z], 7.6, 0.5);
			for (const dz of [-2.4, 0, 2.4])
				if (math.randFloat(0, 1) < 0.55) {
					// The lowest floor's stains stop short of the shop signs below them.
					const run = y < 5 ? 0.75 : 1;
					mark(sill, side, [x, y - 0.87 - run / 2, z + dz], 1.1, run);
				}
			if (math.randFloat(0, 1) < 0.45) mark(brick, side, [x, y + 0.1, z + pick([-1.2, 1.2])], 1, 1);
		}
		// The pier between the door and the shop window, then the pier at the house's end.
		const low = pick(['bricks', 'tag', 'none'] as const);
		if (low === 'bricks') mark(brick, side, [x, 0.9, z - 1.4], 1.2, 1.2);
		if (low === 'tag') mark(pick(tags), side, [x, 0.8, z - 1.4], 1.15, 0.65);
		const end = pick(['poster', 'posters', 'tag', 'cracks', 'bricks'] as const);
		if (end === 'poster' || end === 'posters')
			mark(pick(posters), side, [x, 1.5, z + 3.2], 0.75, 1.05);
		if (end === 'posters') mark(pick(posters), side, [x, 1.25, z + 3.05], 0.7, 1);
		if (end === 'tag') mark(pick(tags), side, [x, 0.8, z + 3.2], 1.15, 0.65);
		if (end === 'cracks') mark(crazing, side, [x, 1.4, z + 3.2], 1.2, 2.4);
		if (end === 'bricks') mark(brick, side, [x, 1.6, z + 3.2], 1.15, 1.15);
	}
	for (const [material, rows] of wear) many(material, rows);

	// Marks that clicks throw: mud and scorch in turns, from pools that hide their unused rows.
	const thrown = [decal(mud()), decal(scorch())].map((material) =>
		many(
			material,
			strewn(THROWN, () => [[0, -100, 0], 0, [1.8, 1.8, 1]]),
		),
	);
	let throws = 0;
	return {
		throwAt(point) {
			const pool = thrown[throws % 2] as (typeof thrown)[number];
			const row = Math.floor(throws / 2) % THROWN;
			pool.positions.set([point[0], 0, point[2]], row * 3);
			pool.rotations.set(turned(throws * 2.4), row * 4);
			pool.markDirty(row);
			throws++;
		},
	};
}
