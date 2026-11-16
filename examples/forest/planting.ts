// The forest's own build: one batch for the understory and one for each kind's far rows as cut-out
// cards. The near rows are the vegetation add-on's plants (./addon.ts), and the counts that each
// preset draws are fitted here.
import type { InstanceBatch, Material, SketchContext } from '@null3d/engine';
import {
	BUSH,
	bushRows,
	cardArrays,
	countRows,
	fillRows,
	fitCounts,
	KINDS,
	meshOf,
	type Rows,
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

/** What one kind of tree draws: its far card rows, and their counts. */
export interface PlantedKind {
	readonly cards: InstanceBatch;
	readonly count: number;
	readonly near: number;
}

/** The forest's far batches, its understory, and the count fitting that each preset runs. */
export function plantForest(
	ctx: SketchContext,
	options: { readonly bark: Material; readonly card: Material; readonly rows: Rows },
): {
	readonly kinds: readonly PlantedKind[];
	readonly undergrowth: InstanceBatch;
	readonly fit: () => void;
} {
	const { scene, geometry, quality } = ctx;
	const { bark, card, rows } = options;
	// The add-on draws the near rows, so each kind keeps one batch: its far rows as cards.
	const { before, all } = countRows(rows, NEAR);
	const kinds = KINDS.map((kind, n) => {
		const count = all[n] as number;
		const near = before[n] as number;
		const cards = scene.createInstances(
			geometry.fromArrays(cardArrays(kind, n, KINDS.length)),
			count - near,
			{
				material: card,
				colors: true,
			},
		);
		fillRows(cards, rows, n, near);
		return { cards, count, near };
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
	const fit = () =>
		fitCounts(kinds, undergrowth, quality.preset === 'low', { all: BUSHES, near: BUSH_NEAR });
	fit();
	return { kinds, undergrowth, fit };
}
