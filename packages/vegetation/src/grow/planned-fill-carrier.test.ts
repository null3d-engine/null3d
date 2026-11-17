// The planned fill's carrier record: every socket states the wood its piece hangs on, so a level
// can raise a kept row's carrier into its drawn wood. The carrier is the socket's own axis, its
// botanical order, and the share along it where the piece stands. This file grows every planned
// species and holds the record to that rule.
import { describe, expect, it } from 'bun:test';
import type { PlantAsset } from '../asset';
import { BUD_TERMINAL } from '../core/graph';
import { loadSpecies, type SpeciesId } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';

/** Every species whose registered form grows by the planned model. */
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

/** One species' plant, grown once for every case in this file. */
const grown = new Map<SpeciesId, PlantAsset>();

/** Grows one planned species at a state where its clumps carry sockets. */
async function plantOf(id: SpeciesId): Promise<PlantAsset> {
	const kept = grown.get(id);
	if (kept) return kept;
	const module = await loadSpecies(id);
	await loadPlantCode(module.record);
	// A species whose record already grows the planned model needs no form named.
	const form = module.record.forms?.planned === undefined ? {} : { form: 'planned' };
	const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low', ...form });
	const asset = growPlantNow(kit, {
		seed: 11,
		variant: 0,
		near: false,
		detail: 'low',
		maturity: 0.6,
		sparse: 0.2,
	} as never);
	grown.set(id, asset);
	return asset;
}

/**
 * The share along a carrier where a socket stands, read independently of the fill: its node's
 * place among the carrier's nodes, 0 at the base and 1 at the tip.
 */
function expectedShare(asset: PlantAsset, axis: number, node: number): number {
	const { axes } = asset.skeleton;
	const first = axes.first[axis] as number;
	const last = axes.last[axis] as number;
	if (first < 0 || last <= first || node < first) return 1;
	return Math.max(0, Math.min(1, (node - first) / (last - first)));
}

describe('the planned fill seats every socket on its carrier', () => {
	for (const id of SPECIES) {
		it(`${id}: the carrier is the axis the fill seated the socket on`, async () => {
			const asset = await plantOf(id);
			const { buds } = asset.skeleton;
			const sockets = buds.sockets;
			expect(sockets?.carrierAxis?.length).toBe(buds.count);
			expect(sockets?.carrierOrder?.length).toBe(buds.count);
			expect(sockets?.carrierAlong?.length).toBe(buds.count);
			let placed = 0;
			for (let b = 0; b < buds.count; b++) {
				// The fill's sockets are its terminal bud sites; a flower site is no socket.
				if ((buds.kind[b] as number) !== BUD_TERMINAL) continue;
				placed++;
				const carrier = (sockets?.carrierAxis?.[b] ?? -1) | 0;
				const order = (sockets?.carrierOrder?.[b] ?? -1) | 0;
				const along = sockets?.carrierAlong?.[b] as number;
				const node = buds.node[b] as number;
				// Every socket stands on the axis its own bud hangs on, and that axis's own node.
				expect([b, carrier]).toEqual([b, (buds.axis[b] as number) | 0]);
				expect([b, (asset.skeleton.axisOf[node] as number) | 0]).toEqual([b, carrier]);
				expect([b, order]).toEqual([b, (asset.skeleton.axes.order[carrier] as number) | 0]);
				expect(along).toBeGreaterThanOrEqual(0);
				expect(along).toBeLessThanOrEqual(1);
				expect(along).toBeCloseTo(expectedShare(asset, carrier, node), 6);
			}
			// A grown planned plant carries sockets at this state, so the case is not vacuous.
			expect(placed).toBeGreaterThan(0);
		});
	}
});
