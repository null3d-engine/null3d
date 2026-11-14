// The two dials are separate: sparseness thins leaves and limbs and keeps every piece joined to the
// root; polygon count changes only how smooth or blocky the same plant looks. The tests below state
// the rule, and every one of them runs.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import type { PlantAsset } from './asset';
import { loadSpecies } from './core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from './generate';
import { cardMesh, cardRows, connectedCards } from './lod/cards';
import { connectedBody } from './lod/connect';
import type { MeshInput } from './stages';
import { meshWood } from './wood/wood-mesh';

/** The growth tests mesh several levels; a busy machine draws them in tens of seconds. */
const LONG = scaledBudget(120_000);

const module = await loadSpecies('pedunculate-oak');
const record = module.record;
await loadPlantCode(record);
const kit = buildKitNow(module, { placeholders: 'missing', detail: 'high' });

/** The meshing input of a grown variant, with an open crown: the light moves no vertex. */
function meshInput(asset: PlantAsset): MeshInput {
	const { min, max } = asset.skeleton.bounds;
	return {
		record: kit.record,
		seed: asset.seed,
		variant: asset.variant,
		season: asset.season,
		kit,
		skeleton: asset.skeleton,
		coarseness: asset.coarseness,
		rows: asset.shoots,
		crown: {
			cells: [1, 1, 1] as const,
			min,
			cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
			sky: new Float32Array([1]),
		},
		detail: 'high' as const,
	};
}

/**
 * The distance from each fine run's first node to the parent node it leaves, less the parent's
 * radius, in metres. The mesher joins a fine piece at the parent node its axis names, so the gap is
 * one growth step at most.
 */
function fineRunSteps(skeleton: PlantAsset['skeleton']): number[] {
	const { axes, position, radius } = skeleton;
	const steps: number[] = [];
	for (let a = 0; a < axes.count; a++) {
		if ((axes.fine?.[a] ?? 0) !== 1) continue;
		const base = axes.first[a] as number;
		const parent = axes.parent[a] as number;
		const at = axes.parentNode[a] as number;
		if (parent < 0 || at < 0) {
			steps.push(Number.POSITIVE_INFINITY);
			continue;
		}
		let sum = 0;
		for (let k = 0; k < 3; k++) {
			const d = (position[base * 3 + k] as number) - (position[at * 3 + k] as number);
			sum += d * d;
		}
		steps.push(Math.sqrt(sum) - (radius[at] as number));
	}
	return steps;
}

/** The fill pitch a record's patch rules state, as a share of the plant's height. */
function fillPitchShare(rule: {
	readonly patch?: { readonly fill?: { readonly pitch: number } };
	readonly children?: readonly unknown[];
}): number | undefined {
	let share: number | undefined;
	const pitch = rule.patch?.fill?.pitch;
	if (typeof pitch === 'number') share = pitch;
	for (const child of rule.children ?? []) {
		const found = fillPitchShare(child as typeof rule);
		if (found !== undefined) share = Math.max(share ?? 0, found);
	}
	return share;
}

/** The rows a card level draws, after the join rule. */
function drawnCards(input: MeshInput, level: 1 | 2): number {
	const flags = connectedCards(input, level);
	const kept = cardRows(input, level);
	let count = 0;
	for (let r = 0; r < input.rows.count; r++) if ((kept[r] as number) > 0 && flags[r] === 1) count++;
	return count;
}

/** The highest vertex of a mesh in metres. */
function topOf(mesh: { readonly positions: ArrayLike<number> }): number {
	let top = Number.NEGATIVE_INFINITY;
	for (let i = 1; i < mesh.positions.length; i += 3)
		top = Math.max(top, mesh.positions[i] as number);
	return top;
}

/** The box of some meshes in metres. */
function boxOf(...meshes: readonly { readonly positions: ArrayLike<number> }[]) {
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const mesh of meshes)
		for (let i = 0; i < mesh.positions.length; i += 3)
			for (let k = 0; k < 3; k++) {
				const value = mesh.positions[i + k] as number;
				min[k] = Math.min(min[k] as number, value);
				max[k] = Math.max(max[k] as number, value);
			}
	return { min, max };
}

