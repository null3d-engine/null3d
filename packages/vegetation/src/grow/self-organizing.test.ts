// The self-organizing grower on the pedunculate oak: it fills the envelope measured from the oak's
// reference turntable from every side, grows the same bytes on this thread and in a worker, grows
// at least three macro orders with a clean bole, fits its stem to the oak's diameter, gives its bud
// sites resource and light, and turns from one leader to a spreading crown as λ falls.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUD_TERMINAL, type MacroSkeleton, NODE_STUB, skeletonBuffers } from '../core/graph';
import { hashAt, hashBytes, unitAt } from '../core/hash';
import type { Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import {
	envelopeSilhouette,
	envelopeVolume,
	silhouetteFrame,
	silhouetteIoU,
	skeletonSilhouette,
} from './envelope';
import { oakRecord } from './oak.fixture';
import { growSelfOrganizing, shootReach } from './self-organizing';

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

const oaks = [0, 1, 2].map((variant) => grow(variant));

describe('the self-organizing oak', () => {
	it('fills its envelope from eight sides, IoU 0.85 or better, in every variant', () => {
		oaks.forEach((oak, variant) => {
			for (const iou of envelopeFit(oak, variant)) expect(iou).toBeGreaterThanOrEqual(0.85);
		});
	});

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
});
