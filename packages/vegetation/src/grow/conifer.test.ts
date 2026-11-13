// The conifer grower: the limb schedule gives the record's counts, each level's limbs stand spread
// round the trunk, every axis bends within its bound and joins the wood it leaves, and one seed
// grows one plant.
import { describe, expect, it } from 'bun:test';
import { speciesProblems } from '../core/check';
import { AXIS_STEM, type MacroSkeleton } from '../core/graph';
import { hashBytes } from '../core/hash';
import type { Conifer } from '../core/record';
import { spreadMean } from '../core/types';
import { directed as sequoia } from '../species/giant-sequoia/directed';
import { directed } from '../species/scots-pine/directed';
import { growConifer, limbsPerLevel, planConifer, TURN_MOST } from './conifer';

const SEEDS = [11, 12, 13, 14] as const;
const growth = directed.growth as Conifer;
/** Degrees a limb may stand off its level's even spacing: the record's jitter, both ways. */
const SPREAD_TOLERANCE = 2 * growth.limbs.jitter + 1e-6;

/** The pine's directed frame at one seed and variant. */
const input = (seed: number, variant = 0) =>
	({ record: directed, seed, variant, season: 'summer' }) as const;

/** The digest of the arrays a growth gives, so two runs compare byte for byte. */
function digest(skeleton: MacroSkeleton): string {
	return [
		hashBytes(new Uint8Array(skeleton.position.buffer), 1),
		hashBytes(new Uint8Array(skeleton.radius.buffer), 2),
		hashBytes(new Uint8Array(skeleton.parent.buffer), 3),
		hashBytes(skeleton.axes.order, 4),
	].join(':');
}

/** The most degrees any internode of a skeleton turns from the internode before it on its axis. */
function sharpestTurn(skeleton: MacroSkeleton): number {
	const { position, parent, axisOf } = skeleton;
	let most = 0;
	for (let n = 0; n < skeleton.nodeCount; n++) {
		const p = parent[n] as number;
		if (p < 0 || axisOf[p] !== axisOf[n]) continue;
		const q = parent[p] as number;
		if (q < 0 || axisOf[q] !== axisOf[n]) continue;
		const a = [0, 1, 2].map(
			(k) => (position[p * 3 + k] as number) - (position[q * 3 + k] as number),
		);
		const b = [0, 1, 2].map(
			(k) => (position[n * 3 + k] as number) - (position[p * 3 + k] as number),
		);
		const dot =
			(a[0] as number) * (b[0] as number) +
			(a[1] as number) * (b[1] as number) +
			(a[2] as number) * (b[2] as number);
		const la = Math.hypot(a[0] as number, a[1] as number, a[2] as number);
		const lb = Math.hypot(b[0] as number, b[1] as number, b[2] as number);
		most = Math.max(most, (Math.acos(Math.min(1, Math.max(-1, dot / (la * lb)))) * 180) / Math.PI);
	}
	return most;
}

