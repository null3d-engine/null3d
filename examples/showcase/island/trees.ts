// The island's trees, grown by the vegetation add-on from records of numbers: tall cypresses on the
// upper slopes and along the lanes, wide umbrella pines by the coast, and low olives in groves, each where
// the town plan puts it. Near trees draw
// as meshes whose levels thin with distance, and far ones as cards baked from the same plants, so
// the whole forest fits one view and a close look shows the leaves.
import { type InstanceBatch, type QualityPreset, quat, type SketchContext } from '@null3d/engine';
import { createImpostors } from '@null3d/impostors';
import {
	type BranchLevel,
	bakeFarTree,
	bakePlantAtlases,
	builtInSpecies,
	generatePlant,
	handOverToCards,
	leafCellFor,
	type PlantAsset,
	plantMaterial,
	type Species,
} from '@null3d/vegetation';
import { cypress, finish } from './kit';
import {
	CYPRESS,
	FILL_SPOTS,
	OAK,
	OLIVE,
	standing,
	TREE_SPOTS,
	type TreeSpot,
	UMBRELLA,
} from './plan';

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
 * The error that each level of a tree's mesh switches at, from the base level on. The add-on measures
 * a level's error by the leaves it drops, whose switches lie past the distance where the card takes
 * over, so these bring the switches well inside it: the second level past about 45 meters on a 1080p
 * screen, and the third past about 95. Shadow maps pick each at half that distance.
 */
const LEVEL_ERRORS = [0, 0.03, 0.065];

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
				width: 0.9,
				height: 0.7,
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
				cards: 44,
				width: 0.14,
				height: 0.13,
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
				cards: 60,
				width: 0.17,
				height: 0.16,
				perCard: 14,
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

/** Stands one kind's trees: a batch of meshes for each part, and a batch of cards. */
function stand(
	ctx: SketchContext,
	species: Species,
	spots: readonly TreeSpot[],
	atlases: ReturnType<typeof bakePlantAtlases>,
	reach: number,
	farOnly: readonly TreeSpot[],
): void {
	if (spots.length === 0) return;
	const { scene, geometry, materials } = ctx;
	const asset: PlantAsset = generatePlant(species, { seed: 17, levels: 4 });
	const far = bakeFarTree(ctx, { asset, atlases, views: 25, texels: 96 });
	const cards = createImpostors(
		{ scene, materials, geometry },
		{
			color: far.color,
			surface: far.surface,
			atlas: far.atlas,
			positions: spots.flatMap((spot) => [spot.x, spot.y + far.base * spot.scale, spot.z]),
			turn: spots.map((spot) => spot.turn),
			depth: far.depth,
			alphaMode: 'mask',
			roughness: 1,
			metalness: 0,
		},
	);
	spots.forEach((spot, k) => {
		cards.batch.scales.set([spot.scale * far.size[0], spot.scale * far.size[1], 1], k * 3);
	});
	cards.markDirty(0, spots.length);
	// The far canopy stands only as cards, past the distance where the full trees hand over.
	if (farOnly.length > 0) {
		const far2 = createImpostors(
			{ scene, materials, geometry },
			{
				color: far.color,
				surface: far.surface,
				atlas: far.atlas,
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
		const batch = scene.createInstances(base.mesh, spots.length, {
			material: plantMaterial(
				ctx,
				name === 'wood'
					? { atlases, part: 'wood', color: species.color.bark }
					: {
							atlases,
							part: 'leaves',
							cell: leafCellFor(species),
							color: species.color.leaf,
						},
			),
			castShadows: true,
			receiveShadows: true,
		});
		fill(batch, spots);
		handOverToCards(batch, cards.batch, reach);
	}
}

/** Grows the island's trees for the preset. */
export function createTrees(ctx: SketchContext): void {
	const preset = ctx.quality.preset;
	const atlases = bakePlantAtlases(ctx);
	const kept = standing(TREE_SPOTS, TREE_SHARE[preset]);
	const fills = standing(FILL_SPOTS, TREE_SHARE[preset]);
	for (const [kind, species] of KINDS)
		stand(
			ctx,
			species,
			kept.filter((spot) => spot.kind === kind),
			atlases,
			SWITCH[preset],
			fills.filter((spot) => spot.kind === kind),
		);
	// The cypresses are solid spires, which look the same from every distance.
	const spires = kept.filter((spot) => spot.kind === CYPRESS);
	const mesh = ctx.geometry.fromArrays(finish(cypress(14, 18)));
	mesh.setLevels([
		{ mesh: ctx.geometry.fromArrays(finish(cypress(8, 8))), error: 0.03 },
		{ mesh: ctx.geometry.fromArrays(finish(cypress(5, 4))), error: 0.14 },
	]);
	const batch = ctx.scene.createInstances(mesh, spires.length, {
		material: ctx.materials.standard({ vertexColors: true, roughness: 0.95 }),
		castShadows: true,
		receiveShadows: true,
	});
	fill(batch, spires);
	// The far canopy's cypresses stand only as the plainest spires, past the full trees' distance.
	const farSpires = fills.filter((spot) => spot.kind === CYPRESS);
	if (farSpires.length > 0) {
		const plain = ctx.geometry.fromArrays(finish(cypress(5, 4)));
		const far = ctx.scene.createInstances(plain, farSpires.length, {
			material: ctx.materials.standard({ vertexColors: true, roughness: 0.95 }),
			castShadows: false,
			receiveShadows: true,
		});
		fill(far, farSpires);
		far.setDrawRange(SWITCH[preset], FILL_REACH);
	}
}
