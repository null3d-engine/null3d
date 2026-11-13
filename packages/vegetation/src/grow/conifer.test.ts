// The conifer grower: the limb schedule gives the record's counts, each level's limbs stand spread
// round the trunk, every axis bends within its bound and joins the wood it leaves, and one seed
// grows one plant. A closed shell's sockets tile its outline and its inner body stands behind them.
import { describe, expect, it } from 'bun:test';
import { VARIANTS_BY_PRESET } from '../core/caps';
import { speciesProblems } from '../core/check';
import { AXIS_STEM, type MacroSkeleton } from '../core/graph';
import { hashBytes } from '../core/hash';
import type { Conifer } from '../core/record';
import { curveAt, spreadMean } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { directed as sequoia } from '../species/giant-sequoia/directed';
import { species as cypressModule } from '../species/italian-cypress';
import { directed as cypress } from '../species/italian-cypress/directed';
import { directed } from '../species/scots-pine/directed';
import { type ConiferPatch, growConifer, limbsPerLevel, planConifer, TURN_MOST } from './conifer';

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

/** A level place's metres from a patch's middle along its limb and across it. */
function laid(patch: ConiferPatch, x: number, z: number): [along: number, across: number] {
	const dx = x - patch.centre[0];
	const dz = z - patch.centre[2];
	return [dx * patch.along[0] + dz * patch.along[2], dz * patch.along[0] - dx * patch.along[2]];
}

/** How far out in its patch's plan a level place stands: 1 on the rim, below 1 inside it. */
function inPlan(patch: ConiferPatch, x: number, z: number): number {
	const [u, v] = laid(patch, x, z);
	return Math.hypot(u / (patch.length / 2), v / (patch.width / 2));
}

