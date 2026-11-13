// The self-organizing grower on the pedunculate oak: it fills the envelope measured from the oak's
// reference turntable from every side, grows the same bytes on this thread and in a worker, grows
// at least three macro orders with a clean bole, fits its stem to the oak's diameter, gives its bud
// sites resource and light, and turns from one leader to a spreading crown as λ falls.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { speciesProblems } from '../core/check';
import {
	AXIS_STEM,
	BUD_TERMINAL,
	type MacroSkeleton,
	NODE_STUB,
	skeletonBuffers,
} from '../core/graph';
import { hashAt, hashBytes, unitAt } from '../core/hash';
import type { Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import {
	envelopeSilhouette,
	envelopeVolume,
	flooredVolume,
	insetVolume,
	silhouetteFrame,
	silhouetteIoU,
	skeletonSilhouette,
} from './envelope';
import { oakRecord } from './oak.fixture';
import { species } from './oak-self-organizing.fixture';
import { girthOf, growSelfOrganizing, shootReach } from './self-organizing';
import { stemStarts } from './stems';

/** A hash of every array a skeleton holds. */
function digest(skeleton: MacroSkeleton): number {
	let hash = hashAt(skeleton.nodeCount, skeleton.axes.count, skeleton.buds.count);
	for (const buffer of skeletonBuffers(skeleton)) hash = hashBytes(new Uint8Array(buffer), hash);
	return hash;
}

/** The oak grown for a seed and a variant. */
function grow(variant: number, record: Species = oakRecord, seed = 11): MacroSkeleton {
	return growSelfOrganizing({ record, seed, variant, season: 'summer' });
}

/** The IoU of a grown skeleton's silhouette with its envelope's at eight turns. */
function envelopeFit(skeleton: MacroSkeleton, variant: number, seed = 11): number[] {
	const salt = oakRecord.seedSalt >>> 0;
	const height = spreadAt(oakRecord.size.height, unitAt(seed, salt, variant, 1));
	const turn = unitAt(seed, salt, variant, 2) * 2 * Math.PI;
	const volume = envelopeVolume(
		oakRecord.envelope as NonNullable<Species['envelope']>,
		height,
		turn,
	);
	const frame = silhouetteFrame(volume, height);
	const reach = shootReach(oakRecord);
	const perMetre = curveAt(oakRecord.shoots?.placement.perMetre ?? 0, 0.5);
	const fit: number[] = [];
	for (let k = 0; k < 8; k++) {
		const view = (k * Math.PI) / 4;
		fit.push(
			silhouetteIoU(
				skeletonSilhouette(skeleton, view, frame, reach, perMetre),
				envelopeSilhouette(volume, view, frame, skeleton.radius[0] as number),
			),
		);
	}
	return fit;
}

/**
 * The number of separate pieces a grown plant's silhouette makes at one turn, each piece a run of
 * touching cells: one for a crown that hangs together.
 */
function silhouettePieces(skeleton: MacroSkeleton, variant = 0): number {
	const record = species.record;
	const height = spreadAt(record.size.height, unitAt(11, record.seedSalt >>> 0, variant, 1));
	const turn = unitAt(11, record.seedSalt >>> 0, variant, 2) * 2 * Math.PI;
	const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
	const volume = insetVolume(
		flooredVolume(
			envelopeVolume(record.envelope as NonNullable<Species['envelope']>, height, turn),
			(growth.floor ?? 0) * height,
		),
		shootReach(record),
	);
	const frame = silhouetteFrame(volume, height);
	const mask = skeletonSilhouette(
		skeleton,
		0,
		frame,
		shootReach(record),
		curveAt(record.shoots?.placement.perMetre ?? 0, 0.5),
	);
	const seen = new Uint8Array(mask.length);
	const stack: number[] = [];
	let pieces = 0;
	for (let k = 0; k < mask.length; k++) {
		if (!mask[k] || seen[k]) continue;
		pieces++;
		seen[k] = 1;
		stack.push(k);
		while (stack.length > 0) {
			const cell = stack.pop() as number;
			const col = cell % frame.cols;
			const row = (cell / frame.cols) | 0;
			for (const next of [
				col > 0 ? cell - 1 : -1,
				col + 1 < frame.cols ? cell + 1 : -1,
				row > 0 ? cell - frame.cols : -1,
				row + 1 < frame.rows ? cell + frame.cols : -1,
			])
				if (next >= 0 && mask[next] && !seen[next]) {
					seen[next] = 1;
					stack.push(next);
				}
		}
	}
	return pieces;
}

/** Node pairs on different axes that stand within the distance the clearance demands. */
function nearByKind(skeleton: MacroSkeleton, clearance: number): { fine: number; thick: number } {
	const near = { fine: 0, thick: 0 };
	for (let a = 0; a < skeleton.nodeCount; a++)
		for (let b = a + 1; b < skeleton.nodeCount; b++) {
			const ax = skeleton.axisOf[a] as number;
			const bx = skeleton.axisOf[b] as number;
			if (ax === bx) continue;
			if ((skeleton.axes.parent[bx] as number) === ax) continue;
			if ((skeleton.axes.parent[ax] as number) === bx) continue;
			const oa = skeleton.axes.order[ax] as number;
			const ob = skeleton.axes.order[bx] as number;
			const apart = clearance * (girthOf(oa) + girthOf(ob));
			const dx = (skeleton.position[a * 3] as number) - (skeleton.position[b * 3] as number);
			const dy =
				(skeleton.position[a * 3 + 1] as number) - (skeleton.position[b * 3 + 1] as number);
			const dz =
				(skeleton.position[a * 3 + 2] as number) - (skeleton.position[b * 3 + 2] as number);
			if (dx * dx + dy * dy + dz * dz < apart * apart) {
				// Both axes a branch or finer, or one of them the trunk or a great limb.
				if (oa >= 2 && ob >= 2) near.fine++;
				else near.thick++;
			}
		}
	return near;
}

/** Node pairs on different axes that stand within the distance the clearance demands. */
function nearPairs(skeleton: MacroSkeleton, clearance: number): number {
	const near = nearByKind(skeleton, clearance);
	return near.fine + near.thick;
}

/**
 * Checks that the only axes without a parent are the plant's stems, each standing on the ground,
 * and that every other axis leaves a node of its parent and has a chain of parents to a stem.
 */
function hangsOnStems(skeleton: MacroSkeleton, stems: number): void {
	const { axes } = skeleton;
	let roots = 0;
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		if (axes.kind[a] === AXIS_STEM || parent < 0) {
			roots++;
			expect(axes.kind[a]).toBe(AXIS_STEM);
			expect(parent).toBe(-1);
			expect(skeleton.position[(axes.first[a] as number) * 3 + 1]).toBe(0);
			continue;
		}
		expect(parent).toBeLessThan(a);
		expect(skeleton.axisOf[axes.parentNode[a] as number]).toBe(parent);
		let root = a;
		while ((axes.parent[root] as number) >= 0) root = axes.parent[root] as number;
		expect(axes.kind[root]).toBe(AXIS_STEM);
	}
	expect(roots).toBe(stems);
}