describe('the conifer limb schedule', () => {
	it('shares a count over the levels as evenly as whole numbers allow', () => {
		expect(limbsPerLevel(12, 5)).toEqual([2, 2, 3, 2, 3]);
		expect(limbsPerLevel(54, 12).reduce((sum, n) => sum + n, 0)).toBe(54);
		expect(Math.max(...limbsPerLevel(54, 12)) - Math.min(...limbsPerLevel(54, 12))).toBe(1);
		expect(limbsPerLevel(3, 5)).toEqual([1, 1, 1, 1, 1]);
	});

	it("passes the record check and gives the record's limbs at every level", () => {
		expect(speciesProblems(directed)).toEqual([]);
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			expect(plan.perLevel).toEqual(limbsPerLevel(growth.limbs.count, growth.limbs.levels.length));
			plan.perLevel.forEach((count, level) => {
				expect(plan.limbs.filter((limb) => !limb.top && limb.level === level).length).toBe(count);
			});
			expect(plan.limbs.filter((limb) => limb.top).length).toBe(growth.top?.limbs ?? 0);
		}
	});

	it("spreads each level's limbs round the trunk within the record's jitter", () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const levels = growth.limbs.levels.length + 1;
			for (let level = 0; level < levels; level++) {
				const turns = plan.limbs
					.filter((limb) => limb.level === level)
					.map((limb) => ((limb.azimuth % 360) + 360) % 360)
					.sort((a, b) => a - b);
				if (turns.length < 2) continue;
				const even = 360 / turns.length;
				turns.forEach((turn, k) => {
					const next = k + 1 < turns.length ? (turns[k + 1] as number) : (turns[0] as number) + 360;
					expect(Math.abs(next - turn - even)).toBeLessThanOrEqual(SPREAD_TOLERANCE);
				});
			}
		}
	});

	it('stands every limb within the stagger of its level, on the trunk', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const height = (plan.trunk[plan.trunk.length - 1]?.y ?? 0) / growth.trunk.dividesAt;
			for (const limb of plan.limbs) {
				const from = plan.trunk[limb.trunkNode];
				expect(from).toBeDefined();
				if (limb.top || !from) continue;
				const level = growth.limbs.levels[limb.level] as number;
				expect(Math.abs(from.y / height - level)).toBeLessThanOrEqual(growth.limbs.stagger + 0.002);
			}
		}
	});

	it("lays its two longest limbs along the plan's wide side, one toward each end", () => {
		/** Degrees a direction stands off the wide side's line, from 0 to 90. */
		const offLine = (azimuth: number): number => {
			const off = Math.abs(((((azimuth - growth.limbs.plan.turn) % 360) + 540) % 360) - 180);
			return Math.min(off, 180 - off);
		};
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const [first, second] = plan.limbs
				.filter((limb) => !limb.top)
				.sort((a, b) => b.place - a.place);
			expect(first && second).toBeTruthy();
			if (!first || !second) continue;
			// Each stands as far off the line as the other, and no more than a few degrees.
			expect(Math.abs(offLine(first.azimuth) - offLine(second.azimuth))).toBeLessThan(1e-6);
			expect(offLine(first.azimuth)).toBeLessThan(15);
			expect(Math.cos(((first.azimuth - second.azimuth) * Math.PI) / 180)).toBeLessThan(-0.85);
		}
	});

	it('builds a crown whose narrow side is at least three quarters of its wide side', () => {
		const turn = (growth.limbs.plan.turn * Math.PI) / 180;
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			/** The crown's width along a level direction: the patches' farthest edges both ways. */
			const widthAlong = (x: number, z: number): number => {
				let low = 0;
				let high = 0;
				for (const { patch } of plan.limbs) {
					const at = patch.centre[0] * x + patch.centre[2] * z;
					low = Math.min(low, at - patch.width / 2);
					high = Math.max(high, at + patch.width / 2);
				}
				return high - low;
			};
			const wide = widthAlong(Math.cos(turn), Math.sin(turn));
			const narrow = widthAlong(-Math.sin(turn), Math.cos(turn));
			expect(narrow / wide).toBeGreaterThanOrEqual(0.75);
			// The grower solves the plan for the record's own share.
			expect(Math.abs(narrow / wide - growth.limbs.plan.narrow)).toBeLessThan(0.04);
		}
	});
});

