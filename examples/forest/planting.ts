// The forest's own build: one batch for each kind of tree and one for the understory, the far rows
// as cut-out cards, a hero fir, and the counts that each preset draws.
import type { InstanceBatch, Material, SketchContext } from '@null3d/engine';
import {
	addHero,
	BUSH,
	bushRows,
	cardArrays,
	countRows,
	fillRows,
	fitCounts,
	ground,
	KINDS,
	meshOf,
	plantRows,
} from './woods';

/** Trees in all, the trees that draw in full on Low, and the radius of the forest in meters. */
export const TREES = 56_000;
export const NEAR = 8000;
export const RADIUS = 650;
/** Bushes of the understory, the bushes that draw on Low, and how far out they cover, in meters. */
export const BUSHES = 30_000;
export const BUSH_NEAR = 12_000;
export const BUSH_RADIUS = 360;
/** How far out the understory draws, in meters, where the trees hide the ground beyond it. */
export const UNDERSTORY_EDGE = 300;

/** What one kind of tree draws: its base mesh, its full and card rows, and their counts. */
export interface PlantedKind {
	readonly mesh: ReturnType<typeof meshOf>;
	readonly trees: InstanceBatch;
	readonly cards: InstanceBatch;
	readonly count: number;
	readonly near: number;
}

/** The forest's batches, its hero fir and the count fitting that each preset runs. */
export function plantForest(
	ctx: SketchContext,
	options: { readonly bark: Material; readonly card: Material },
): {
	readonly kinds: readonly PlantedKind[];
	readonly undergrowth: InstanceBatch;
	readonly hero: ReturnType<typeof addHero>;
	readonly fit: () => void;
} {
	const { scene, geometry, quality } = ctx;
	const { bark, card } = options;
	// One batch per kind of tree, whose base mesh names its coarser levels: each row picks its own
	// level in every frame. A second batch per kind holds the far rows as cards, for Low.
	const rows = plantRows(TREES, RADIUS);
	const { before, all } = countRows(rows, NEAR);
	const kinds = KINDS.map((kind, n) => {
		const count = all[n] as number;
		const near = before[n] as number;
		const mesh = meshOf(geometry, kind);
		const trees = scene.createInstances(mesh, count, {
			material: bark,
			castShadows: true,
			receiveShadows: true,
			colors: true,
		});
		fillRows(trees, rows, n);
		const cards = scene.createInstances(
			geometry.fromArrays(cardArrays(kind, n, KINDS.length)),
			count - near,
			{
				material: card,
				colors: true,
			},
		);
		fillRows(cards, rows, n, near);
		return { mesh, trees, cards, count, near };
	});
	// The understory: broad bushes that cover the ground between the trunks, at their own levels.
	const undergrowth = scene.createInstances(meshOf(geometry, BUSH), BUSHES, {
		material: bark,
		castShadows: true,
		receiveShadows: true,
		colors: true,
	});
	fillRows(undergrowth, bushRows(BUSHES, BUSH_RADIUS), 0);
	// The understory's far rows cost nothing past the distance where the trunks hide the ground,
	// and the dither fades the last bushes out instead of popping them away.
	undergrowth.setDrawRange(0, UNDERSTORY_EDGE);
	// One hero fir stands beside the flight: a bias keeps its finer levels where the trees around
	// it turn coarse, and B gives it the threshold of the rest.
	const hero = addHero(scene, kinds[0] as PlantedKind, bark, ground);
	const fit = () =>
		fitCounts(kinds, undergrowth, quality.preset === 'low', { all: BUSHES, near: BUSH_NEAR });
	fit();
	return { kinds, undergrowth, hero, fit };
}
