// The island's trees, grown by the vegetation add-on from records of numbers: tall cypresses on the
// upper slopes and along the lanes, wide umbrella pines by the coast, and low olives in groves, each where
// the town plan puts it. Near trees draw
// as meshes whose levels thin with distance, and far ones as cards baked from the same plants, so
// the whole forest fits one view and a close look shows the leaves.
import {
	type Camera,
	type InstanceBatch,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import { createImpostors } from '@null3d/impostors';
import {
	type BranchLevel,
	bakeFarTree,
	bakePlantAtlases,
	builtInSpecies,
	createGrass,
	generatePlant,
	handOverToCards,
	leafCellFor,
	type PlantAsset,
	type PlantMaterial,
	plantMaterial,
	plantWind,
	type Species,
	setWindLayer,
	swayDistanceFor,
	treeValues,
} from '@null3d/vegetation';
import { createWind, type Wind } from '@null3d/wind';
import { Noise } from '../../lib/procedural';
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
/** The distance from the camera at which a tree hands over from its mesh to its card, in meters. */
const SWITCH: Record<QualityPreset, number> = { low: 90, medium: 130, high: 130, ultra: 300 };

/**
 * The views that a tree's card is baked from, over the whole sphere. Too few sit so far apart that the
 * blend of the nearest three blurs the crown, and its shape changes as the camera turns.
 */
const CARD_VIEWS: Record<QualityPreset, number> = { low: 25, medium: 49, high: 81, ultra: 81 };

/**
 * The error that each level of a tree's mesh switches at, from the base level on. The add-on measures
 * a level's error by the leaves it drops, whose switches lie past the distance where the card takes
 * over, so these bring the switches well inside it: the second level past about 45 meters on a 1080p
 * screen, and the third past about 95. Shadow maps pick each at half that distance.
 */
const LEVEL_ERRORS = [0, 0.03, 0.065];

/** The wind field's box around the camera, in meters, and the cells across it. */
const WIND_BOX = 160;
const WIND_GRID = 64;

/** The error that each level of a shrub switches at, from the base level on: past 25 and 70 meters at 1080p. */
const SHRUB_LEVEL_ERRORS = [0, 0.02, 0.055];

/** How far a shrub draws, in meters: past it, a bush is a few pixels among the trees. */
const SHRUB_REACH = 320;

/** The tufts of grass on each park's lawn at High. */
const GRASS_TUFTS = 9000;
/** The blades' color: a summer lawn, drier than the turf of the golf course. */
const GRASS_COLOR = '#55752c';
/** How far a tuft draws, in meters. */
const GRASS_REACH = 170;

/**
 * How much a mesh's leaf color is raised over its card's, red and green, and the blue that it gains,
 * measured on leaves drawn each way from above and from a low view. A mesh's crown shades itself leaf
 * by leaf, and light through its leaves deepens their hue, so at one color it draws darker and more
 * saturated than its card. A share of blue, not a factor, keeps a silver leaf from turning lilac.
 */
const NEAR_LEAF_RED = 2.3;
const NEAR_LEAF_GREEN = 1.85;
const NEAR_LEAF_BLUE = 0.04;
const NEAR_LEAF_MOST_RED = 0.75;
/** The sun's gloss on a near leaf. A card holds none, and a stronger one shows as pale patches on the crown. */
const NEAR_LEAF_GLOSS = 0.15;

/** The layer that the sun sees and no camera does, which the trees' casting cards stand on. */
export const CASTER_LAYER = 1 << 2;

/** How far the far canopy draws, in meters: past the whole island from any view. */
const FILL_REACH = 6000;

/** A record of a family with some numbers of its own. */
function grow(from: string, id: string, fields: Partial<Species>): Species {
	const base = builtInSpecies(from);
	if (!base) throw new Error(`the vegetation add-on has no ${from}`);
	return { ...base, id, ...fields };
}

/** A branch level of a family, by its place in the record. */
function part(from: string, k: number): BranchLevel {
	const level = builtInSpecies(from)?.branchLevels[k];
	if (!level) throw new Error(`the vegetation add-on's ${from} has no level ${k}`);
	return level;
}

/** A broadleaf's branches: a short trunk, limbs that spread wide, and many twigs that fill the crown. */
function spreading(
	height: number,
	limbs: number,
	reach: number,
	start: number,
	angle: number,
): readonly BranchLevel[] {
	return [
		{ ...part('broadleaf', 0), children: limbs, length: height, start, end: 0.98, curve: 8 },
		{ ...part('broadleaf', 1), children: 6, length: reach, angle, angleVariance: 14, curve: -18 },
		{ ...part('broadleaf', 2), children: 5, length: reach * 0.48, angle: 50, angleVariance: 16 },
		{ ...part('broadleaf', 3), children: 0, length: reach * 0.2, angle: 58, angleVariance: 18 },
	];
}

/** Each meshed kind's number in the plan, with its record. */
const KINDS: readonly (readonly [number, Species])[] = [
	[
		UMBRELLA,
		// A tall bare red trunk under a wide flat dark crown of needles.
		grow('broadleaf', 'island-umbrella-pine', {
			height: 13,
			branchLevels: spreading(10.5, 14, 6.5, 0.8, 74),
			crown: { shape: 'hemispherical', start: 0.8, spread: 0.95, pull: 0.02 },
			leaf: {
				kind: 'needle',
				cards: 30,
				width: 0.6,
				height: 1,
				perCard: 14,
				up: 0.95,
				out: 0.4,
				start: 0.05,
				end: 1,
			},
			color: {
				bark: [0.3, 0.14, 0.08],
				leaf: [0.035, 0.085, 0.03],
				tint: 0.06,
				transmission: 0.25,
			},
			seedSalt: 823,
		}),
	],
	[
		OLIVE,
		// A short gnarled trunk under fine silver-green leaves.
		grow('broadleaf', 'island-olive', {
			height: 6,
			branchLevels: spreading(3.2, 9, 3.2, 0.3, 50),
			crown: { shape: 'spherical', start: 0.2, spread: 0.62, pull: 0.12 },
			leaf: {
				kind: 'cluster',
				cards: 12,
				width: 0.42,
				height: 0.38,
				perCard: 12,
				up: 0.6,
				out: 1,
				start: 0.1,
				end: 1,
			},
			color: { bark: [0.22, 0.18, 0.14], leaf: [0.13, 0.17, 0.1], tint: 0.1, transmission: 0.3 },
			seedSalt: 829,
		}),
	],
	[
		OAK,
		// A round dark crown, full to the ground, for the forest and the square's shade.
		grow('broadleaf', 'island-holm-oak', {
			height: 11,
			branchLevels: spreading(7, 12, 5, 0.25, 56),
			crown: { shape: 'spherical', start: 0.13, spread: 0.78, pull: 0.08 },
			leaf: {
				kind: 'cluster',
				cards: 14,
				width: 0.6,
				height: 0.55,
				perCard: 12,
				up: 0.6,
				out: 1,
				start: 0.08,
				end: 1,
			},
			color: {
				bark: [0.14, 0.11, 0.08],
				leaf: [0.04, 0.085, 0.028],
				tint: 0.1,
				transmission: 0.25,
			},
			seedSalt: 839,
		}),
	],
];

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

/**
 * A mesh's leaf color, which matches the tree's card. A mesh's crown shades itself leaf by leaf, and a
 * card takes that crown's light as baked, so at one color a mesh draws darker than its card, and each
 * tree would change its brightness in one step where it hands over.
 */
function nearLeaf(species: Species): [number, number, number] {
	const [r, g, b] = species.color.leaf;
	const green = g * NEAR_LEAF_GREEN;
	// The red stays under the green, so a silver leaf keeps its green and does not turn tan.
	return [
		Math.min(r * NEAR_LEAF_RED, green * NEAR_LEAF_MOST_RED),
		green,
		b * NEAR_LEAF_GREEN + NEAR_LEAF_BLUE,
	];
}

/** Writes each row's place, turn and size into a batch of meshes. */
function fill(batch: InstanceBatch, spots: readonly TreeSpot[]): void {
	const turn = quat.create();
	spots.forEach((spot, k) => {
		batch.positions.set([spot.x, spot.y, spot.z], k * 3);
		quat.fromEuler(turn, 0, spot.turn, 0);
		batch.rotations.set(turn, k * 4);
		batch.scales.set([spot.scale, spot.scale, spot.scale], k * 3);
		batch.values?.set(treeValues(spot.x, spot.z, 17, 0), k * 4);
	});
	batch.markDirty();
}

/** Stands one kind's trees: a batch of meshes for each part, and a batch of cards. */
function stand(
	ctx: SketchContext,
	species: Species,
	spots: readonly TreeSpot[],
	atlases: ReturnType<typeof bakePlantAtlases>,
	reach: number,
	farOnly: readonly TreeSpot[],
	wind: Wind,
): PlantMaterial[] {
	if (spots.length === 0) return [];
	const { scene, geometry, materials } = ctx;
	const asset: PlantAsset = generatePlant(species, { seed: 17, levels: 4 });
	const far = bakeFarTree(ctx, {
		asset,
		atlases,
		views: CARD_VIEWS[ctx.quality.preset],
		texels: 96,
	});
	const cards = createImpostors(
		{ scene, materials, geometry },
		{
			color: far.color,
			surface: far.surface,
			atlas: far.atlas,
			room: far.room,
			positions: spots.flatMap((spot) => [spot.x, spot.y + far.base * spot.scale, spot.z]),
			turn: spots.map((spot) => spot.turn),
			depth: far.depth,
			alphaMode: 'mask',
			roughness: 1,
			metalness: 0,
			// A card casts as its mesh does, so a tree's shadow does not appear at the hand-over.
			castShadows: false,
			receiveShadows: true,
		},
	);
	spots.forEach((spot, k) => {
		cards.batch.scales.set([spot.scale * far.size[0], spot.scale * far.size[1], 1], k * 3);
	});
	cards.markDirty(0, spots.length);
	// One batch of cards casts every tree's shadow at every distance, seen by the sun alone, so a tree's
	// shadow and the shade it casts on itself do not change where it hands over.
	const casters = createImpostors(
		{ scene, materials, geometry },
		{
			color: far.color,
			surface: far.surface,
			atlas: far.atlas,
			room: far.room,
			positions: spots.flatMap((spot) => [spot.x, spot.y + far.base * spot.scale, spot.z]),
			turn: spots.map((spot) => spot.turn),
			depth: far.depth,
			alphaMode: 'mask',
			roughness: 1,
			metalness: 0,
			castShadows: true,
			layers: CASTER_LAYER,
		},
	);
	spots.forEach((spot, k) => {
		casters.batch.scales.set([spot.scale * far.size[0], spot.scale * far.size[1], 1], k * 3);
	});
	casters.markDirty(0, spots.length);
	// The far canopy stands only as cards, past the distance where the full trees hand over.
	if (farOnly.length > 0) {
		const far2 = createImpostors(
			{ scene, materials, geometry },
			{
				color: far.color,
				surface: far.surface,
				atlas: far.atlas,
				room: far.room,
				positions: farOnly.flatMap((spot) => [spot.x, spot.y + far.base * spot.scale, spot.z]),
				turn: farOnly.map((spot) => spot.turn),
				depth: far.depth,
				alphaMode: 'mask',
				roughness: 1,
				metalness: 0,
			},
		);
		farOnly.forEach((spot, k) => {
			far2.batch.scales.set([spot.scale * far.size[0], spot.scale * far.size[1], 1], k * 3);
		});
		far2.markDirty(0, farOnly.length);
		far2.batch.setDrawRange(reach, FILL_REACH);
	}

	const field = plantWind(ctx, asset, wind.field, {
		swayDistance: swayDistanceFor(ctx.quality.preset),
	});
	const swaying: PlantMaterial[] = [];
	for (const name of ['wood', 'leaves'] as const) {
		const levels = asset.levels.flatMap((level, k) => {
			const part = level.parts.find((p) => p.name === name);
			return part
				? [{ mesh: geometry.fromArrays(part.arrays), error: LEVEL_ERRORS[k] ?? level.error }]
				: [];
		});
		const [base, ...coarser] = levels;
		if (!base) continue;
		if (coarser.length > 0) base.mesh.setLevels(coarser);
		const material = plantMaterial(
			ctx,
			name === 'wood'
				? { atlases, part: 'wood', color: species.color.bark, wind: field }
				: {
						atlases,
						part: 'leaves',
						cell: leafCellFor(species),
						color: nearLeaf(species),
						transmission: species.color.transmission,
						leafGloss: NEAR_LEAF_GLOSS,
						wind: field,
					},
		);
		swaying.push(material);
		const batch = scene.createInstances(base.mesh, spots.length, {
			material,
			values: true,
			castShadows: false,
			receiveShadows: true,
		});
		fill(batch, spots);
		handOverToCards(batch, cards.batch, reach);
	}
	return swaying;
}

/** Stands the plan's shrubs, grown by the add-on, in one batch for each part, moving in the wind. */
function standShrubs(
	ctx: SketchContext,
	atlases: ReturnType<typeof bakePlantAtlases>,
	wind: Wind,
): PlantMaterial[] {
	const { scene, geometry } = ctx;
	const species = grow('shrub', 'island-shrub', {
		height: 1.5,
		trunks: 6,
		crown: { shape: 'spherical', start: 0.05, spread: 0.75, pull: 0.02 },
		seedSalt: 859,
	});
	const asset = generatePlant(species, { seed: 23, levels: 3 });
	const field = plantWind(ctx, asset, wind.field, {
		swayDistance: swayDistanceFor(ctx.quality.preset),
	});
	const spots = standing(SHRUBS, TREE_SHARE[ctx.quality.preset]);
	return (['wood', 'leaves'] as const).flatMap((name) => {
		const levels = asset.levels.flatMap((level, k) => {
			const part = level.parts.find((p) => p.name === name);
			return part
				? [{ mesh: geometry.fromArrays(part.arrays), error: SHRUB_LEVEL_ERRORS[k] ?? level.error }]
				: [];
		});
		const [base, ...coarser] = levels;
		if (!base) return [];
		if (coarser.length > 0) base.mesh.setLevels(coarser);
		const material = plantMaterial(
			ctx,
			name === 'wood'
				? { atlases, part: 'wood', color: species.color.bark, wind: field }
				: {
						atlases,
						part: 'leaves',
						cell: leafCellFor(species),
						color: species.color.leaf,
						transmission: species.color.transmission,
						leafGloss: NEAR_LEAF_GLOSS,
						wind: field,
					},
		);
		const batch = scene.createInstances(base.mesh, spots.length, {
			material,
			values: true,
			castShadows: true,
			receiveShadows: true,
		});
		const turn = quat.create();
		spots.forEach((spot, k) => {
			batch.positions.set([spot.x, spot.y, spot.z], k * 3);
			quat.fromEuler(turn, 0, Math.imul(k + 1, 2654435761) / 683565275, 0);
			batch.rotations.set(turn, k * 4);
			batch.scales.set([spot.scale, spot.scale, spot.scale], k * 3);
			batch.values?.set(treeValues(spot.x, spot.z, 23, 0), k * 4);
		});
		batch.markDirty();
		batch.setDrawRange(0, SHRUB_REACH);
		return [material];
	});
}

/** Grows the island's trees for the preset, and returns the call that moves them in the wind. */
export async function createTrees(ctx: SketchContext, camera: Camera): Promise<{ update(): void }> {
	const preset = ctx.quality.preset;
	const atlases = bakePlantAtlases(ctx);
	const onWall = onRetainingWall();
	const kept = standing(TREE_SPOTS, TREE_SHARE[preset]).filter((spot) => !onWall(spot.x, spot.z));
	const fills = standing(FILL_SPOTS, TREE_SHARE[preset]);
	const wind = createWind(ctx, { camera, box: WIND_BOX, grid: WIND_GRID });
	const swaying = KINDS.flatMap(([kind, species]) =>
		stand(
			ctx,
			species,
			kept.filter((spot) => spot.kind === kind),
			atlases,
			SWITCH[preset],
			fills.filter((spot) => spot.kind === kind),
			wind,
		),
	);
	swaying.push(...standShrubs(ctx, atlases, wind));
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
		const distance = swayDistanceFor(ctx.quality.preset);
		for (const material of swaying) material.setUniform('swayDistance', distance);
		for (const lawn of lawns) lawn.fit(ctx.quality.preset);
	});
	// The cypresses are solid spires, which look the same from every distance.
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
	// The far canopy's cypresses stand only as the plainest spires, past the full trees' distance.
	const farSpires = fills.filter((spot) => spot.kind === CYPRESS);
	if (farSpires.length > 0) {
		const plain = ctx.geometry.fromArrays(finish(cypress(5, 4)));
		const far = ctx.scene.createInstances(plain, farSpires.length, {
			material: ctx.materials.standard({ map: foliage, vertexColors: true, roughness: 0.95 }),
			castShadows: false,
			receiveShadows: true,
		});
		fill(far, farSpires);
		far.setDrawRange(SWITCH[preset], FILL_REACH);
	}
	return {
		update() {
			// The field's box follows the camera, and a gust fades, so it steps every frame.
			wind.update();
			setWindLayer(swaying, wind.field);
			for (const lawn of lawns) lawn.setWindLayer(wind.field);
		},
	};
}