describe('the conifer frame as a skeleton', () => {
	it('turns no internode more than the bound from the one before it', () => {
		for (const seed of SEEDS)
			expect(sharpestTurn(growConifer(input(seed)))).toBeLessThanOrEqual(TURN_MOST);
	});

	it('joins every axis to the stem and thins every axis toward its end', () => {
		for (const seed of SEEDS) {
			const skeleton = growConifer(input(seed));
			const { axes, radius, parent, axisOf } = skeleton;
			let stems = 0;
			for (let a = 0; a < axes.count; a++) {
				if ((axes.parent[a] as number) < 0) {
					stems++;
					expect(axes.kind[a]).toBe(AXIS_STEM);
					continue;
				}
				// An axis starts at a node of its parent axis.
				const first = axes.first[a] as number;
				expect(axisOf[parent[first] as number]).toBe(axes.parent[a] as number);
				expect(parent[first]).toBe(axes.parentNode[a] as number);
			}
			expect(stems).toBe(1);
			for (let n = 0; n < skeleton.nodeCount; n++) {
				const p = parent[n] as number;
				if (p >= 0 && axisOf[p] === axisOf[n])
					expect(radius[n] as number).toBeLessThanOrEqual((radius[p] as number) + 1e-6);
				if (p >= 0) expect(radius[n] as number).toBeLessThanOrEqual((radius[p] as number) + 1e-6);
			}
		}
	});

	it("stands its top at the record's height and its lowest limb at the lowest level", () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const highest = Math.max(
				...plan.limbs.map((limb) => limb.patch.centre[1] + limb.patch.depth / 2),
			);
			expect(highest).toBeCloseTo(plan.height, 2);
			const lowest = Math.min(...plan.limbs.map((limb) => plan.trunk[limb.trunkNode]?.y ?? 0));
			expect(lowest / plan.height).toBeGreaterThan(
				(growth.limbs.levels[0] as number) - growth.limbs.stagger - 0.01,
			);
		}
	});

	it('runs every limb on under its patch and ends its arms inside it', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			for (const limb of plan.limbs) {
				const { centre, width } = limb.patch;
				const ends = [limb.nodes, ...limb.arms.map((arm) => arm.nodes)].map(
					(nodes) => nodes[nodes.length - 1],
				);
				for (const end of ends) {
					expect(end).toBeDefined();
					if (!end) continue;
					expect(Math.hypot(end.x - centre[0], end.z - centre[2])).toBeLessThanOrEqual(width / 2);
				}
				// An arm reaches out under its pad: its end stands a fifth of the pad's width from its foot.
				for (const arm of limb.arms) {
					const foot = limb.nodes[arm.node];
					const tip = arm.nodes[arm.nodes.length - 1];
					expect(foot && tip).toBeTruthy();
					if (foot && tip)
						expect(Math.hypot(tip.x - foot.x, tip.z - foot.z)).toBeGreaterThan(width * 0.2);
				}
				expect(limb.arms.length).toBe(growth.limbs.arms.count);
				expect(new Set(limb.arms.map((arm) => arm.node)).size).toBe(limb.arms.length);
			}
		}
	});

	it('grows the same plant from the same seed, and another from another', () => {
		expect(digest(growConifer(input(11)))).toBe(digest(growConifer(input(11))));
		expect(digest(growConifer(input(11)))).not.toBe(digest(growConifer(input(12))));
		expect(digest(growConifer(input(11, 0)))).not.toBe(digest(growConifer(input(11, 1))));
	});
});

describe("the giant sequoia's frame", () => {
	const own = sequoia.growth as Conifer;
	const grown = (seed: number) =>
		({ record: sequoia, seed, variant: 0, season: 'summer' }) as const;

	it("passes the record check and gives the record's limbs at every level", () => {
		expect(speciesProblems(sequoia)).toEqual([]);
		for (const seed of SEEDS) {
			const plan = planConifer(grown(seed));
			expect(plan.limbs.length).toBe(own.limbs.count);
			// The plant's top is the record's height, within the spread a seed may draw.
			expect(plan.height).toBeGreaterThanOrEqual(54);
			expect(plan.height).toBeLessThanOrEqual(62);
			expect(plan.perLevel).toEqual(limbsPerLevel(own.limbs.count, own.limbs.levels.length));
			expect(Math.max(...plan.perLevel) - Math.min(...plan.perLevel)).toBeLessThanOrEqual(1);
		}
	});

	it("carries a patch on every limb end and every arm end, each apart from its own limb's others", () => {
		const plan = planConifer(grown(11));
		// One on the trunk's tip, and one on every limb end and arm end.
		expect(plan.patches.length).toBe(1 + own.limbs.count * (1 + own.limbs.arms.count));
		expect(plan.height).toBeCloseTo(
			Math.max(...plan.patches.map((patch) => patch.centre[1] + patch.depth / 2)),
			3,
		);
		for (const limb of plan.limbs) {
			const ends = [limb.patch, ...limb.arms.map((arm) => arm.patch)];
			for (let a = 0; a < ends.length; a++)
				for (let b = a + 1; b < ends.length; b++) {
					const first = ends[a];
					const second = ends[b];
					expect(first && second).toBeTruthy();
					if (!first || !second) continue;
					const apart = Math.hypot(
						first.centre[0] - second.centre[0],
						first.centre[1] - second.centre[1],
						first.centre[2] - second.centre[2],
					);
					expect(apart).toBeGreaterThan(first.width * 0.6);
				}
		}
	});

	it('dips its lower limbs and hooks every limb end up', () => {
		const plan = planConifer(grown(11));
		for (const limb of plan.limbs) {
			const from = plan.trunk[limb.trunkNode];
			const end = limb.nodes[limb.nodes.length - 1];
			const before = limb.nodes[limb.nodes.length - 2];
			expect(from && end && before).toBeTruthy();
			if (!from || !end || !before) continue;
			// The last piece rises.
			expect(end.y).toBeGreaterThan(before.y);
			// A limb of the lower crown passes below the height it leaves at.
			if (from.y / plan.height < 0.45)
				expect(Math.min(...limb.nodes.map((node) => node.y))).toBeLessThan(from.y);
		}
	});

	it('turns no internode more than the bound and joins every axis', () => {
		for (const seed of SEEDS) {
			const skeleton = growConifer(grown(seed));
			expect(sharpestTurn(skeleton)).toBeLessThanOrEqual(TURN_MOST);
			for (let a = 1; a < skeleton.axes.count; a++)
				expect(skeleton.axisOf[skeleton.parent[skeleton.axes.first[a] as number] as number]).toBe(
					skeleton.axes.parent[a] as number,
				);
		}
		expect(digest(growConifer(grown(11)))).toBe(digest(growConifer(grown(11))));
	});
});

