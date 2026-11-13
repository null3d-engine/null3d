// The scaffold grower, held to the five rules of branch structure on the pedunculate oak, over three
// seeds and every variant: every branch ends at a socket; every axis bends in gentle steps and no
// limb runs back toward the stem; the branch count is the socket count; the limbs and the foliage
// stand balanced round the stem; and the same inputs grow the same bytes. The sky through the
// crown, the fifth rule, is read from a drawn matte by the preview tool's own test.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { MacroSkeleton } from '../core/graph';
import { AXIS_STEM, BUD_TERMINAL } from '../core/graph';
import { hashBytes } from '../core/hash';
import type { Scaffold } from '../core/record';
import { loadSpecies } from '../core/registry';
import { spreadMean } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode, withLimbs } from '../generate';
import { connectedBody } from '../lod/connect';
import { record } from '../species/pedunculate-oak/record';
import type { MeshInput } from '../stages';
import { cardTop, targetHeight } from './height';
import { growScaffold } from './scaffold';

const SEEDS = [3, 7, 11] as const;
const VARIANTS = [0, 1, 2, 3, 4, 5] as const;
const DEG = 180 / Math.PI;

/** The oak's growth, which the bounds below read. */
const growth = record.growth as Scaffold;
/** The height every plant is laid out at before it is scaled to its own. */
const MEAN_HEIGHT = spreadMean(record.size.height);

/**
 * The great limbs the winter oak's whole views show round its bole: six or seven, and five to
 * eight over the variants.
 */
const LIMBS: readonly [number, number] = [5, 8];
/** The most degrees between two neighbouring great limbs round the stem. */
const LIMB_GAP_MOST = 120;
/** The least and most of an even share of the sockets that one eighth of the turn holds. */
const OCTANT_SHARE: readonly [number, number] = [0.45, 1.8];
/** The most metres a great limb runs back toward the stem. */
const BACK_MOST = 0.6;
/** The least metres of radius a great limb bends on. */
const BEND_RADIUS_LEAST = 0.3;
/** The most of a plant's side axes that leave their parent pointing back along it. */
const BACKWARD_JOINTS_MOST = 0.02;
/** The most axes for each socket: one twig a socket, and the wood that carries the twigs. */
const AXES_PER_SOCKET_MOST = 1.12;
/** The photographs' bole at breast height, as a share of the plant's height. */
const BOLE: readonly [number, number] = [0.116, 0.178];
/** The crown's foot, as a share of the plant's height: sky shows under the crown down to the fork. */
const CROWN_FOOT: readonly [number, number] = [0.1, 0.2];

/** Every plant the rules are held over, with its seed and variant. */
const plants = SEEDS.flatMap((seed) =>
	VARIANTS.map((variant) => ({
		seed,
		variant,
		skeleton: growScaffold({ record, seed, variant, season: 'summer' }),
	})),
);

/** The unit step from one node to another, and its length. */
function step(s: MacroSkeleton, from: number, to: number): [number, number, number, number] {
	const p = s.position;
	const x = (p[to * 3] as number) - (p[from * 3] as number);
	const y = (p[to * 3 + 1] as number) - (p[from * 3 + 1] as number);
	const z = (p[to * 3 + 2] as number) - (p[from * 3 + 2] as number);
	const length = Math.sqrt(x * x + y * y + z * z);
	return [x / length, y / length, z / length, length];
}

/** The degrees between two unit steps. */
function between(a: readonly number[], b: readonly number[]): number {
	const dot =
		(a[0] as number) * (b[0] as number) +
		(a[1] as number) * (b[1] as number) +
		(a[2] as number) * (b[2] as number);
	return Math.acos(Math.min(1, Math.max(-1, dot))) * DEG;
}

/** The axes that leave a stem: the great limbs. */
function greatLimbs(s: MacroSkeleton): number[] {
	const limbs: number[] = [];
	for (let a = 0; a < s.axes.count; a++) {
		const parent = s.axes.parent[a] as number;
		if (parent >= 0 && (s.axes.kind[parent] as number) === AXIS_STEM) limbs.push(a);
	}
	return limbs;
}