const oaks = [0, 1, 2].map((variant) => grow(variant));

describe('the self-organizing oak', () => {
	it('fills its envelope from eight sides, IoU 0.85 or better, in every variant', () => {
		oaks.forEach((oak, variant) => {
			for (const iou of envelopeFit(oak, variant)) expect(iou).toBeGreaterThanOrEqual(0.85);
		});
	});

	it('stops a shoot that would pass within the clearance of another axis', () => {
		const grow = (clearance?: number): MacroSkeleton => {
			const record: Species =
				clearance === undefined
					? oakRecord
					: {
							...oakRecord,
							growth: { ...oakRecord.growth, clearance } as typeof oakRecord.growth,
						};
			return growSelfOrganizing({ record, seed: 11, variant: 0, season: 'summer' });
		};
		// Pairs of nodes on different axes that stand within the distance the clearance demands of
		// them, less the joint where a branch meets the wood it leaves.
		const CLEARANCE = 2;
		const strangers = (skeleton: MacroSkeleton): number => {
			let near = 0;
			for (let a = 0; a < skeleton.nodeCount; a++)
				for (let b = a + 1; b < skeleton.nodeCount; b++) {
					const ax = skeleton.axisOf[a] as number;
					const bx = skeleton.axisOf[b] as number;
					if (ax === bx) continue;
					if ((skeleton.axes.parent[bx] as number) === ax) continue;
					if ((skeleton.axes.parent[ax] as number) === bx) continue;
					const apart =
						CLEARANCE *
						(girthOf(skeleton.axes.order[ax] as number) +
							girthOf(skeleton.axes.order[bx] as number));
					const dx = (skeleton.position[a * 3] as number) - (skeleton.position[b * 3] as number);
					const dy =
						(skeleton.position[a * 3 + 1] as number) - (skeleton.position[b * 3 + 1] as number);
					const dz =
						(skeleton.position[a * 3 + 2] as number) - (skeleton.position[b * 3 + 2] as number);
					// Wood standing inside the clearance its own girth and the other's demand.
					if (dx * dx + dy * dy + dz * dz < apart * apart) near++;
				}
			return near;
		};
		// Without the field the plant grows as before; with it, shoots stop at the clearance, so the
		// wood that stands too near another axis's falls away by orders of magnitude. A few pairs
		// survive round a fork, where several limbs leave one node.
		const open = grow();
		const apart = grow(CLEARANCE);
		expect(apart.nodeCount).toBeGreaterThan(0);
		// With the clearance wider than half a metre for every order, the only pairs that stand within
		// half a metre are those round a fork, where several limbs leave one node.
		expect(strangers(apart)).toBeLessThan(open.nodeCount * 0.01);
		expect(strangers(apart) * 8).toBeLessThan(strangers(open));
	});

	it(
		'turns a shoot aside to keep its clearance',
		() => {
			const record = species.record;
			const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
			// The turning rule alone: the species' own thickness floor would keep some clearances.
			const shaped = (turning?: number): Species => ({
				...record,
				growth: { ...growth, clearance: 0.5, turning: turning ?? 0, clearanceThickness: 0 },
			});
			const stopped = grow(0, shaped());
			const turned = grow(0, shaped(30));
			// The heading is chosen by a fixed fan, not a random draw: the same seed grows the same bytes.
			expect(digest(grow(0, shaped(30)))).toBe(digest(turned));
			// A turning with no clearance to keep changes nothing.
			const open = (turning: number): Species => ({
				...record,
				growth: { ...growth, clearance: 0, turning, clearanceThickness: 0 },
			});
			expect(digest(grow(0, open(30)))).toBe(digest(grow(0, open(0))));
			// A shoot that stops leaves wood inside the clearance that another axis demands; a shoot
			// that turns aside keeps it.
			expect(nearPairs(stopped, 0.5)).toBeGreaterThan(0);
			// The turned wood keeps the clearance too: no more than a fiftieth of its nodes stand within
			// the distance another axis's wood demands.
			expect(nearPairs(turned, 0.5)).toBeLessThan(turned.nodeCount * 0.02);
		},
		scaledBudget(90_000),
	);

	it(
		'keeps the clearance only for wood above the record thickness',
		() => {
			const record = species.record;
			const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
			// The rule alone is judged here, without the probe record's great-limb bud share.
			const buds = { ...growth.buds, limbBuds: undefined };
			// The record's adopted stub rule is off here: this test judges the clearance alone.
			const shedding = { ...growth.shedding, stubs: 0.2 };
			const shaped = (clearanceThickness: number): Species => ({
				...record,
				growth: { ...growth, buds, shedding, clearance: 0.3, turning: 30, clearanceThickness },
			});
			// A floor above the great limbs' share leaves no other wood thick enough to block, so the
			// plant grows exactly as a record without the rule does.
			const plain: Species = {
				...record,
				growth: {
					...growth,
					buds,
					shedding,
					clearance: undefined,
					turning: undefined,
					clearanceThickness: undefined,
				},
			};
			expect(digest(grow(0, shaped(0.7)))).toBe(digest(grow(0, plain)));
			const all = grow(0, shaped(0));
			const thick = grow(0, shaped(0.5));
			// Fine twigs keep their own layout: more fine pairs stand inside the distance.
			expect(nearByKind(thick, 0.3).fine).toBeGreaterThan(nearByKind(all, 0.3).fine);
			// A great limb still keeps clear of another.
			expect(nearByKind(thick, 0.3).thick).toBeLessThan(nearByKind(all, 0.3).thick);
			// The same seed grows the same bytes with the field set.
			expect(digest(grow(0, shaped(0.5)))).toBe(digest(thick));
		},
		scaledBudget(90_000),
	);

	it('grows the same bytes twice, and other bytes for another variant or seed', () => {
		const first = oaks[0] as MacroSkeleton;
		expect(digest(grow(0))).toBe(digest(first));
		expect(digest(oaks[1] as MacroSkeleton)).not.toBe(digest(first));
		expect(digest(grow(0, oakRecord, 12))).not.toBe(digest(first));
	});

	it('grows the same bytes in a worker', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'self-organizing-'));
		try {
			const script = join(dir, 'worker.ts');
			writeFileSync(
				script,
				`import { growSelfOrganizing } from ${JSON.stringify(join(import.meta.dirname, 'self-organizing.ts'))};
import { oakRecord } from ${JSON.stringify(join(import.meta.dirname, 'oak.fixture.ts'))};
import { skeletonBuffers } from ${JSON.stringify(join(import.meta.dirname, '../core/graph.ts'))};
self.onmessage = () => {
	const skeleton = growSelfOrganizing({ record: oakRecord, seed: 11, variant: 0, season: 'summer' });
	postMessage(skeleton, skeletonBuffers(skeleton));
};
`,
			);
			const worker = new Worker(script);
			const grown = await new Promise<MacroSkeleton>((resolve, reject) => {
				worker.onmessage = (event) => resolve(event.data as MacroSkeleton);
				worker.onerror = (event) => reject(new Error(String(event.message)));
				worker.postMessage(0);
			});
			worker.terminate();
			expect(digest(grown)).toBe(digest(oaks[0] as MacroSkeleton));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('grows at least three macro orders, axes in node order, from a clean bole', () => {
		for (const oak of oaks) {
			const orders = new Set(oak.axes.order);
			expect(orders.size).toBeGreaterThanOrEqual(3);
			const { axes } = oak;
			for (let a = 0; a < axes.count; a++) {
				const first = axes.first[a] as number;
				const last = axes.last[a] as number;
				expect(last).toBeGreaterThanOrEqual(first);
				for (let n = first + 1; n <= last; n++) expect(oak.parent[n]).toBe(n - 1);
				expect(oak.axisOf[first]).toBe(a);
				const from = axes.parentNode[a] as number;
				if (a === 0) expect(from).toBe(-1);
				else expect(oak.parent[first]).toBe(from);
			}
			// No limb leaves the stem below the clean bole.
			const bole =
				oakRecord.growth.model === 'self-organizing' ? oakRecord.growth.shedding.cleanBole : 0;
			for (let a = 1; a < axes.count; a++) {
				const from = axes.parentNode[a] as number;
				if (axes.parent[a] !== 0 || (oak.flags[axes.first[a] as number] as number) & NODE_STUB)
					continue;
				expect(oak.position[from * 3 + 1] as number).toBeGreaterThanOrEqual(
					bole * 0.9 * oak.height,
				);
			}
		}
	});

	// The oaks of seed 11 are the file's own; two more seeds grow six more, about 3 s of one idle core.
	it(
		'hangs every branch on a parent whose chain reaches a stem, at every seed and variant',
		() => {
			const growth = oakRecord.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
			for (const seed of [11, 3, 42]) {
				for (const variant of [0, 1, 2]) {
					const oak =
						seed === 11 ? (oaks[variant] as MacroSkeleton) : grow(variant, oakRecord, seed);
					const stems = stemStarts(growth.stems, seed, oakRecord.seedSalt >>> 0, variant).length;
					hangsOnStems(oak, stems);
				}
			}
		},
		scaledBudget(30_000),
	);

	it("fits its stem to the oak's diameter and thins to the twig's radius", () => {
		const dbh = oakRecord.size.dbh as number;
		for (const oak of oaks) {
			const { first, last } = oak.axes;
			let at = first[0] as number;
			while (at < (last[0] as number) && (oak.position[(at + 1) * 3 + 1] as number) < 1.3) at++;
			expect(oak.radius[at] as number).toBeGreaterThan(dbh / 2 - 0.05);
			expect(oak.radius[at] as number).toBeLessThan(dbh / 2 + 0.05);
			let thinnest = Number.POSITIVE_INFINITY;
			for (const r of oak.radius) thinnest = Math.min(thinnest, r);
			expect(thinnest).toBeGreaterThanOrEqual(0.004 - 1e-9);
			// Radii never grow toward a tip.
			for (let n = 0; n < oak.nodeCount; n++) {
				const p = oak.parent[n] as number;
				if (p >= 0)
					expect(oak.radius[n] as number).toBeLessThanOrEqual((oak.radius[p] as number) + 1e-6);
			}
		}
	});

	it('gives its bud sites resource and light, on the bark of their wood', () => {
		for (const oak of oaks) {
			const { buds } = oak;
			expect(buds.count).toBeGreaterThan(2000);
			let strong = 0;
			let terminal = 0;
			for (let b = 0; b < buds.count; b++) {
				const vigor = buds.vigor[b] as number;
				const light = buds.light[b] as number;
				expect(vigor).toBeGreaterThanOrEqual(0);
				expect(vigor).toBeLessThanOrEqual(1);
				expect(light).toBeGreaterThanOrEqual(0);
				expect(light).toBeLessThanOrEqual(1);
				if (vigor > 0.5) strong++;
				if (buds.kind[b] === BUD_TERMINAL) terminal++;
				const q = buds.frame.subarray(b * 4, b * 4 + 4);
				expect(
					Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number),
				).toBeCloseTo(1, 4);
				expect(oak.axisOf[buds.node[b] as number]).toBe(buds.axis[b] as number);
				expect(buds.woodRadius[b]).toBe(oak.radius[buds.node[b] as number] as number);
			}
			expect(strong).toBeGreaterThan(buds.count * 0.05);
			expect(strong).toBeLessThan(buds.count * 0.95);
			expect(terminal).toBeGreaterThan(100);
		}
	});

	it('keeps a share of the great limbs’ lateral buds as buds when the record asks', () => {
		const grown = species.record;
		const growth = grown.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		// The record's own bud share is off here, so both arms start from the same crown.
		const base: Species = {
			...grown,
			growth: { ...growth, buds: { ...growth.buds, limbBuds: undefined } },
		};
		const withShare = (limbBuds: number | undefined): Species =>
			({
				...base,
				growth: { ...growth, buds: { ...growth.buds, limbBuds } },
			}) as Species;
		const lateralsOnLimbs = (oak: MacroSkeleton) => {
			let count = 0;
			for (let b = 0; b < oak.buds.count; b++) {
				if (oak.buds.kind[b] === BUD_TERMINAL) continue;
				if ((oak.axes.order[oak.buds.axis[b] as number] as number) === 1) count++;
			}
			return count;
		};
		// Absent, the growth is the record's own, byte for byte.
		expect(digest(grow(0, withShare(undefined)))).toBe(digest(grow(0, base)));
		const plain = grow(0, base);
		const budded = grow(0, withShare(0.6));
		// The great limbs keep lateral buds along their own length, which carry the shoots there.
		expect(lateralsOnLimbs(budded)).toBeGreaterThan(lateralsOnLimbs(plain));
		// Keeping buds restructures the crown, so its growth is not the record's own.
		expect(digest(budded)).not.toBe(digest(plain));
	});

	it('holds a step’s turn and a great limb’s azimuth when the record asks', () => {
		const record = species.record;
		const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		// The fields are off here, so both arms start from the record's crown without them.
		const base: Species = {
			...record,
			growth: { ...growth, maxTurn: undefined, limbAzimuth: undefined },
		};
		const withRules = (maxTurn: number | undefined, limbAzimuth: number | undefined): Species =>
			({ ...base, growth: { ...growth, maxTurn, limbAzimuth } }) as Species;
		// Absent, the growth is the base record's own, byte for byte.
		expect(digest(grow(0, withRules(undefined, undefined)))).toBe(digest(grow(0, base)));
		// The turn between one internode and the next, as the drawn wood shows it.
		const turns = (oak: MacroSkeleton) => {
			const out: number[] = [];
			for (let a = 0; a < oak.axes.count; a++) {
				const first = oak.axes.first[a] as number;
				const last = oak.axes.last[a] as number;
				for (let n = first; n + 2 <= last; n++) {
					const x0 = oak.position[n * 3] as number;
					const y0 = oak.position[n * 3 + 1] as number;
					const z0 = oak.position[n * 3 + 2] as number;
					const x1 = oak.position[(n + 1) * 3] as number;
					const y1 = oak.position[(n + 1) * 3 + 1] as number;
					const z1 = oak.position[(n + 1) * 3 + 2] as number;
					const x2 = oak.position[(n + 2) * 3] as number;
					const y2 = oak.position[(n + 2) * 3 + 1] as number;
					const z2 = oak.position[(n + 2) * 3 + 2] as number;
					const ax = x1 - x0;
					const ay = y1 - y0;
					const az = z1 - z0;
					const bx = x2 - x1;
					const by = y2 - y1;
					const bz = z2 - z1;
					const la = Math.hypot(ax, ay, az);
					const lb = Math.hypot(bx, by, bz);
					if (la < 1e-6 || lb < 1e-6) continue;
					const dot = (ax * bx + ay * by + az * bz) / (la * lb);
					out.push((Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI);
				}
			}
			return out;
		};
		const sharp = (oak: MacroSkeleton) =>
			turns(oak).filter((t) => t > 6).length / Math.max(1, turns(oak).length);
		// A turn limit cuts the sharp joints; the wood bends in smaller steps instead.
		expect(sharp(grow(0, withRules(6, undefined)))).toBeLessThan(sharp(grow(0, base)));
		// The grip turns every order-1 step toward its fork azimuth, so it changes those axes' growth
		// while the rest of the tree's rules stay as they are.
		expect(digest(grow(0, withRules(undefined, 1)))).not.toBe(digest(grow(0, base)));
	});

	it('parts the laterals along a parent when the record asks', () => {
		const record = species.record;
		const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		// The field is off here, so both arms start from the record's crown without it.
		const base: Species = { ...record, growth: { ...growth, lateralSpacing: undefined } };
		const withSpacing = (lateralSpacing: number | undefined): Species =>
			({ ...base, growth: { ...growth, lateralSpacing } }) as Species;
		// Absent, the growth is the base record's own, byte for byte.
		expect(digest(grow(0, withSpacing(undefined)))).toBe(digest(grow(0, base)));
		// The laterals on one parent stand at least the record's distance apart where they can.
		const nearestGap = (oak: MacroSkeleton) => {
			const along = new Float64Array(oak.nodeCount);
			for (let a = 0; a < oak.axes.count; a++) {
				const first = oak.axes.first[a] as number;
				const last = oak.axes.last[a] as number;
				for (let n = first; n < last; n++)
					along[n + 1] =
						(along[n] as number) +
						Math.hypot(
							(oak.position[(n + 1) * 3] as number) - (oak.position[n * 3] as number),
							(oak.position[(n + 1) * 3 + 1] as number) - (oak.position[n * 3 + 1] as number),
							(oak.position[(n + 1) * 3 + 2] as number) - (oak.position[n * 3 + 2] as number),
						);
			}
			const childrenOf = new Map<number, number[]>();
			for (let a = 0; a < oak.axes.count; a++) {
				const parentAxis = oak.axes.parent[a] as number;
				if (parentAxis < 0 || (oak.axes.order[parentAxis] as number) < 1) continue;
				const from = oak.axes.parentNode[a] as number;
				const list = childrenOf.get(parentAxis) ?? [];
				list.push(along[from] as number);
				childrenOf.set(parentAxis, list);
			}
			let sum = 0;
			let pairs = 0;
			for (const list of childrenOf.values()) {
				list.sort((x, y) => x - y);
				for (let i = 1; i < list.length; i++) {
					sum += (list[i] as number) - (list[i - 1] as number);
					pairs++;
				}
			}
			return sum / Math.max(1, pairs);
		};
		expect(nearestGap(grow(0, withSpacing(0.6)))).toBeGreaterThan(nearestGap(grow(0, base)));
	});

	it("gives the real oak's surface buds a share of the last resource by their site's light", () => {
		const record = species.record;
		const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		const dark: Species = {
			...record,
			growth: { ...growth, light: { ...growth.light, surface: undefined } },
		};
		const lit: Species = {
			...record,
			growth: { ...growth, light: { ...growth.light, surface: true } },
		};
		for (const variant of [0, 3]) {
			const a = grow(variant, dark);
			const b = grow(variant, lit);
			// The wood grows the same: the share is given only once the last season has grown.
			expect(Array.from(b.position)).toEqual(Array.from(a.position));
			// The terminal buds the envelope stopped took no share before; they take one now.
			const starved = (oak: MacroSkeleton) => {
				let count = 0;
				for (let k = 0; k < oak.buds.count; k++)
					if (oak.buds.kind[k] === BUD_TERMINAL && (oak.buds.vigor[k] as number) === 0) count++;
				return count;
			};
			expect(starved(a)).toBeGreaterThan(50);
			expect(starved(b)).toBeLessThan(starved(a) * 0.2);
		}
	});

	it("weighs the real oak's wood at its record's girth, so the drawn trunk width leaves the crown", () => {
		const record = species.record;
		const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		const drawn = (dbh: number, girth: number | undefined): Species => ({
			...record,
			size: { ...record.size, dbh },
			growth: { ...growth, bending: { ...growth.bending, girth } },
		});
		const trunk = (oak: MacroSkeleton) => oak.radius[oak.axes.first[0] as number] as number;
		for (const variant of [0, 1]) {
			const slim = grow(variant, drawn(2, 3.5));
			const stout = grow(variant, drawn(3, 3.5));
			// The same wood, in the same place, drawn at two widths.
			expect(slim.nodeCount).toBe(stout.nodeCount);
			expect(slim.position).toEqual(stout.position);
			expect(trunk(stout) / trunk(slim)).toBeGreaterThan(1.4);
			// Weighed as drawn, the slimmer wood sags and the crown moves.
			const loose = grow(variant, drawn(2, undefined));
			let moved = 0;
			for (let k = 0; k < slim.position.length; k++)
				moved = Math.max(
					moved,
					Math.abs((loose.position[k] as number) - (slim.position[k] as number)),
				);
			expect(moved).toBeGreaterThan(0.1);
		}
	});

	it("lets the real oak's shoots under its crown's base die back, and only those", () => {
		const record = species.record;
		const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		const lit: Species = {
			...record,
			growth: { ...growth, shedding: { ...growth.shedding, underCrown: undefined } },
		};
		const salt = record.seedSalt >>> 0;
		for (const variant of [0, 2]) {
			const height = spreadAt(record.size.height, unitAt(11, salt, variant, 1));
			const turn = unitAt(11, salt, variant, 2) * 2 * Math.PI;
			// The grower's own room: the envelope cut at the record's floor, then inset.
			const base = insetVolume(
				flooredVolume(
					envelopeVolume(record.envelope as NonNullable<Species['envelope']>, height, turn),
					(growth.floor ?? 0) * height,
				),
				shootReach(record),
			).base;
			// A bud site sits on its node's bark; the rule reads the node's own height.
			const under = (oak: MacroSkeleton) => {
				let count = 0;
				for (let b = 0; b < oak.buds.count; b++)
					if ((oak.position[(oak.buds.node[b] as number) * 3 + 1] as number) < base - 1e-6) count++;
				return count;
			};
			const open = grow(variant, lit);
			const shaded = grow(variant, record);
			expect(under(open)).toBeGreaterThan(0);
			expect(under(shaded)).toBe(0);
			expect(shaded.buds.count).toBeLessThan(open.buds.count);
			// The rule reads each bud's height as it grew, before the wood bends, and a bend can lift a
			// bud that grew under the base above it but never lowers one under it: with the bend, the
			// shaded crown loses at least the buds counted under the base.
			expect(shaded.buds.count).toBeLessThanOrEqual(open.buds.count - under(open));
			// Without the bend the heights do not move, so the shaded crown keeps exactly the buds that
			// stood above the base.
			const flat = (r: Species): Species => ({
				...r,
				growth: {
					...(r.growth as typeof growth),
					bending: { ...(r.growth as typeof growth).bending, strength: 0 },
				},
			});
			const openFlat = grow(variant, flat(lit));
			const shadedFlat = grow(variant, flat(record));
			expect(shadedFlat.buds.count).toBe(openFlat.buds.count - under(openFlat));
			// The stem keeps its whole length; the lighter load bends its top by under a millimetre.
			const top = (oak: MacroSkeleton) =>
				oak.position[(oak.axes.last[0] as number) * 3 + 1] as number;
			expect(top(shaded)).toBeCloseTo(top(open), 3);
		}
	});

	it("lays the real oak's bole straight from its foot to its division, and leaves the crown", () => {
		const record = species.record;
		const growth = record.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		const divide = growth.divide as NonNullable<typeof growth.divide>;
		const crooked: Species = {
			...record,
			growth: { ...growth, divide: { ...divide, plumb: undefined } },
		};
		for (const variant of [0, 1]) {
			const grown = grow(variant, crooked);
			const plumb = grow(variant, record);
			// How far each node of a bole stands off the line from its foot to its division.
			const offLine = (oak: MacroSkeleton) => {
				const q = oak.position;
				const a0 = oak.axes.first[0] as number;
				const a1 = oak.axes.last[0] as number;
				const f = [q[a0 * 3] as number, q[a0 * 3 + 1] as number, q[a0 * 3 + 2] as number];
				const d = [0, 1, 2].map((k) => (q[a1 * 3 + k] as number) - (f[k] as number));
				const length = Math.hypot(...d);
				let most = 0;
				for (let n = a0; n <= a1; n++) {
					const v = [0, 1, 2].map((k) => (q[n * 3 + k] as number) - (f[k] as number));
					const t = (v[0]! * d[0]! + v[1]! * d[1]! + v[2]! * d[2]!) / length;
					most = Math.max(
						most,
						Math.hypot(...v.map((x, k) => x - ((d[k] as number) * t) / length)),
					);
				}
				return most;
			};
			// The grown bole kinks off its line; the plumb one lies on it, leaning no more than the
			// record allows.
			expect(offLine(grown)).toBeGreaterThan(0.01);
			expect(offLine(plumb)).toBeLessThan(1e-3);
			const most = divide.plumb as number;
			const lean = (oak: MacroSkeleton) => {
				const q = oak.position;
				const a0 = oak.axes.first[0] as number;
				const a1 = oak.axes.last[0] as number;
				const across = Math.hypot(
					(q[a1 * 3] as number) - (q[a0 * 3] as number),
					(q[a1 * 3 + 2] as number) - (q[a0 * 3 + 2] as number),
				);
				const rise = (q[a1 * 3 + 1] as number) - (q[a0 * 3 + 1] as number);
				return (Math.atan2(across, rise) * 180) / Math.PI;
			};
			expect(lean(plumb)).toBeLessThan(most + 0.01);
			// The crown is the division's own subtree, read from the division: it keeps its shape
			// wherever the division stands. Where the division moves, the bare ends die back by their
			// new light and the twigs bend a little differently under their new load, so each node is
			// matched to the nearest of the other growth's and nearly all must lie within a centimetre:
			// a limb that moved 5 cm, holding a quarter of the crown or more, would fail.
			const crown = (oak: MacroSkeleton) => {
				const top = oak.axes.last[0] as number;
				const ox = oak.position[top * 3] as number;
				const oy = oak.position[top * 3 + 1] as number;
				const oz = oak.position[top * 3 + 2] as number;
				const inside = new Uint8Array(oak.nodeCount);
				inside[top] = 1;
				const points: number[] = [];
				for (let n = top; n < oak.nodeCount; n++) {
					const q = oak.parent[n] as number;
					if (n !== top && (q < top || !inside[q])) continue;
					inside[n] = 1;
					points.push(
						(oak.position[n * 3] as number) - ox,
						(oak.position[n * 3 + 1] as number) - oy,
						(oak.position[n * 3 + 2] as number) - oz,
					);
				}
				return points;
			};
			const a = crown(grown);
			const b = crown(plumb);
			expect(Math.abs(b.length - a.length)).toBeLessThan(a.length * 0.01);
			const cell = (x: number, y: number, z: number) =>
				`${Math.floor(x * 100)},${Math.floor(y * 100)},${Math.floor(z * 100)}`;
			const cells = new Map<string, number[]>();
			for (let i = 0; i < a.length; i += 3) {
				const key = cell(a[i] as number, a[i + 1] as number, a[i + 2] as number);
				const list = cells.get(key) ?? [];
				list.push(i);
				cells.set(key, list);
			}
			let matched = 0;
			for (let i = 0; i < b.length; i += 3) {
				const x = b[i] as number;
				const y = b[i + 1] as number;
				const z = b[i + 2] as number;
				let found = false;
				for (let dx = -1; dx <= 1 && !found; dx++)
					for (let dy = -1; dy <= 1 && !found; dy++)
						for (let dz = -1; dz <= 1 && !found; dz++)
							for (const j of cells.get(cell(x + dx / 100, y + dy / 100, z + dz / 100)) ?? [])
								if (
									Math.hypot(
										x - (a[j] as number),
										y - (a[j + 1] as number),
										z - (a[j + 2] as number),
									) < 0.01
								)
									found = true;
				if (found) matched++;
			}
			expect(matched).toBeGreaterThanOrEqual(0.95 * (b.length / 3));
		}
	});

	it('grows one leader when λ is high and a spreading crown when it is low', () => {
		const round = (lambda: number): Species => ({
			...oakRecord,
			envelope: {
				kind: 'radial',
				heights: [0.15, 0.4, 0.7, 1],
				radii: [0.3, 0.4, 0.35, 0],
				source: { method: 'hand', from: 'a test' },
			},
			growth: {
				...(oakRecord.growth as Extract<Species['growth'], { model: 'self-organizing' }>),
				apical: { control: lambda, dominance: [1.5, 0.6, 0.98], wander: 10 },
			},
		});
		// How far the stem reaches, and its radius at half the height against the thickest limb.
		const leader = (oak: MacroSkeleton) => {
			const first = oak.axes.first[0] as number;
			const last = oak.axes.last[0] as number;
			const reach = (oak.position[last * 3 + 1] as number) / oak.height;
			let middle = 0;
			for (let n = first; n <= last; n++)
				if ((oak.position[n * 3 + 1] as number) <= 0.5 * oak.height)
					middle = oak.radius[n] as number;
			let thickest = 0;
			for (let a = 1; a < oak.axes.count; a++)
				if (oak.axes.parent[a] === 0)
					thickest = Math.max(thickest, oak.radius[oak.axes.first[a] as number] as number);
			return { reach, dominance: reach < 0.5 ? 0 : middle / thickest };
		};
		const excurrent = leader(grow(0, round(0.6)));
		const decurrent = leader(grow(0, round(0.38)));
		expect(excurrent.reach).toBeGreaterThan(0.85);
		expect(excurrent.dominance).toBeGreaterThan(0.5);
		expect(decurrent.reach).toBeLessThan(0.6);
		expect(decurrent.dominance).toBeLessThan(0.2);
	});

	it("grows side axes only on the record's side orders, and on every order without them", () => {
		const growth = oakRecord.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		const siding = (sideOrders?: number): Species => ({
			...oakRecord,
			growth: {
				...growth,
				buds: { ...growth.buds, ...(sideOrders !== undefined && { sideOrders }) },
			},
		});
		// The orders of the axes that side axes leave.
		const parents = (oak: MacroSkeleton) => {
			const orders = new Set<number>();
			for (let a = 0; a < oak.axes.count; a++) {
				const parent = oak.axes.parent[a] as number;
				if (parent >= 0) orders.add(oak.axes.order[parent] as number);
			}
			return orders;
		};
		const plain = grow(0, siding());
		expect(digest(plain)).toBe(digest(grow(0)));
		expect(parents(plain).has(1)).toBe(true);
		// With one side order, only the stem puts out side axes: every limb runs out unbranched.
		const stemOnly = grow(0, siding(1));
		expect([...parents(stemOnly)]).toEqual([0]);
		expect(stemOnly.axes.count).toBeGreaterThan(1);
		// The record check holds the side orders from 1 to the macro orders, whole.
		expect(speciesProblems(siding(1))).toEqual([]);
		expect(speciesProblems(siding(growth.macroOrders))).toEqual([]);
		for (const sideOrders of [0, 1.5, growth.macroOrders + 1])
			expect(
				speciesProblems(siding(sideOrders)).some((p) => p.startsWith('growth.buds.sideOrders')),
			).toBe(true);
	});

	it('thins an order’s side axes by the record’s branching curve, and changes nothing without one', () => {
		const growth = oakRecord.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		const thinning = (
			branchingByOrder?: number | readonly (readonly [number, number])[],
		): Species => ({
			...oakRecord,
			growth: { ...growth, ...(branchingByOrder !== undefined && { branchingByOrder }) },
		});
		const plain = grow(0, thinning());
		expect(digest(plain)).toBe(digest(grow(0)));
		// A constant 1 is the plain record to the byte.
		expect(digest(grow(0, thinning(1)))).toBe(digest(grow(0)));
		// No side axes above the stem: the crown keeps one branching order.
		const orders = (oak: MacroSkeleton) => new Set(Array.from(oak.axes.order as Uint8Array));
		const cut = grow(
			0,
			thinning([
				[0, 1],
				[0.24, 1],
				[0.25, 0],
				[1, 0],
			]),
		);
		expect(Math.max(...orders(cut))).toBe(1);
		expect(Math.max(...orders(plain))).toBeGreaterThan(1);
		// A negative share is refused.
		const bad = speciesProblems(
			thinning([
				[0, 1],
				[1, -0.5],
			]),
		);
		expect(bad.some((p) => p.startsWith('growth.branchingByOrder is -0.5 at pair 1'))).toBe(true);
	});

	it("keeps the record's share of a stem's girth from node to node, and half without one", () => {
		const growth = oakRecord.growth as Extract<Species['growth'], { model: 'self-organizing' }>;
		const keeping = (leader?: number): Species => ({
			...oakRecord,
			growth: {
				...growth,
				pipe: { ...growth.pipe, ...(leader !== undefined && { leader }) },
			},
		});
		// The least share of its girth that the stem keeps from one node to the next, and the least
		// that any other axis keeps.
		const least = (oak: MacroSkeleton) => {
			let stem = 1;
			let other = 1;
			for (let a = 0; a < oak.axes.count; a++)
				for (let n = (oak.axes.first[a] as number) + 1; n <= (oak.axes.last[a] as number); n++) {
					const share = (oak.radius[n] as number) / (oak.radius[n - 1] as number);
					if (oak.axes.kind[a] === AXIS_STEM) stem = Math.min(stem, share);
					else other = Math.min(other, share);
				}
			return { stem, other };
		};
		const plain = grow(0, keeping());
		expect(digest(plain)).toBe(digest(grow(0)));
		expect(least(plain).stem).toBeGreaterThanOrEqual(0.5 - 1e-6);
		const leading = grow(0, keeping(0.85));
		expect(least(leading).stem).toBeGreaterThanOrEqual(0.85 - 1e-6);
		// Only the stem keeps the larger share; every other axis keeps half, as it grew.
		expect(least(leading).other).toBeCloseTo(least(plain).other, 6);
		// The record check holds the share from a half to the whole girth.
		expect(speciesProblems(keeping(0.85))).toEqual([]);
		expect(speciesProblems(keeping(1))).toEqual([]);
		for (const leader of [0.4, 1.2, Number.NaN])
			expect(speciesProblems(keeping(leader)).some((p) => p.startsWith('growth.pipe.leader'))).toBe(
				true,
			);
	});

	it('keeps a stool of stems in the light up to their fork', () => {
		/** The oak's numbers as a stool of four stems, forked or not. */
		const stool = (divide: boolean): Species => ({
			...oakRecord,
			id: 'stool-test',
			size: { ...oakRecord.size, height: { mean: 8, spread: 0 }, dbh: 0.24 },
			growth: {
				...(oakRecord.growth as Extract<Species['growth'], { model: 'self-organizing' }>),
				years: 24,
				stems: {
					count: { mean: 8, spread: 0 },
					lean: { mean: 28, spread: 0 },
					stool: 0.35,
					fused: 0.1,
				},
				...(divide ? { divide: { at: 0.22, count: 2, angle: 52, lean: 6 } } : {}),
			},
		});
		/** Stems whose trunk still carries a radius over a centimetre at breast height. */
		const thick = (record: Species): number => {
			const skeleton = grow(0, record);
			const { axes } = skeleton;
			let count = 0;
			for (let a = 0; a < axes.count; a++) {
				if (axes.parent[a] !== -1) continue;
				for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++)
					if ((skeleton.position[n * 3 + 1] as number) >= 1.3) {
						if ((skeleton.radius[n] as number) > 0.01) count++;
						break;
					}
			}
			return count;
		};
		// The crown base is low, so without a fork only the stems in full light keep their girth;
		// the fork's height shelters every stem below it, and nearly all then carry a trunk.
		expect(thick(stool(true))).toBeGreaterThan(thick(stool(false)));
		expect(thick(stool(true))).toBeGreaterThanOrEqual(7);
	});

	it('leaves a stooled form a fraction of the size room for whips above one internode', () => {
		/** A thicket a fraction of the oak's size: a ring a half-metre out inside a low dome. */
		const thicket = (): Species => ({
			...oakRecord,
			id: 'thicket-test',
			size: { ...oakRecord.size, height: { mean: 1.4, spread: 0 }, dbh: 0.035 },
			envelope: {
				kind: 'radial',
				heights: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
				radii: [0.45, 0.5, 0.52, 0.52, 0.5, 0.47, 0.43, 0.38, 0.3, 0.18, 0.02],
				source: { method: 'hand', from: 'a thicket' },
			},
			growth: {
				...(oakRecord.growth as Extract<Species['growth'], { model: 'self-organizing' }>),
				years: 3,
				internode: { length: 0.3, ageFactor: 0.98 },
				stems: {
					count: { mean: 9, spread: 0 },
					lean: { mean: 4, spread: 0 },
					stool: 0.45,
					fused: 0,
				},
				divide: undefined,
			},
		});
		// The ring and the room its shoots need are both written in metres for a tree many times
		// this size, so both are held to the envelope: one internode alone would leave the whips
		// standing at the wall.
		expect(grow(0, thicket()).height).toBeGreaterThan(0.45);
	});
});
