// The culm-clump grower: a bamboo clump's culms, joints and ranked branch-pair sockets, each
// against the figure its record reads on the pictures.
import { beforeAll, describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { SpeciesKitData } from '../asset';
import { AXIS_CULM, BUD_DORMANT, BUD_JOINT, BUD_TERMINAL, type MacroSkeleton } from '../core/graph';
import type { CulmClump } from '../core/record';
import { loadSpecies } from '../core/registry';
import { spreadAt } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { azimuthOf, drawnTop } from './directed.test-support';
import { targetHeight } from './height';

const LONG = scaledBudget(180_000);
const VARIANTS = [0, 1, 2] as const;

let kit: SpeciesKitData;
let growth: CulmClump;

beforeAll(async () => {
	const module = await loadSpecies('bamboo');
	await loadPlantCode(module.record);
	kit = buildKitNow(module, { placeholders: 'missing', detail: 'high' });
	growth = kit.record.growth as CulmClump;
}, LONG);

/** The culms of a skeleton: each culm axis with its joints' positions, foot first. */
function culmsOf(skeleton: MacroSkeleton): { axis: number; joints: [number, number, number][] }[] {
	const { axes, position } = skeleton;
	const out: { axis: number; joints: [number, number, number][] }[] = [];
	for (let a = 0; a < axes.count; a++) {
		if ((axes.kind[a] as number) !== AXIS_CULM) continue;
		const joints: [number, number, number][] = [];
		for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++)
			joints.push([
				position[n * 3] as number,
				position[n * 3 + 1] as number,
				position[n * 3 + 2] as number,
			]);
		out.push({ axis: a, joints });
	}
	return out;
}

/** The sockets of a skeleton: each with its culm, its rank, its height and its piece. */
function socketsOf(skeleton: MacroSkeleton) {
	const { buds } = skeleton;
	const out: { bud: number; axis: number; rank: number; y: number; piece: string }[] = [];
	if (!buds.sockets) return out;
	for (let b = 0; b < buds.count; b++)
		if ((buds.kind[b] as number) === BUD_TERMINAL)
			out.push({
				bud: b,
				axis: buds.axis[b] as number,
				rank: buds.sockets.rank[b] as number,
				y: buds.position[b * 3 + 1] as number,
				piece: kit.record.pieces?.[buds.sockets.piece?.[b] ?? 0]?.name ?? '',
			});
	return out;
}

describe('the culm-clump grower on the bamboo', () => {
	it('grows the stated culms from one foot, each on its own axis from the ground', () => {
		for (const variant of VARIANTS) {
			const { skeleton } = growPlantNow(kit, { seed: 11, variant, near: true });
			const culms = culmsOf(skeleton);
			expect(culms.length).toBeGreaterThanOrEqual(Math.round(spreadAt(growth.culms, 0)));
			expect(culms.length).toBeLessThanOrEqual(Math.round(spreadAt(growth.culms, 1)));
			for (const { joints } of culms) {
				const [x, y, z] = joints[0] as [number, number, number];
				expect(y).toBe(0);
				expect(Math.hypot(x, z)).toBeLessThanOrEqual(growth.foot + 1e-6);
			}
		}
	});

	it("spaces each culm's joints by its own width, about twenty to a thick culm", () => {
		const { skeleton } = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		// The tallest culm is a thick one: the thin culms stand lower and space their joints by
		// their own, narrower width.
		const tallest = culmsOf(skeleton).reduce((best, culm) =>
			(culm.joints.at(-1)?.[1] ?? 0) > (best.joints.at(-1)?.[1] ?? 0) ? culm : best,
		);
		const joints = tallest.joints.length - 1;
		expect(joints).toBeGreaterThanOrEqual(15);
		expect(joints).toBeLessThanOrEqual(26);
	});

	it('ranks every socket once across the plant and keeps the culms bare below their branching height', () => {
		for (const variant of VARIANTS) {
			const { skeleton } = growPlantNow(kit, { seed: 11, variant, near: true });
			const sockets = socketsOf(skeleton);
			const ranks = sockets.map((s) => s.rank).sort((a, b) => a - b);
			expect(ranks).toEqual(ranks.map((_, i) => i));
			const target = targetHeight(kit.record, 11, variant);
			// No pair below the rim's branching height of the tallest culm the record allows.
			for (const s of sockets) expect(s.y).toBeGreaterThan(0.3 * target * growth.thin.height[0]);
		}
	});

	it("stands the drawn top at the variant's height", () => {
		for (const variant of VARIANTS) {
			const asset = growPlantNow(kit, { seed: 11, variant, near: true });
			const target = targetHeight(kit.record, 11, variant);
			expect(Math.abs(drawnTop(kit, asset) - target) / target).toBeLessThan(0.03);
		}
	});

	it('sets successive pairs up a culm on alternate sides', () => {
		const { skeleton } = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		const byCulm = new Map<number, { y: number; azimuth: number }[]>();
		for (const s of socketsOf(skeleton)) {
			const list = byCulm.get(s.axis) ?? [];
			list.push({ y: s.y, azimuth: azimuthOf(skeleton, s.bud) });
			byCulm.set(s.axis, list);
		}
		let turns = 0;
		let alternate = 0;
		for (const list of byCulm.values()) {
			list.sort((a, b) => a.y - b.y);
			for (let i = 1; i < list.length - 1; i++) {
				const d = Math.abs(
					(((((list[i] as { azimuth: number }).azimuth -
						(list[i - 1] as { azimuth: number }).azimuth) %
						360) +
						540) %
						360) -
						180,
				);
				turns++;
				if (d > 90) alternate++;
			}
		}
		expect(alternate / turns).toBeGreaterThan(0.9);
	});

	it('leaves a dormant bud for a sheath at each joint low on a culm', () => {
		const { skeleton } = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		let sheaths = 0;
		for (let b = 0; b < skeleton.buds.count; b++)
			if ((skeleton.buds.kind[b] as number) === BUD_DORMANT) {
				sheaths++;
				expect(skeleton.buds.position[b * 3 + 1] as number).toBeLessThan(
					(growth.sheaths?.upTo ?? 0) * skeleton.height + 1e-6,
				);
			}
		expect(sheaths).toBeGreaterThan(0);
	});

	it('leaves a joint bud at every joint above the foot, with the wood radius the ring takes', () => {
		const { skeleton } = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		const joints = new Map<number, number>();
		for (const culm of culmsOf(skeleton)) {
			const { axes } = skeleton;
			for (let n = (axes.first[culm.axis] as number) + 1; n < (axes.last[culm.axis] as number); n++)
				joints.set(n, skeleton.radius[n] as number);
		}
		let jointsWithBud = 0;
		for (let b = 0; b < skeleton.buds.count; b++) {
			if ((skeleton.buds.kind[b] as number) !== BUD_JOINT) continue;
			const node = skeleton.buds.node[b] as number;
			const radius = joints.get(node);
			expect(radius).toBeDefined();
			expect(skeleton.buds.woodRadius[b] as number).toBeCloseTo(radius as number, 5);
			jointsWithBud++;
		}
		expect(jointsWithBud).toBe(joints.size);
	});
});