/** The level place on a patch's plan at a share of the way out from its middle and a turn from its limb's way. */
function planAt(patch: ConiferPatch, out: number, turn: number): [x: number, z: number] {
	const u = (patch.length / 2) * out * Math.cos(turn);
	const v = (patch.width / 2) * out * Math.sin(turn);
	return [
		patch.centre[0] + patch.along[0] * u - patch.along[2] * v,
		patch.centre[2] + patch.along[2] * u + patch.along[0] * v,
	];
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
				const { width } = limb.patch;
				const ends = [limb.nodes, ...limb.arms.map((arm) => arm.nodes)].map(
					(nodes) => nodes[nodes.length - 1],
				);
				for (const end of ends) {
					expect(end).toBeDefined();
					if (!end) continue;
					expect(inPlan(limb.patch, end.x, end.z)).toBeLessThanOrEqual(1 + 1e-6);
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

describe("the pine's frame against its photographs", () => {
	/** The metres a bough reaches from its socket to the outside of its foliage. */
	const bough = directed.pieces?.find((piece) => piece.name === growth.patch.sockets?.piece);
	const reach = (bough ? spreadMean(bough.stem.length) : 0) * 0.85;
	/**
	 * Still 01, the crown's width by height: each band's lower edge as a share of the height, and
	 * the outline's two sides there summed, in heights. The band from 0.45 is left out: the stills
	 * disagree on where the crown begins (0.459, 0.331 and 0.388 of the height).
	 */
	const WIDTHS: readonly (readonly [from: number, width: number])[] = [
		[0.5, 0.92],
		[0.55, 0.98],
		[0.6, 0.9],
		[0.65, 1.05],
		[0.7, 1.07],
		[0.75, 0.83],
		[0.8, 0.71],
		[0.85, 0.68],
		[0.9, 0.44],
		[0.95, 0.21],
	];
	/** The foliage's width in a band of heights seen from a turn, in heights. */
	const widthAt = (plan: ReturnType<typeof planConifer>, from: number, turn: number): number => {
		const angle = (turn * Math.PI) / 180;
		let low = 0;
		let high = 0;
		for (const socket of plan.sockets) {
			if ((socket.at[1] + reach) / plan.height < from) continue;
			if (socket.at[1] / plan.height >= from + 0.05) continue;
			const across = socket.at[0] * Math.cos(angle) + socket.at[2] * Math.sin(angle);
			low = Math.min(low, across - reach);
			high = Math.max(high, across + reach);
		}
		return (high - low) / plan.height;
	};

	it('holds 18 limbs: 2, 3, 3, 3 and 3 on five levels and 4 at the top', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			expect(plan.perLevel).toEqual([2, 3, 3, 3, 3]);
			expect(plan.limbs.filter((limb) => limb.top).length).toBe(4);
			expect(plan.limbs.length).toBe(18);
		}
	});

	/** Whether a plan is as wide at each height as still 01's outline, from four sides. */
	const holdsWidths = (plan: ReturnType<typeof planConifer>): void => {
		for (const [from, width] of WIDTHS) {
			let sum = 0;
			for (const turn of [0, 45, 90, 135]) {
				const built = widthAt(plan, from, turn);
				sum += built;
				// From any side a band is no narrower than six tenths of the photograph's and no
				// wider than a quarter of the height more.
				expect(built).toBeGreaterThanOrEqual(width * 0.6);
				expect(built).toBeLessThanOrEqual(width + 0.25);
			}
			// Over the four sides a band stands within a quarter of the height of the photograph's.
			expect(Math.abs(sum / 4 - width)).toBeLessThanOrEqual(0.25);
		}
	};
	/**
	 * The plants a page grows: eight seeds of the first variant, and the variants a kit grows at the
	 * High preset of the first seed. The variants known not to hold yet expect their failure, so
	 * each line goes once its plant holds: at variants 3 and 4 the band at 0.70 of the height reads
	 * 0.81 and 0.82 of the height over four sides against the photograph's 1.07.
	 */
	const GROWN = [
		...[11, 12, 13, 14, 15, 16, 17, 18].map((seed) => input(seed)),
		...Array.from({ length: VARIANTS_BY_PRESET.high - 1 }, (_, k) => input(11, k + 1)),
	];
	const WIDTHS_OPEN = new Set([3, 4]);
	for (const grown of GROWN)
		(grown.seed === 11 && WIDTHS_OPEN.has(grown.variant) ? it.failing : it)(
			`is as wide at each height as still 01's outline, from four sides, at seed ${grown.seed} variant ${grown.variant}`,
			() => holdsWidths(planConifer(grown)),
		);

	it('shares its foliage round the trunk: no eighth of the plan empty and no half heavy', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const eighths = new Array<number>(8).fill(0);
			for (const socket of plan.sockets) {
				const turn = Math.atan2(socket.at[2], socket.at[0]) / (2 * Math.PI);
				(eighths[Math.floor((((turn % 1) + 1) % 1) * 8) % 8] as number)++;
			}
			const even = plan.sockets.length / 8;
			for (const held of eighths) {
				expect(held).toBeGreaterThanOrEqual(even * 0.4);
				expect(held).toBeLessThanOrEqual(even * 1.6);
			}
			for (let first = 0; first < 8; first++) {
				let half = 0;
				for (let k = 0; k < 4; k++) half += eighths[(first + k) % 8] as number;
				expect(half).toBeLessThanOrEqual(plan.sockets.length * 0.6);
			}
		}
	});

	it('rises, runs and falls along every long limb, none of them straight', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			for (const limb of plan.limbs) {
				if (limb.top || limb.reach < 0.45 * plan.height) continue;
				const from = plan.trunk[limb.trunkNode];
				const last = limb.nodes[limb.nodes.length - 1];
				expect(from && last).toBeTruthy();
				if (!from || !last) continue;
				const highest = Math.max(...limb.nodes.map((node) => node.y));
				// Still 01's traced limb rises 0.06 of the height and falls 0.12; still 02's lowest
				// limbs fall about 0.04.
				const rise = (highest - from.y) / plan.height;
				const fall = (highest - last.y) / plan.height;
				expect(rise).toBeGreaterThanOrEqual(0.03);
				expect(rise).toBeLessThanOrEqual(0.08);
				expect(fall).toBeGreaterThanOrEqual(0.02);
				expect(fall).toBeLessThanOrEqual(0.12);
				// Its wood stands off the straight line from its foot to its end.
				const chord = [last.x - from.x, last.y - from.y, last.z - from.z];
				const length = Math.hypot(chord[0] as number, chord[1] as number, chord[2] as number);
				let off = 0;
				for (const node of limb.nodes) {
					const to = [node.x - from.x, node.y - from.y, node.z - from.z];
					const t =
						((to[0] as number) * (chord[0] as number) +
							(to[1] as number) * (chord[1] as number) +
							(to[2] as number) * (chord[2] as number)) /
						(length * length);
					off = Math.max(
						off,
						Math.hypot(
							(to[0] as number) - (chord[0] as number) * t,
							(to[1] as number) - (chord[1] as number) * t,
							(to[2] as number) - (chord[2] as number) * t,
						),
					);
				}
				expect(off / length).toBeGreaterThanOrEqual(0.05);
			}
		}
	});

	it('makes every long limb three to four tenths of the trunk where it leaves, and thinner past its collar', () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			for (const limb of plan.limbs) {
				if (limb.top || limb.reach < 0.45 * plan.height) continue;
				const from = plan.trunk[limb.trunkNode];
				expect(from).toBeDefined();
				if (!from) continue;
				/** The limb's radius over the trunk's, a share of the height out from the trunk's line. */
				const ratioAt = (out: number): number => {
					let best = limb.nodes[0];
					let least = Number.POSITIVE_INFINITY;
					for (const node of limb.nodes) {
						const off = Math.abs(Math.hypot(node.x - from.x, node.z - from.z) - out * plan.height);
						if (off < least) {
							least = off;
							best = node;
						}
					}
					return (best?.radius ?? 0) / from.radius;
				};
				// Still 01: 0.30 to 0.41 of the trunk's width at 0.06 of the height from its line,
				// and 0.26 and 0.24 at 0.15 and 0.20.
				expect(ratioAt(0.06)).toBeGreaterThanOrEqual(0.3);
				expect(ratioAt(0.06)).toBeLessThanOrEqual(0.41 + 0.005);
				expect(ratioAt(0.15)).toBeGreaterThanOrEqual(0.2);
				expect(ratioAt(0.15)).toBeLessThanOrEqual(0.3);
				expect(ratioAt(0.2)).toBeLessThan(ratioAt(0.06));
			}
		}
	});

	it("tops the crown with one pad over the trunk's line and the others lower round it", () => {
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const tops = plan.limbs.filter((limb) => limb.top);
			const [leader, ...others] = tops;
			expect(leader).toBeDefined();
			if (!leader) continue;
			const off = Math.hypot(leader.patch.centre[0], leader.patch.centre[2]);
			expect(off).toBeLessThanOrEqual(leader.patch.width / 2);
			for (const other of others) {
				expect(other.patch.centre[1]).toBeLessThan(leader.patch.centre[1]);
				expect(Math.hypot(other.patch.centre[0], other.patch.centre[2])).toBeGreaterThan(off);
			}
		}
	});

	it('lays each pad along the outer two thirds of its limb and leaves the inner third bare', () => {
		const pitch = growth.patch.sockets?.pitch ?? 0;
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			plan.patches.forEach((patch, index) => {
				const limb = plan.limbs[patch.limb];
				if (!limb || limb.top) return;
				const from = plan.trunk[limb.trunkNode];
				expect(from).toBeDefined();
				if (!from) return;
				// The pad runs from a third of the limb's reach to its far edge, and is no wider
				// than it is long.
				expect(patch.begins / limb.reach).toBeCloseTo(1 / 3, 6);
				expect(patch.length / limb.reach).toBeCloseTo(2 / 3, 6);
				expect(patch.width).toBeLessThanOrEqual(patch.length + 1e-9);
				// Its boughs stand between those two places, and reach both of them.
				const out = plan.sockets
					.filter((socket) => socket.patch === index)
					.map((socket) => Math.hypot(socket.at[0] - from.x, socket.at[2] - from.z));
				expect(Math.min(...out)).toBeGreaterThan(patch.begins);
				expect(Math.min(...out)).toBeLessThanOrEqual(patch.begins + reach + pitch);
				expect(Math.max(...out)).toBeLessThanOrEqual(limb.reach);
				expect(Math.max(...out)).toBeGreaterThanOrEqual(limb.reach - reach - pitch);
			});
		}
	});

	it('starts its foliage where picture 01 and the turning video start the crown', () => {
		// Picture 01 with its foot followed below the horizon: the crown starts at 0.465 of the
		// height. The turning video's bare bole is 0.45 to 0.53 of the height, median 0.466.
		for (const seed of SEEDS) {
			const plan = planConifer(input(seed));
			const lowest = Math.min(...plan.sockets.map((socket) => socket.at[1])) / plan.height;
			expect(Math.abs(lowest - 0.465)).toBeLessThanOrEqual(0.02);
			expect(Math.abs(plan.crownBase / plan.height - 0.465)).toBeLessThanOrEqual(0.02);
		}
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
				expect(inPlan(patch, first.at[0], first.at[2])).toBeLessThanOrEqual(1 + 1e-6);
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
				/** The height of the pad's floor at a place: it falls with the limb. */
				const floorAt = (x: number, z: number): number =>
					patch.centre[1] - patch.depth / 2 + patch.slope * laid(patch, x, z)[0];
				// No place on the pad's dome stands farther from a socket than a bough's reach and
				// one pitch.
				for (let turn = 0; turn < 24; turn++)
					for (let band = 0; band < 8; band++) {
						const t = (band + 0.5) / 8;
						const [x, z] = planAt(patch, Math.sqrt(1 - t * t), (turn / 24) * 2 * Math.PI);
						const place = [x, floorAt(x, z) + patch.depth * t, z];
						const nearest = Math.min(...own.map((socket) => apart(socket.at, place)));
						expect(nearest).toBeLessThanOrEqual(reach + pitch);
					}
				// A pad four metres wide or more is as deep for its width across its limb as the
				// record says, within a tenth, measured over the reach of the boughs on its twigs.
				if (patch.width < 4) return;
				/** A socket's height above the pad's floor under it. */
				const above = (socket: (typeof own)[number]): number =>
					socket.at[1] - floorAt(socket.at[0], socket.at[2]);
				const domed = own.filter((socket) => socket.twig >= 0);
				const top = Math.max(...domed.map(above));
				const rim = Math.max(
					...domed.map((socket) => Math.abs(laid(patch, socket.at[0], socket.at[2])[1])),
				);
				const built = (top + reach) / (2 * (rim + reach));
				expect(Math.abs(built - growth.patch.depth)).toBeLessThanOrEqual(growth.patch.depth * 0.1);
				// Its sockets stand through its depth: a fifth of them or more in each third.
				const thirds = [0, 0, 0];
				for (const socket of domed)
					(thirds[
						Math.min(2, Math.max(0, Math.floor((above(socket) / (top + 1e-9)) * 3)))
					] as number)++;
				for (const third of thirds) expect(third).toBeGreaterThanOrEqual(domed.length / 5);
			});
		}
	});

	it('gives its boughs many sizes and lifts, none below level and none past the lift', () => {
		const plan = planConifer(input(11));
		const sizes = plan.sockets.filter((socket) => socket.twig >= 0).map((socket) => socket.scale);
		expect(Math.min(...sizes)).toBeLessThan(0.85);
		expect(Math.max(...sizes)).toBeGreaterThan(1.15);
		// Each fifth of the range of sizes holds a tenth of the boughs or more.
		for (let fifth = 0; fifth < 5; fifth++) {
			const from = 0.8 + fifth * 0.08;
			const held = sizes.filter((size) => size >= from && size < from + 0.08).length;
			expect(held).toBeGreaterThanOrEqual(sizes.length / 10);
		}
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

describe("the Italian cypress's closed shell", () => {
	const shell = cypress.growth as Conifer;
	const rule = shell.patch.sockets;
	const pitch = rule?.pitch ?? 0;
	const names = typeof rule?.piece === 'string' ? [rule.piece] : (rule?.piece ?? []);
	const fan = cypress.pieces?.find((piece) => piece.name === names[0]);
	const fanLength = fan ? spreadMean(fan.stem.length) : 0;
	const [foot, crown] = [
		(shell.limbs.reach as readonly (readonly [number, number])[])[0]?.[0] ?? 0,
		(shell.limbs.reach as readonly (readonly [number, number])[]).at(-1)?.[0] ?? 1,
	];
	const plans = SEEDS.map((seed) =>
		planConifer({ record: cypress, seed, variant: 0, season: 'summer' }),
	);
	/** The plant's drawn height: the leader's tip patch stands half its depth over the trunk's end. */
	const heightOf = (plan: (typeof plans)[number]): number =>
		(plan.trunk.at(-1)?.y ?? 0) / (1 - (shell.patch.width[1] * shell.patch.depth) / 2);
	/** The outline's metres from the trunk's line on its wide side at a height. */
	const outline = (plan: (typeof plans)[number], y: number): number =>
		curveAt(shell.limbs.reach, y / heightOf(plan)) * heightOf(plan);
	const flat = (at: readonly number[]): number => Math.hypot(at[0] as number, at[2] as number);

	it('passes the record check and stands every socket just inside the outline, from its foot to its top', () => {
		expect(speciesProblems(cypress)).toEqual([]);
		for (const plan of plans) {
			const H = heightOf(plan);
			for (const socket of plan.sockets) {
				if (socket.limb < 0) continue;
				const y = socket.at[1];
				expect(y).toBeGreaterThanOrEqual(foot * H - 1e-6);
				expect(y).toBeLessThanOrEqual(crown * H + 1e-6);
				// Within the outline, and no deeper than a fifth of a fan inside its narrow side.
				const r = flat(socket.at);
				expect(r).toBeLessThanOrEqual(outline(plan, y) + 0.002 * H);
				expect(r).toBeGreaterThanOrEqual(
					Math.min(
						shell.limbs.plan.narrow * outline(plan, y) - 0.2 * fanLength,
						0.3 * outline(plan, y),
					) -
						0.002 * H,
				);
			}
		}
	});

	it('leaves no gap round the column wider than two pitches, at every height', () => {
		for (const plan of plans) {
			const H = heightOf(plan);
			for (let band = 0.02; band < 0.9; band += 0.05) {
				const turns = plan.sockets
					.filter((s) => s.at[1] >= band * H && s.at[1] < (band + 0.05) * H)
					.map((s) => Math.atan2(s.at[2], s.at[0]))
					.sort((a, b) => a - b);
				expect(turns.length).toBeGreaterThan(3);
				let widest = 2 * Math.PI - ((turns.at(-1) as number) - (turns[0] as number));
				for (let k = 1; k < turns.length; k++)
					widest = Math.max(widest, (turns[k] as number) - (turns[k - 1] as number));
				const radius = outline(plan, (band + 0.025) * H);
				expect(widest * radius).toBeLessThanOrEqual(2 * pitch);
			}
		}
	});

	it('stands every fan up the shell, leaning out where the column does not narrow, never plumb', () => {
		for (const plan of plans) {
			const H = heightOf(plan);
			for (const socket of plan.sockets) {
				if (socket.limb < 0) continue;
				const [hx, hy, hz] = socket.heading;
				// Where the outline tucks in to the stem, its fans stand up the tuck at the most lean.
				expect(hy).toBeGreaterThanOrEqual(Math.cos((30 * Math.PI) / 180) - 1e-9);
				expect(Math.hypot(hx, hz)).toBeGreaterThan(Math.sin((1.9 * Math.PI) / 180));
				if (socket.at[1] < 0.75 * H)
					expect(hx * socket.at[0] + hz * socket.at[2]).toBeGreaterThan(0);
			}
		}
	});

	it('shares its sockets between the plume and the forked plume, each a fair share of them', () => {
		const places = names.map((name) => cypress.pieces?.findIndex((piece) => piece.name === name));
		expect(places.length).toBe(2);
		for (const plan of plans) {
			const counts = places.map(
				(place) => plan.sockets.filter((socket) => socket.piece === place).length,
			);
			expect(counts.reduce((sum, count) => sum + count, 0)).toBe(plan.sockets.length);
			for (const count of counts) expect(count / plan.sockets.length).toBeGreaterThan(0.4);
		}
		const skeleton = growConifer({ record: cypress, seed: 11, variant: 0, season: 'summer' });
		expect(skeleton.buds.sockets?.piece).toBeDefined();
	});

	it('keeps every fan inside the outline from its socket to its tip, shortening it where the top closes', () => {
		for (const plan of plans) {
			const H = heightOf(plan);
			let shortened = 0;
			for (const socket of plan.sockets) {
				const reach = fanLength * socket.scale;
				const tip = [0, 1, 2].map(
					(k) => (socket.at[k] as number) + (socket.heading[k] as number) * reach,
				);
				const tipY = tip[1] as number;
				const within = tipY <= crown * H && flat(tip) <= outline(plan, tipY) + 0.002 * H;
				// The least a fan shrinks to is three tenths of its own size.
				if (!within) expect(socket.scale).toBeCloseTo(0.3, 6);
				if (socket.scale < 0.8) shortened++;
			}
			// The top rows shorten; the column below keeps its fans' sizes.
			expect(shortened).toBeGreaterThan(0);
			expect(shortened / plan.sockets.length).toBeLessThan(0.15);
		}
	});

	it("carries no fan on the leader's tip, where the top rows close the column", () => {
		for (const plan of plans) {
			expect(plan.sockets.filter((socket) => socket.limb < 0)).toHaveLength(0);
			const top = Math.max(...plan.sockets.map((socket) => socket.at[1]));
			expect(top).toBeGreaterThan(0.95 * heightOf(plan));
		}
	});

	it('feeds every fan from a bough that rises to end inside the outline, each bough a share of them', () => {
		for (const plan of plans) {
			const fed = new Array<number>(plan.limbs.length).fill(0);
			for (const socket of plan.sockets) if (socket.limb >= 0) (fed[socket.limb] as number)++;
			expect(Math.min(...fed)).toBeGreaterThan(0);
			// The busiest bough feeds a few times the median's share.
			const sorted = [...fed].sort((a, b) => a - b);
			expect(Math.max(...fed)).toBeLessThanOrEqual(5 * (sorted[sorted.length >> 1] as number));
			for (const limb of plan.limbs) {
				const end = limb.nodes.at(-1) as (typeof limb.nodes)[number];
				const seat = plan.trunk[limb.trunkNode] as (typeof plan.trunk)[number];
				expect(end.y).toBeGreaterThan(seat.y);
				expect(flat([end.x, end.y, end.z])).toBeLessThan(outline(plan, end.y));
			}
		}
	});

	it("stands its inner body on the trunk's line at its share of the outline, as wood joined to nothing", () => {
		const body = shell.body?.radius as readonly (readonly [number, number])[];
		// The body's share of the outline above its foot, where it tucks in to the trunk.
		const above = body[1]?.[0] ?? 0;
		const share = (body[1]?.[1] ?? 0) / (curveAt(shell.limbs.reach, above) || 1);
		for (const [seed, plan] of plans.entries()) {
			const H = heightOf(plan);
			expect(plan.body.length).toBeGreaterThan(2);
			expect((plan.body[0]?.y ?? 0) / H).toBeCloseTo(body[0]?.[0] ?? 0, 4);
			expect((plan.body.at(-1)?.y ?? 0) / H).toBeCloseTo(body.at(-1)?.[0] ?? 0, 4);
			for (const node of plan.body)
				if (node.y >= above * H) expect(node.radius).toBeCloseTo(share * outline(plan, node.y), 3);
				else expect(node.radius).toBeLessThanOrEqual(share * outline(plan, node.y));
			// At the foliage's foot the body is no wider than the trunk there.
			expect(plan.body[0]?.radius ?? 0).toBeLessThanOrEqual((plan.trunk[0]?.radius ?? 0) * 1.1);
			const skeleton = growConifer({
				record: cypress,
				seed: SEEDS[seed] as number,
				variant: 0,
				season: 'summer',
			});
			const loose = [];
			for (let a = 0; a < skeleton.axes.count; a++)
				if (
					(skeleton.axes.parent[a] as number) < 0 &&
					(skeleton.axes.kind[a] as number) !== AXIS_STEM
				)
					loose.push(a);
			expect(loose).toHaveLength(1);
			const axis = loose[0] as number;
			expect(skeleton.axes.order[axis]).toBe(1);
			expect((skeleton.axes.last[axis] as number) - (skeleton.axes.first[axis] as number) + 1).toBe(
				plan.body.length,
			);
		}
	});

	it('draws its inner body all round the trunk in the wood of the near form and of both card levels', async () => {
		await loadPlantCode(cypressModule.record);
		const kit = buildKitNow(cypressModule, { detail: 'high', placeholders: 'missing' });
		const asset = growPlantNow(kit, { seed: 11, variant: 0, season: 'summer', near: true });
		const plan = planConifer({
			record: cypressModule.record,
			seed: 11,
			variant: 0,
			season: 'summer',
		});
		// The grown plant is scaled so its drawn top stands at the record's height.
		const scale = asset.skeleton.height / plan.height;
		const middle = plan.body[plan.body.length >> 1] as (typeof plan.body)[number];
		const { min, max } = kit.box;
		for (const level of [0, 1, 2] as const) {
			const wood = asset.levels[level].parts.find((part) => part.name === 'wood');
			expect(wood).toBeDefined();
			if (!wood) continue;
			const raw = wood.arrays.positions;
			const turns: number[] = [];
			for (let v = 0; v < raw.length / 3; v++) {
				const x = min[0] + (raw[v * 3] as number) * ((max[0] - min[0]) / 65535);
				const y = min[1] + (raw[v * 3 + 1] as number) * ((max[1] - min[1]) / 65535);
				const z = min[2] + (raw[v * 3 + 2] as number) * ((max[2] - min[2]) / 65535);
				if (Math.abs(y - middle.y * scale) > 0.5) continue;
				if (Math.abs(Math.hypot(x, z) - middle.radius * scale) > 0.1 * middle.radius * scale)
					continue;
				turns.push(Math.atan2(z, x));
			}
			// A closed tube of at least five sides: no two of its points stand more than a fifth of a
			// turn apart round the trunk.
			turns.sort((a, b) => a - b);
			expect(turns.length).toBeGreaterThan(4);
			let widest = 2 * Math.PI - ((turns.at(-1) as number) - (turns[0] as number));
			for (let k = 1; k < turns.length; k++)
				widest = Math.max(widest, (turns[k] as number) - (turns[k - 1] as number));
			expect(widest).toBeLessThanOrEqual((2 * Math.PI) / 5);
		}
	}, 120_000);
});
