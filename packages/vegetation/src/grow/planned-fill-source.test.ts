// The planned fill's scale has one source: each fill order names a measured piece and reads that
// piece's stem length and foot radius, and the socket pitch the record's own frame measures. This
// file holds every planned species to that rule, and shows that a change to a piece moves the fill
// with it: a retyped figure beside the record would stay behind and fail the case.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset } from '../asset';
import type { FillFigures } from '../core/graph';
import type { Species } from '../core/record';
import { loadSpecies, type SpeciesId } from '../core/registry';
import { spreadMean } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { resolveFillFigures } from './fill-figures';
import { planFrame } from './frame';

/** Every species whose registered growth is the planned model. */
const SPECIES = [
	'pedunculate-oak',
	'common-ash',
	'weeping-willow',
	'silver-birch',
	'european-beech',
	'common-alder',
	'hawthorn-shrub',
	'holm-oak',
	'olive',
	'scots-pine',
	'bamboo',
] as const;

/** The measured socket spacing a record's own frame states, in metres, or 0 where it states none. */
function framePitch(record: Species): number {
	const growth = record.growth;
	const spec = growth.model === 'planned' ? growth.frame : undefined;
	if (spec === undefined) return 0;
	const plan = planFrame(
		spec,
		{ record, seed: 11, variant: 0, season: record.seasons.default } as never,
		false,
	);
	let least = Number.POSITIVE_INFINITY;
	for (const patch of plan.patches) {
		const spacing = patch.sockets?.every ?? patch.fill?.pitch;
		if (spacing !== undefined && spacing > 0 && spacing < least) least = spacing;
	}
	return Number.isFinite(least) ? least : 0;
}

/** A species' plants, grown once for the cases below. */
const grown = new Map<SpeciesId, PlantAsset>();

/** Grows one planned species at a state where the fill has run. */
async function plantOf(id: SpeciesId): Promise<PlantAsset> {
	const kept = grown.get(id);
	if (kept) return kept;
	const module = await loadSpecies(id);
	await loadPlantCode(module.record);
	const form = module.record.forms?.planned === undefined ? {} : { form: 'planned' };
	const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low', ...form });
	const asset = growPlantNow(kit, {
		seed: 11,
		variant: 0,
		near: false,
		detail: 'low',
		maturity: 0.3,
		sparse: 0,
	} as never);
	grown.set(id, asset);
	return asset;
}

describe('the planned fill reads its piece figures from the record', () => {
	for (const id of SPECIES) {
		it(`${id}: each fill order states its piece's measured length and radius`, async () => {
			const module = await loadSpecies(id);
			const record = module.record;
			const growth = record.growth;
			if (growth.model !== 'planned') throw new Error(`${id} is not planned`);
			const spec = growth.frame;
			expect(spec).toBeDefined();
			const plan = planFrame(
				spec as NonNullable<typeof spec>,
				{
					record,
					seed: 11,
					variant: 0,
					season: record.seasons.default,
				} as never,
				false,
			);
			const figures = resolveFillFigures(record, plan.patches);
			expect(figures.length).toBe(growth.orders.length);
			for (const [at, figure] of figures.entries()) {
				const order = growth.orders[at] as { readonly piece: string };
				const rule = record.pieces?.find((piece) => piece.name === order.piece);
				// The order names a piece the record holds, and reads that piece's own figures.
				expect(rule).toBeDefined();
				if (!rule) continue;
				expect(figure.piece).toBe(order.piece);
				expect(figure.length).toBeCloseTo(spreadMean(rule.stem.length), 9);
				expect(figure.radius).toBeCloseTo(rule.stem.radius[0] as number, 12);
				expect(figure.length as number).toBeGreaterThan(0);
				expect(figure.radius as number).toBeGreaterThan(0);
				// The socket pitch is the closest spacing the record's frame states, or absent.
				const pitch = framePitch(record);
				if (pitch > 0) expect(figure.pitch).toBeCloseTo(pitch, 9);
				else expect(figure.pitch).toBeUndefined();
			}
		});

		it(
			`${id}: the grown plant carries the record's figures, not a copy`,
			async () => {
				const asset = await plantOf(id);
				const record = (await loadSpecies(id)).record;
				const growth = record.growth;
				if (growth.model !== 'planned' || growth.frame === undefined) return;
				const plan = planFrame(
					growth.frame,
					{
						record,
						seed: 11,
						variant: 0,
						season: record.seasons.default,
					} as never,
					false,
				);
				const figures = resolveFillFigures(record, plan.patches);
				expect(asset.skeleton.fillFigures).toEqual(figures as FillFigures[]);
			},
			scaledBudget(120_000),
		);
	}

	it('a changed piece moves the fill figures with it', async () => {
		const record = (await loadSpecies('common-ash')).record;
		const growth = record.growth;
		if (growth.model !== 'planned') throw new Error('the ash is not planned');
		const plan = planFrame(
			growth.frame as NonNullable<typeof growth.frame>,
			{
				record,
				seed: 11,
				variant: 0,
				season: record.seasons.default,
			} as never,
			false,
		);
		const before = resolveFillFigures(record, plan.patches);
		expect(before[0]?.length).toBeGreaterThan(0);
		// The same record with only its piece's stem length changed: the figure has to follow, since
		// no order restates the length beside the piece.
		const pieces = record.pieces?.map((piece) =>
			piece.name === 'branch-end'
				? { ...piece, stem: { ...piece.stem, length: { mean: 0.95, spread: 0.05 } } }
				: piece,
		);
		const changed: Species = { ...record, pieces };
		const after = resolveFillFigures(changed, plan.patches);
		expect(after[0]?.length).toBeCloseTo(0.95, 9);
		expect(after[0]?.length).not.toBeCloseTo(before[0]?.length as number, 3);
	});

	it('an order that names no measured piece states no invented figure', async () => {
		const record = (await loadSpecies('common-ash')).record;
		const growth = record.growth;
		if (growth.model !== 'planned') throw new Error('the ash is not planned');
		const plan = planFrame(
			growth.frame as NonNullable<typeof growth.frame>,
			{
				record,
				seed: 11,
				variant: 0,
				season: record.seasons.default,
			} as never,
			false,
		);
		const unknown: Species = {
			...record,
			growth: {
				...growth,
				orders: growth.orders.map(() => ({ piece: 'no-such-piece', density: 8 })),
			},
		};
		for (const figure of resolveFillFigures(unknown, plan.patches)) {
			expect(figure.piece).toBe('no-such-piece');
			expect(figure.length).toBeUndefined();
			expect(figure.radius).toBeUndefined();
		}
	});
});
