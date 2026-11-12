// The island's trees: tall cypresses on the upper slopes and along the lanes, wide umbrella pines by
// the coast, low olives in groves and holm oaks in the forest, each where the town plan puts it, with
// oleanders along the lanes. The vegetation add-on's plant core grows the pines, olives, oaks and
// oleanders by species id in the job workers. They draw as its stand-ins until their species land:
// near copies as meshes whose levels thin with distance, far ones as the core's far cards, so the
// whole forest fits one view. The cypresses are the island's own solid spires.
import {
	type Camera,
	type InstanceBatch,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import { createGrass, type PlantMaterial, setWindLayer } from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import { type PlantSpot, plantSpecies } from '../../lib/plants';
import { Noise } from '../../lib/procedural';
import {
	ISLAND_HOLM_OAK,
	ISLAND_OLEANDER,
	ISLAND_OLIVE,
	ISLAND_STONE_PINE,
} from '../../lib/stand-ins';
import { cypress, finish } from './kit';
import {
	CYPRESS,
	FILL_SPOTS,
	OAK,
	OLIVE,
	SHRUBS,
	standing,
	TREE_SPOTS,
	type TreeSpot,
	UMBRELLA,
} from './plan';
import { onRetainingWall, parkLawns } from './town';

/** The share of the plan's trees that each preset stands on the island. */
export const TREE_SHARE: Record<QualityPreset, number> = {
	low: 0.3,
	medium: 0.55,
	high: 0.8,
	ultra: 1,
};

/** The distance past which the far canopy's cypresses draw, as their plainest spires, in meters. */
const FAR_SPIRES: Record<QualityPreset, number> = { low: 90, medium: 130, high: 130, ultra: 300 };

/** The wind field's box around the camera, in meters, and the cells across it. */
const WIND_BOX = 160;
const WIND_GRID = 64;

/** The tufts of grass on each park's lawn at High. */
const GRASS_TUFTS = 9000;
/** The blades' color: a summer lawn, drier than the turf of the golf course. */
const GRASS_COLOR = '#55752c';
/** How far a tuft draws, in meters. */
const GRASS_REACH = 170;

/** The layer that the sun sees and no camera does, for shadow casters that the views leave out. */
export const CASTER_LAYER = 1 << 2;

/** How far the far canopy draws, in meters: past the whole island from any view. */
const FILL_REACH = 6000;

/** The seeds that grow the trees and the shrubs. */
const TREE_SEED = 17;
const SHRUB_SEED = 23;

/**
 * Each planted kind's number in the plan, its species id, and the size and colors of its stand-in.
 * A copy's scale multiplies the stand-in's height.
 */
const KINDS = [
	{
		kind: UMBRELLA,
		// A tall bare red trunk under a wide flat dark crown of needles.
		id: ISLAND_STONE_PINE.id,
		standIn: ISLAND_STONE_PINE.standIn,
	},
	{
		kind: OLIVE,
		// A short gnarled trunk under fine silver-green leaves.
		id: ISLAND_OLIVE.id,
		standIn: ISLAND_OLIVE.standIn,
	},
	{
		kind: OAK,
		// A round dark crown, full to the ground, for the forest and the square's shade.
		id: ISLAND_HOLM_OAK.id,
		standIn: ISLAND_HOLM_OAK.standIn,
	},
] as const;

/** The lanes' shrubs: low rounded oleanders. */
const SHRUB = {
	id: ISLAND_OLEANDER.id,
	standIn: ISLAND_OLEANDER.standIn,
} as const;

/** A cypress's foliage: upward sprays of darker and paler green, near white, which its colors tint. */
function spireMap({ textures }: SketchContext) {
	const size = 512;
	const noise = new Noise(211);
	const data = new Uint8Array(size * size * 4);
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size; i++) {
			const [u, v] = [i / size, j / size];
			const sprays = noise.fbm2(u * 32, v * 24, 3, 32) + 0.5 * noise.fbm2(u * 90, v * 80, 2, 90);
			const tone = 150 + Math.min(105, Math.max(-110, sprays * 170));
			const at = (j * size + i) * 4;
			data[at] = data[at + 1] = data[at + 2] = tone;
			data[at + 3] = 255;
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/** Writes each row's place, turn and size into a batch of meshes. */
function fill(batch: InstanceBatch, spots: readonly TreeSpot[]): void {
	const turn = quat.create();
	spots.forEach((spot, k) => {
		batch.positions.set([spot.x, spot.y, spot.z], k * 3);
		quat.fromEuler(turn, 0, spot.turn, 0);
		batch.rotations.set(turn, k * 4);
		batch.scales.set([spot.scale, spot.scale, spot.scale], k * 3);
	});
	batch.markDirty();
}

/** A plan spot as a copy of variant 0 of its species. */
const copyOf = (spot: TreeSpot): PlantSpot => ({
	x: spot.x,
	y: spot.y,
	z: spot.z,
	turn: spot.turn,
	scale: spot.scale,
	variant: 0,
});

/**
 * Places the cypresses, which need no species assets: solid spires that look the same from every
 * distance. A live page places them before the other species grow, so they stand in the first
 * frame.
 */
export function createCypressSpires(ctx: SketchContext): void {
	const preset = ctx.quality.preset;
	const onWall = onRetainingWall();
	const kept = standing(TREE_SPOTS, TREE_SHARE[preset]).filter((spot) => !onWall(spot.x, spot.z));
	placeCypresses(ctx, kept, standing(FILL_SPOTS, TREE_SHARE[preset]));
}

/** Places the cypresses of a list of spots. */
function placeCypresses(
	ctx: SketchContext,
	kept: readonly TreeSpot[],
	fills: readonly TreeSpot[],
): void {
	const preset = ctx.quality.preset;
	const spires = kept.filter((spot) => spot.kind === CYPRESS);
	const mesh = ctx.geometry.fromArrays(finish(cypress(14, 18)));
	mesh.setLevels([
		{ mesh: ctx.geometry.fromArrays(finish(cypress(8, 8))), error: 0.03 },
		{ mesh: ctx.geometry.fromArrays(finish(cypress(5, 4))), error: 0.14 },
	]);
	const foliage = spireMap(ctx);
	const batch = ctx.scene.createInstances(mesh, spires.length, {
		material: ctx.materials.standard({ map: foliage, vertexColors: true, roughness: 0.95 }),
		castShadows: true,
		receiveShadows: true,
	});
	fill(batch, spires);
	// The far canopy's cypresses stand only as the plainest spires, past the near trees.
	const farSpires = fills.filter((spot) => spot.kind === CYPRESS);
	if (farSpires.length > 0) {
		const plain = ctx.geometry.fromArrays(finish(cypress(5, 4)));
		const far = ctx.scene.createInstances(plain, farSpires.length, {
			material: ctx.materials.standard({ map: foliage, vertexColors: true, roughness: 0.95 }),
			castShadows: false,
			receiveShadows: true,
		});
		fill(far, farSpires);
		far.setDrawRange(FAR_SPIRES[preset], FILL_REACH);
	}
}

/**
 * Grows the island's trees for the preset, and returns the call that moves them in the wind. A
 * scene that places the cypresses before the first frame passes `spires: false`, so no copy stands
 * twice.
 */
export async function createTrees(
	ctx: SketchContext,
	camera: Camera,
	{ spires = true }: { spires?: boolean } = {},
): Promise<{ update(): void }> {
	const preset = ctx.quality.preset;
	const onWall = onRetainingWall();
	const kept = standing(TREE_SPOTS, TREE_SHARE[preset]).filter((spot) => !onWall(spot.x, spot.z));
	const fills = standing(FILL_SPOTS, TREE_SHARE[preset]);
	const wind = createWind(ctx, { camera, box: WIND_BOX, grid: WIND_GRID });
	// Each kind's kept trees and its far canopy are copies of one species: the core draws the near
	// ones as meshes and hands every copy over to its far card with distance.
	const kinds = KINDS.map(({ kind, id, standIn }) =>
		plantSpecies(ctx, {
			id,
			standIn,
			seed: TREE_SEED,
			spots: [...kept, ...fills].filter((spot) => spot.kind === kind).map(copyOf),
			wind: wind.field,
			far: true,
		}),
	);
	// A shrub's turn comes from its place in the plan, since the plan gives it none.
	const shrubs = plantSpecies(ctx, {
		id: SHRUB.id,
		standIn: SHRUB.standIn,
		seed: SHRUB_SEED,
		spots: standing(SHRUBS, TREE_SHARE[preset]).map((spot, k) => ({
			x: spot.x,
			y: spot.y,
			z: spot.z,
			turn: Math.imul(k + 1, 2654435761) / 683565275,
			scale: spot.scale,
			variant: 0,
		})),
		wind: wind.field,
	});
	const swaying: PlantMaterial[] = (await Promise.all([...kinds, shrubs])).flatMap(
		(planted) => planted.materials,
	);
	const lawns = await Promise.all(
		parkLawns().map((lawn, k) =>
			createGrass(ctx, {
				height: () => lawn.height,
				area: { x: lawn.x, z: lawn.z, size: lawn.size },
				count: GRASS_TUFTS,
				seed: 41 + k,
				blades: 9,
				segments: 2,
				shapes: 2,
				where: lawn.where,
				color: GRASS_COLOR,
				wind: wind.field,
				// The lawns set their own draw range, so their rows stay a batch on both paths.
				compute: false,
			}),
		),
	);
	for (const lawn of lawns) for (const batch of lawn.batches) batch.setDrawRange(0, GRASS_REACH);
	ctx.quality.onChange(() => {
		for (const lawn of lawns) lawn.fit(ctx.quality.preset);
	});
	if (spires) placeCypresses(ctx, kept, fills);
	return {
		update() {
			// The field's box follows the camera, and a gust fades, so it steps every frame.
			wind.update();
			setWindLayer(swaying, wind.field);
			for (const lawn of lawns) lawn.setWindLayer(wind.field);
		},
	};
}