/** The digest of the arrays a growth gives, so two runs compare byte for byte. */
function digest(s: MacroSkeleton): string {
	return [
		hashBytes(new Uint8Array(s.position.buffer), 1),
		hashBytes(new Uint8Array(s.radius.buffer), 2),
		hashBytes(new Uint8Array(s.parent.buffer), 3),
		hashBytes(s.axes.order, 4),
		hashBytes(new Uint8Array(s.buds.position.buffer), 5),
		hashBytes(new Uint8Array(s.buds.frame.buffer), 6),
		hashBytes(new Uint8Array((s.buds.sockets?.rank ?? new Uint32Array(0)).buffer), 7),
	].join(':');
}

describe('the scaffold grower', () => {
	it('ends every branch at a socket, and stands every socket at a branch end', () => {
		for (const { seed, variant, skeleton: s } of plants) {
			const children = new Uint16Array(s.nodeCount);
			for (let n = 0; n < s.nodeCount; n++) {
				const parent = s.parent[n] as number;
				if (parent >= 0) children[parent] = (children[parent] as number) + 1;
			}
			const socketAt = new Set<number>(s.buds.node);
			let bare = 0;
			let tips = 0;
			for (let n = 0; n < s.nodeCount; n++) {
				if ((children[n] as number) > 0) continue;
				tips++;
				if (!socketAt.has(n)) bare++;
			}
			expect([seed, variant, bare]).toEqual([seed, variant, 0]);
			// One socket a tip: no socket stands along a branch, and no tip holds two.
			expect([seed, variant, s.buds.count]).toEqual([seed, variant, tips]);
			expect(socketAt.size).toBe(s.buds.count);
			for (let b = 0; b < s.buds.count; b++) {
				expect(s.buds.kind[b]).toBe(BUD_TERMINAL);
				expect(children[s.buds.node[b] as number]).toBe(0);
				expect(s.buds.woodRadius[b] as number).toBeGreaterThan(0);
			}
		}
	});

	it('gives every socket a size, a rank and its foliage mass', () => {
		for (const { seed, variant, skeleton: s } of plants) {
			const sockets = s.buds.sockets;
			if (!sockets) throw new Error('the skeleton carries no sockets');
			const own = targetHeight(record, seed, variant) / MEAN_HEIGHT;
			const ranks = new Set<number>(sockets.rank);
			// The ranks are each number below the socket count, once.
			expect(ranks.size).toBe(s.buds.count);
			expect(Math.max(...sockets.rank)).toBe(s.buds.count - 1);
			const lobes = new Set<number>(sockets.lobe);
			expect(lobes.size).toBeGreaterThan(30);
			for (let b = 0; b < s.buds.count; b++) {
				expect((sockets.scale[b] as number) / own).toBeGreaterThan(0.79);
				expect((sockets.scale[b] as number) / own).toBeLessThan(1.26);
			}
			// The first quarter by rank stands in every eighth of the turn: thinning by rank keeps
			// the crown's whole round.
			const kept = new Uint8Array(8);
			for (let b = 0; b < s.buds.count; b++) {
				if ((sockets.rank[b] as number) >= s.buds.count / 4) continue;
				const turn = Math.atan2(
					s.buds.position[b * 3 + 2] as number,
					s.buds.position[b * 3] as number,
				);
				kept[Math.floor(((turn + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8] = 1;
			}
			expect([seed, variant, kept.reduce((sum, value) => sum + value, 0)]).toEqual([
				seed,
				variant,
				8,
			]);
		}
	});

	it("bends every axis in gentle steps, with no step past the record's turn", () => {
		for (const { seed, variant, skeleton: s } of plants) {
			let worst = 0;
			for (let a = 0; a < s.axes.count; a++)
				for (let n = (s.axes.first[a] as number) + 1; n <= (s.axes.last[a] as number); n++) {
					const at = s.parent[n] as number;
					const before = s.parent[at] as number;
					if (before < 0) continue;
					worst = Math.max(worst, between(step(s, before, at), step(s, at, n)));
				}
			// The turn at an axis's first node counts too: it is drawn after the joint.
			expect([seed, variant, worst <= growth.branches.turn + 0.01]).toEqual([seed, variant, true]);
		}
	});

	it('runs every great limb out from the stem on a wide bend, never back toward it', () => {
		for (const { seed, variant, skeleton: s } of plants) {
			const stem = s.axes.first[0] as number;
			const stemX = s.position[stem * 3] as number;
			const stemZ = s.position[stem * 3 + 2] as number;
			let back = 0;
			let tightest = Number.POSITIVE_INFINITY;
			for (let a = 0; a < s.axes.count; a++) {
				if ((s.axes.order[a] as number) !== 1) continue;
				let reach = -1;
				for (let n = s.axes.first[a] as number; n <= (s.axes.last[a] as number); n++) {
					const out = Math.hypot(
						(s.position[n * 3] as number) - stemX,
						(s.position[n * 3 + 2] as number) - stemZ,
					);
					if (reach >= 0) back = Math.max(back, reach - out);
					reach = Math.max(reach, out);
					const at = s.parent[n] as number;
					const before = at >= 0 ? (s.parent[at] as number) : -1;
					if (before < 0 || (s.axisOf[at] as number) !== a) continue;
					const next = step(s, at, n);
					const turn = between(step(s, before, at), next) / DEG;
					if (turn > 0.01) tightest = Math.min(tightest, next[3] / turn);
				}
			}
			expect([seed, variant, back < BACK_MOST]).toEqual([seed, variant, true]);
			expect([seed, variant, tightest > BEND_RADIUS_LEAST]).toEqual([seed, variant, true]);
		}
	});

	it('leaves its branches forward along their parents', () => {
		for (const { seed, variant, skeleton: s } of plants) {
			let sides = 0;
			let backward = 0;
			for (let a = 0; a < s.axes.count; a++) {
				const joint = s.axes.parentNode[a] as number;
				const before = joint >= 0 ? (s.parent[joint] as number) : -1;
				if (before < 0) continue;
				sides++;
				if (between(step(s, before, joint), step(s, joint, s.axes.first[a] as number)) > 90)
					backward++;
			}
			expect([seed, variant, backward / sides < BACKWARD_JOINTS_MOST]).toEqual([
				seed,
				variant,
				true,
			]);
		}
	});

	it('keeps its branch count to its sockets, in the orders a tree divides by', () => {
		for (const { seed, variant, skeleton: s } of plants) {
			const perOrder: number[] = [];
			for (let a = 0; a < s.axes.count; a++) {
				const order = s.axes.order[a] as number;
				perOrder[order] = (perOrder[order] ?? 0) + 1;
			}
			// One stem; the limbs; the branches that carry the lobes; then two orders of twig.
			expect(perOrder.length).toBe(5);
			expect(perOrder[0]).toBe(1);
			const limbs = greatLimbs(s).length;
			expect([seed, variant, limbs >= LIMBS[0] && limbs <= LIMBS[1]]).toEqual([
				seed,
				variant,
				true,
			]);
			const lobes = new Set<number>(s.buds.sockets?.lobe).size;
			// No more wood above the twigs than a branch for each lobe and a fork for each.
			expect((perOrder[1] ?? 0) + (perOrder[2] ?? 0)).toBeLessThanOrEqual(2 * lobes);
			// One twig for each socket and the wood that carries the twigs: the sockets bound the count.
			const twigs = (perOrder[3] ?? 0) + (perOrder[4] ?? 0);
			expect(twigs).toBeLessThanOrEqual(s.buds.count);
			expect([seed, variant, s.axes.count / s.buds.count < AXES_PER_SOCKET_MOST]).toEqual([
				seed,
				variant,
				true,
			]);
		}
	});

	it('grows fewer branches from fewer sockets, in proportion', () => {
		const half = withLimbs(record, 0.5);
		for (const variant of VARIANTS) {
			const full = growScaffold({ record, seed: 11, variant, season: 'summer' });
			const thin = growScaffold({ record: half, seed: 11, variant, season: 'summer' });
			const sockets = thin.buds.count / full.buds.count;
			const axes = thin.axes.count / full.axes.count;
			expect([variant, sockets > 0.4 && sockets < 0.62]).toEqual([variant, true]);
			expect([variant, Math.abs(axes - sockets) < 0.06]).toEqual([variant, true]);
			// The limbs and the lobes stay: the thinner plant keeps the crown's outline.
			expect(greatLimbs(thin).length).toBe(greatLimbs(full).length);
			expect(new Set<number>(thin.buds.sockets?.lobe).size).toBe(
				new Set<number>(full.buds.sockets?.lobe).size,
			);
		}
	});

	it('spreads its limbs and its foliage through the whole turn round the stem', () => {
		for (const { seed, variant, skeleton: s } of plants) {
			// The limbs' places round the stem, and the widest gap between two neighbours.
			const turns = greatLimbs(s)
				.map((a) => {
					const first = s.axes.first[a] as number;
					const joint = s.axes.parentNode[a] as number;
					return Math.atan2(
						(s.position[first * 3 + 2] as number) - (s.position[joint * 3 + 2] as number),
						(s.position[first * 3] as number) - (s.position[joint * 3] as number),
					);
				})
				.sort((a, b) => a - b);
			let gap = 0;
			turns.forEach((turn, i) => {
				const next = turns[(i + 1) % turns.length] as number;
				gap = Math.max(gap, ((next - turn) * DEG + 360) % 360 || 360);
			});
			expect([seed, variant, gap < LIMB_GAP_MOST]).toEqual([seed, variant, true]);
			// The sockets in each eighth of the turn, against an even share.
			const eighths = new Float64Array(8);
			for (let b = 0; b < s.buds.count; b++) {
				const turn = Math.atan2(
					s.buds.position[b * 3 + 2] as number,
					s.buds.position[b * 3] as number,
				);
				const eighth = Math.floor(((turn + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8;
				eighths[eighth] = (eighths[eighth] as number) + 1;
			}
			const even = s.buds.count / 8;
			expect([seed, variant, Math.min(...eighths) / even > OCTANT_SHARE[0]]).toEqual([
				seed,
				variant,
				true,
			]);
			expect([seed, variant, Math.max(...eighths) / even < OCTANT_SHARE[1]]).toEqual([
				seed,
				variant,
				true,
			]);
			// The crown's box at the rubric's eight angles: its width's spread, largest less smallest
			// over the mean, inside the oak's all-round band. Its height is one for every angle.
			const widths: number[] = [];
			for (let k = 0; k < 8; k++) {
				const turn = (k * Math.PI) / 4;
				let low = Number.POSITIVE_INFINITY;
				let high = Number.NEGATIVE_INFINITY;
				for (let b = 0; b < s.buds.count; b++) {
					const across =
						(s.buds.position[b * 3] as number) * Math.cos(turn) -
						(s.buds.position[b * 3 + 2] as number) * Math.sin(turn);
					low = Math.min(low, across);
					high = Math.max(high, across);
				}
				widths.push(high - low);
			}
			const mean = widths.reduce((sum, width) => sum + width, 0) / widths.length;
			const spread = (Math.max(...widths) - Math.min(...widths)) / mean;
			expect([seed, variant, spread < (record.roundBand ?? 0.25)]).toEqual([seed, variant, true]);
		}
	});

	it("stands on one bole of the photographs' width, with sky under the crown down to the fork", () => {
		for (const { seed, variant, skeleton: s } of plants) {
			const height = targetHeight(record, seed, variant);
			let stems = 0;
			for (let a = 0; a < s.axes.count; a++) if ((s.axes.parent[a] as number) < 0) stems++;
			expect(stems).toBe(1);
			expect(s.axes.kind[0]).toBe(AXIS_STEM);
			// The stem's width at breast height: its last node at or below it.
			let radius = 0;
			for (let n = s.axes.first[0] as number; n <= (s.axes.last[0] as number); n++)
				if ((s.position[n * 3 + 1] as number) <= 1.3 * (height / MEAN_HEIGHT))
					radius = s.radius[n] as number;
			const bole = (2 * radius) / height;
			expect([seed, variant, bole > BOLE[0] && bole < BOLE[1]]).toEqual([seed, variant, true]);
			const foot = s.crownBase / height;
			expect([seed, variant, foot > CROWN_FOOT[0] && foot < CROWN_FOOT[1]]).toEqual([
				seed,
				variant,
				true,
			]);
			// The wood stands inside the record's height: the foliage carries the top.
			expect(s.height).toBeLessThan(height);
			expect(s.height).toBeGreaterThan(0.85 * height);
		}
	});

	it('joins every axis to the stem, parents before children, each axis one run of nodes', () => {
		for (const { skeleton: s } of plants) {
			for (let n = 0; n < s.nodeCount; n++) expect(s.parent[n] as number).toBeLessThan(n);
			for (let a = 0; a < s.axes.count; a++) {
				const parent = s.axes.parent[a] as number;
				expect(parent).toBeLessThan(a);
				for (let n = s.axes.first[a] as number; n <= (s.axes.last[a] as number); n++) {
					expect(s.axisOf[n]).toBe(a);
					if (n > (s.axes.first[a] as number)) expect(s.parent[n]).toBe(n - 1);
				}
				if (parent >= 0) {
					expect(s.axisOf[s.axes.parentNode[a] as number]).toBe(parent);
					expect(s.parent[s.axes.first[a] as number]).toBe(s.axes.parentNode[a] as number);
					// A side axis is never thicker than the wood it leaves.
					expect(s.radius[s.axes.first[a] as number] as number).toBeLessThanOrEqual(
						s.radius[s.axes.parentNode[a] as number] as number,
					);
				}
			}
			for (let n = 0; n < s.nodeCount; n++) {
				expect(Number.isFinite(s.position[n * 3] as number)).toBe(true);
				expect(s.radius[n] as number).toBeGreaterThan(0);
			}
		}
	});

	it('grows the same bytes from the same inputs, and another plant from another variant', () => {
		const again = growScaffold({ record, seed: 11, variant: 0, season: 'summer' });
		const first = plants.find((plant) => plant.seed === 11 && plant.variant === 0);
		expect(digest(again)).toBe(digest(first?.skeleton as MacroSkeleton));
		const digests = new Set(plants.map((plant) => digest(plant.skeleton)));
		expect(digests.size).toBe(plants.length);
	});
});

describe('a dressed scaffold plant', () => {
	it(
		'holds foliage at every socket, and is one connected body at every level',
		async () => {
			const module = await loadSpecies('pedunculate-oak');
			await loadPlantCode(module.record);
			const kit = buildKitNow(module, { placeholders: 'missing', detail: 'high' });
			const rowsEach = spreadMean(growth.sockets.rows);
			for (const variant of VARIANTS) {
				const asset = growPlantNow(kit, { seed: 11, variant, near: false });
				const { skeleton: s, shoots: rows } = asset;
				// Each socket's rows stand at the socket: a branch end with no row would end bare.
				const held = new Map<string, number>();
				for (let r = 0; r < rows.count; r++) {
					const key = `${rows.position[r * 3]},${rows.position[r * 3 + 1]},${rows.position[r * 3 + 2]}`;
					held.set(key, (held.get(key) ?? 0) + 1);
					// A row draws a shoot in leaf: the oak in summer keeps no bare twin.
					expect(kit.prototypes[rows.prototype[r] as number]?.leaves ?? 0).toBeGreaterThan(0);
				}
				let empty = 0;
				for (let b = 0; b < s.buds.count; b++) {
					const key = `${s.buds.position[b * 3]},${s.buds.position[b * 3 + 1]},${s.buds.position[b * 3 + 2]}`;
					if ((held.get(key) ?? 0) === 0) empty++;
				}
				expect([variant, empty]).toEqual([variant, 0]);
				expect(held.size).toBe(s.buds.count);
				expect(rows.count / s.buds.count).toBeGreaterThan(rowsEach - 0.5);
				expect(rows.count / s.buds.count).toBeLessThan(rowsEach + 0.5);
				// The drawn plant's top, its highest card, stands at the record's height for this variant.
				const target = targetHeight(kit.record, 11, variant);
				const top = cardTop(kit, rows, kit.record.lod.cardGrow ?? 1);
				expect(Math.abs(top - target) / target).toBeLessThan(0.01);
				// One body at each level, with every card of the first card level joined to drawn wood.
				const { min, max } = s.bounds;
				const input = {
					skeleton: s,
					record: kit.record,
					detail: 'high' as const,
					coarseness: asset.coarseness,
					rows,
					crown: {
						cells: [1, 1, 1] as const,
						min,
						cell: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
						sky: new Float32Array([1]),
					},
					seed: 11,
					variant,
					season: asset.season,
					kit,
				} as unknown as MeshInput;
				for (const level of [0, 1, 2] as const) {
					const body = connectedBody(input, level);
					expect([variant, level, body.components]).toEqual([variant, level, 1]);
					expect([variant, level, body.reachesRoot]).toEqual([variant, level, true]);
				}
				expect([variant, connectedBody(input, 1).cards]).toEqual([variant, rows.count]);
				expect(connectedBody(input, 2).cards).toBe(Math.ceil(rows.count / 2));
				// The levels stay inside the record's own triangle budget.
				const budget = kit.record.lod.budget;
				expect(asset.stats.triangles[1]).toBeLessThan(
					budget?.lod1Triangles ?? Number.POSITIVE_INFINITY,
				);
				expect(asset.stats.triangles[2]).toBeLessThan(
					budget?.lod2Triangles ?? Number.POSITIVE_INFINITY,
				);
			}
		},
		scaledBudget(120_000),
	);
});