describe('the sparse dial', () => {
	it(
		'thins the leaves and the wood and keeps one body reaching its root at every level',
		() => {
			let cards = Number.POSITIVE_INFINITY;
			let wood = Number.POSITIVE_INFINITY;
			for (const sparse of [0, 0.5, 1]) {
				const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true, sparse });
				const input = meshInput(asset);
				for (const level of [0, 1, 2] as const) {
					const body = connectedBody(input, level);
					expect([sparse, level, body.components]).toEqual([sparse, level, 1]);
					expect([sparse, level, body.reachesRoot]).toEqual([sparse, level, true]);
				}
				const cardCount = drawnCards(input, 1);
				const woodTriangles = meshWood(input, 0).indices.length / 3;
				expect([sparse, cardCount <= cards]).toEqual([sparse, true]);
				expect([sparse, woodTriangles <= wood]).toEqual([sparse, true]);
				cards = cardCount;
				wood = woodTriangles;
			}
		},
		LONG,
	);

	it(
		'keeps the crown top in the record height band at every sparse level',
		() => {
			const size = record.size.height;
			const band = typeof size === 'number' ? { mean: size, spread: 0 } : size;
			for (const sparse of [0, 0.5, 1]) {
				const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true, sparse });
				const input = meshInput(asset);
				const top = topOf(cardMesh(input, 1));
				expect([sparse, top >= band.mean - band.spread && top <= band.mean + band.spread]).toEqual([
					sparse,
					true,
				]);
			}
		},
		LONG,
	);
});

describe('the polygon dial', () => {
	it(
		'coarsens the wood as it rises, drawing fewer triangles for the same plant',
		() => {
			let wood = Number.POSITIVE_INFINITY;
			for (const coarseness of [0.2, 0.5, 0.8]) {
				const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true, coarseness });
				const triangles = meshWood(meshInput(asset), 0).indices.length / 3;
				expect([coarseness, triangles <= wood]).toEqual([coarseness, true]);
				wood = triangles;
			}
		},
		LONG,
	);

	it(
		'keeps the card count, the leaf count and the crown box as it coarsens the wood',
		() => {
			let first: { cards: number; leaves: number; box: ReturnType<typeof boxOf> } | undefined;
			for (const coarseness of [0.2, 0.5, 0.8]) {
				const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true, coarseness });
				const input = meshInput(asset);
				const cards = drawnCards(input, 1);
				const leaves = asset.shoots.count;
				const box = boxOf(meshWood(input, 0), cardMesh(input, 1));
				if (!first) {
					first = { cards, leaves, box };
					continue;
				}
				const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.02 * b);
				expect([coarseness, close(cards, first.cards)]).toEqual([coarseness, true]);
				expect([coarseness, close(leaves, first.leaves)]).toEqual([coarseness, true]);
				for (let k = 0; k < 3; k++) {
					expect([coarseness, close(box.min[k] as number, first.box.min[k] as number)]).toEqual([
						coarseness,
						true,
					]);
					expect([coarseness, close(box.max[k] as number, first.box.max[k] as number)]).toEqual([
						coarseness,
						true,
					]);
				}
			}
		},
		LONG,
	);
});

describe('the connectivity helper', () => {
	it(
		'joins the plant as one body by its axis graph, from the root at every level',
		() => {
			const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
			const input = meshInput(asset);
			for (const level of [0, 1, 2] as const) {
				const body = connectedBody(input, level);
				expect([level, body.components, body.reachesRoot]).toEqual([level, 1, true]);
			}
		},
		LONG,
	);

	it(
		'leaves the fine runs their own surfaces, each within a step of the wood it leaves',
		() => {
			const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
			// The finest wood, grown to clothe a foliage patch, draws as straight runs of the fewest
			// sides and is left unblended, a deliberate byte saving. The mesher joins each run at the
			// parent node its axis names, and the frame grows the first sprout one step on: 0.6 of
			// the patch's fill pitch, a share of the plant's height. A run whose first node stands
			// farther from that node floats away from the wood that carries it.
			const growth = kit.record.growth;
			const share = growth.model === 'frame' ? fillPitchShare(growth.frame.stems) : undefined;
			if (share === undefined) throw new Error('the oak states no fill pitch');
			const height = kit.record.size.height;
			const tolerance = 0.6 * share * (typeof height === 'number' ? height : height.mean) + 0.01;
			const steps = fineRunSteps(asset.skeleton);
			expect(steps.length).toBeGreaterThan(0);
			expect(Math.max(...steps)).toBeLessThan(tolerance);
			// A run moved off its step fails the same check.
			const floated = growPlantNow(kit, { seed: 11, variant: 0, near: true });
			const { axes, position } = floated.skeleton;
			for (let a = 0; a < axes.count; a++) {
				if ((axes.fine?.[a] ?? 0) !== 1) continue;
				const base = axes.first[a] as number;
				position[base * 3] = (position[base * 3] as number) + 1;
				break;
			}
			expect(Math.max(...fineRunSteps(floated.skeleton))).toBeGreaterThan(tolerance);
		},
		LONG,
	);
});