describe("the pine's sockets", () => {
	const rule = growth.patch.sockets;
	const pitch = rule?.pitch ?? 0;
	/** The metres a bough reaches from its socket to the outside of its foliage. */
	const bough = directed.pieces?.find((piece) => piece.name === rule?.piece);
	const reach = (bough ? spreadMean(bough.stem.length) : 0) * 0.85;
	const apart = (a: readonly number[], b: readonly number[]): number =>
		Math.hypot(
			(a[0] as number) - (b[0] as number),
			(a[1] as number) - (b[1] as number),
			(a[2] as number) - (b[2] as number),
		);

	it('ranks every socket once across the plant, the ends of every limb and arm first', () => {
		expect(rule).toBeDefined();
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			expect(plan.sockets.map((socket) => socket.rank).sort((a, b) => a - b)).toEqual(
				plan.sockets.map((_, i) => i),
			);
			const ends = plan.limbs.reduce((sum, limb) => sum + 1 + limb.arms.length, 0);
			for (const socket of plan.sockets) {
				const limb = plan.limbs[socket.limb];
				expect(limb).toBeDefined();
				if (!limb) continue;
				const wood = socket.arm < 0 ? limb.nodes : (limb.arms[socket.arm]?.nodes ?? []);
				const onEnd = socket.twig < 0 && socket.node === wood.length - 1;
				expect(onEnd).toBe(socket.rank < ends);
			}
		}
	});

	it('stands no two sockets of a pad nearer than seven tenths of the pitch, all inside the pad', () => {
		const plan = planConifer(input(11));
		plan.patches.forEach((patch, index) => {
			const own = plan.sockets.filter((socket) => socket.patch === index);
			for (let a = 0; a < own.length; a++) {
				const first = own[a];
				if (!first) continue;
				expect(
					Math.hypot(first.at[0] - patch.centre[0], first.at[2] - patch.centre[2]),
				).toBeLessThanOrEqual(patch.width / 2 + 1e-6);
				for (let b = a + 1; b < own.length; b++) {
					const second = own[b];
					if (!second) continue;
					expect(apart(first.at, second.at)).toBeGreaterThanOrEqual(pitch * 0.7 - 1e-6);
				}
			}
		});
	});

	it('fills every pad as a dome: a bough within reach of every place on it, at every height', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			plan.patches.forEach((patch, index) => {
				const own = plan.sockets.filter((socket) => socket.patch === index);
				const floor = patch.centre[1] - patch.depth / 2;
				// No place on the pad's dome stands farther from a socket than a bough's reach and
				// one pitch.
				for (let turn = 0; turn < 24; turn++)
					for (let band = 0; band < 8; band++) {
						const t = (band + 0.5) / 8;
						const ring = Math.sqrt(1 - t * t);
						const angle = (turn / 24) * 2 * Math.PI;
						const place = [
							patch.centre[0] + (patch.width / 2) * ring * Math.cos(angle),
							floor + patch.depth * t,
							patch.centre[2] + (patch.width / 2) * ring * Math.sin(angle),
						];
						const nearest = Math.min(...own.map((socket) => apart(socket.at, place)));
						expect(nearest).toBeLessThanOrEqual(reach + pitch);
					}
				// A pad wide enough to hold a dome of sockets is as deep for its width as the record
				// says, within a tenth, measured over its boughs' reach.
				if (patch.width < 8 * pitch) return;
				const top = Math.max(...own.map((socket) => socket.at[1]));
				const rim = Math.max(
					...own.map((socket) =>
						Math.hypot(socket.at[0] - patch.centre[0], socket.at[2] - patch.centre[2]),
					),
				);
				const built = (top - floor + reach) / (2 * (rim + reach));
				expect(Math.abs(built - growth.patch.depth)).toBeLessThanOrEqual(growth.patch.depth * 0.1);
				// Its sockets stand through its depth: a fifth of them or more in each third.
				const thirds = [0, 0, 0];
				for (const socket of own)
					(thirds[
						Math.min(2, Math.floor(((socket.at[1] - floor) / (top - floor + 1e-9)) * 3))
					] as number)++;
				for (const third of thirds) expect(third).toBeGreaterThanOrEqual(own.length / 5);
			});
		}
	});

	it('gives its boughs many sizes and lifts, none below level and none past the lift', () => {
		const plan = planConifer(input(11));
		const sizes = plan.sockets.filter((socket) => socket.twig >= 0).map((socket) => socket.scale);
		expect(Math.min(...sizes)).toBeLessThan(0.85);
		expect(Math.max(...sizes)).toBeGreaterThan(1.15);
		expect(new Set(sizes.map((size) => size.toFixed(3))).size).toBeGreaterThan(sizes.length / 4);
		const lifts = plan.sockets
			.filter((socket) => socket.twig >= 0)
			.map((socket) => (Math.asin(socket.heading[1]) * 180) / Math.PI);
		expect(Math.min(...lifts)).toBeGreaterThanOrEqual(-1e-6);
		expect(Math.max(...lifts)).toBeLessThanOrEqual((rule?.lift ?? 0) + 1e-6);
		expect(lifts.filter((lift) => lift < 15).length).toBeGreaterThan(lifts.length / 10);
		expect(lifts.filter((lift) => lift > 30).length).toBeGreaterThan(lifts.length / 10);
	});

	it('ends every twig in a socket, a twig at most on a twig on the limb or an arm', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			plan.twigs.forEach((twig, index) => {
				const on = plan.sockets.filter((socket) => socket.twig === index);
				expect(on.some((socket) => socket.node === twig.nodes.length - 1)).toBe(true);
				expect(twig.twig).toBeLessThan(index);
				if (twig.twig >= 0) expect(plan.twigs[twig.twig]?.twig).toBe(-1);
			});
		}
	});

	it('keeps a quarter and a tenth of the plant by rank as the same share of every pad, spread over it', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const all = plan.sockets.length;
			const ends = plan.limbs.reduce((sum, limb) => sum + 1 + limb.arms.length, 0);
			for (const share of [0.25, 0.1]) {
				const cut = Math.round(share * all);
				expect(cut).toBeGreaterThan(ends);
				plan.patches.forEach((patch, index) => {
					const own = plan.sockets.filter((socket) => socket.patch === index);
					const kept = own.filter((socket) => socket.rank < cut);
					const limb = plan.limbs[patch.limb];
					if (!limb) return;
					// Past its ends, each pad keeps the plant's own share of its sockets, to one socket.
					const padEnds = 1 + limb.arms.length;
					const fair = padEnds + ((cut - ends) / (all - ends)) * (own.length - padEnds);
					expect(Math.abs(kept.length - fair)).toBeLessThanOrEqual(1);
					// No socket of the pad stands farther from a kept one than the kept stand apart
					// on an even grid: the pitch over the root of the share.
					for (const socket of own) {
						const nearest = Math.min(...kept.map((other) => apart(socket.at, other.at)));
						expect(nearest).toBeLessThanOrEqual(pitch / Math.sqrt(share));
					}
				});
			}
		}
	});

	it('writes each socket as a bud site on its own wood', () => {
		const plan = planConifer(input(11));
		const skeleton = growConifer(input(11));
		const { buds } = skeleton;
		expect(buds.count).toBe(plan.sockets.length);
		expect(buds.sockets).toBeDefined();
		for (let b = 0; b < buds.count; b++) {
			const node = buds.node[b] as number;
			// The site stands at its node, and its axis is the node's own.
			expect(buds.axis[b]).toBe(skeleton.axisOf[node] as number);
			for (let k = 0; k < 3; k++)
				expect(buds.position[b * 3 + k] as number).toBeCloseTo(
					skeleton.position[node * 3 + k] as number,
					4,
				);
			expect(buds.sockets?.rank[b]).toBe((plan.sockets[b] as (typeof plan.sockets)[number]).rank);
			expect(buds.sockets?.lobe[b]).toBe((plan.sockets[b] as (typeof plan.sockets)[number]).patch);
		}
	});
});
