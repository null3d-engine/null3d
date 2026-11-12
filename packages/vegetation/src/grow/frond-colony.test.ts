// The frond-colony grower on the bracken test record: no crown, each frond alone on a bare stipe
// rooted at the ground along the rhizome, the blade held near level, the blades in tiers, the
// season's ages, the same bytes twice and in a worker, inside the species box, and the stipes and
// blades meshed at every level within the ground plants' caps.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { speciesBox } from '../core/box';
import { capsFor } from '../core/caps';
import { speciesProblems } from '../core/check';
import {
	AXIS_RACHIS,
	AXIS_STIPE,
	BUD_TERMINAL,
	type MacroSkeleton,
	skeletonBuffers,
} from '../core/graph';
import { hashAt, hashBytes } from '../core/hash';
import { emptyRows } from '../core/placeholder';
import type { Species } from '../core/record';
import { noTextureFiles } from '../core/textures';
import { DETAILS, type Season, spreadMax } from '../core/types';
import { lightCrown } from '../crown/visibility';
import { MATURE_AGE } from '../leaf/frond';
import type { MeshInput } from '../stages';
import { meshWood } from '../wood/wood-mesh';
import { brackenRecord } from './bracken.fixture';
import { growFrondColony } from './frond-colony';

/** A hash of every array a skeleton holds. */
function digest(skeleton: MacroSkeleton): number {
	let hash = hashAt(skeleton.nodeCount, skeleton.axes.count, skeleton.buds.count);
	for (const buffer of skeletonBuffers(skeleton)) hash = hashBytes(new Uint8Array(buffer), hash);
	return hash;
}

function grow(season: Season = 'summer', variant = 0, seed = 11): MacroSkeleton {
	return growFrondColony({ record: brackenRecord, seed, variant, season });
}

/** A grown colony dressed for the meshers, with no shoots. */
function meshInput(skeleton: MacroSkeleton, detail: MeshInput['detail']): MeshInput {
	const record: Species = brackenRecord;
	const kit = {
		record,
		manifest: noTextureFiles(record.id).manifest,
		key: 'bracken-test',
		detail,
		prototypes: [],
		leaves: [],
		cards: { size: 0, color: new Uint8Array(0), surface: new Uint8Array(0) },
		header: new Float32Array(0),
		box: speciesBox(record),
		placeholders: false,
	};
	const dress = { record, seed: 11, variant: 0, season: 'summer' as const, kit, skeleton };
	return { ...dress, rows: emptyRows(), crown: lightCrown(dress, emptyRows()), detail };
}

/** The direction of a rachis between two of its nodes. */
function slope(skeleton: MacroSkeleton, a: number, b: number): number {
	const p = skeleton.position;
	const dx = (p[b * 3] as number) - (p[a * 3] as number);
	const dy = (p[b * 3 + 1] as number) - (p[a * 3 + 1] as number);
	const dz = (p[b * 3 + 2] as number) - (p[a * 3 + 2] as number);
	return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

const summer = grow();

describe('the frond-colony grower', () => {
	it('takes a record the check passes', () => {
		expect(speciesProblems(brackenRecord)).toEqual([]);
	});

	it('gathers the fronds into the masses the record names', () => {
		const colony = brackenRecord.growth as Extract<Species['growth'], { model: 'frond-colony' }>;
		const clumped: Species = {
			...brackenRecord,
			growth: {
				...colony,
				rhizome: {
					...colony.rhizome,
					clump: { count: 4, radius: 0.12, ring: 0.62 },
				},
			},
		};
		const skeleton = growFrondColony({ record: clumped, seed: 11, variant: 0, season: 'summer' });
		const feet: number[][] = [];
		for (let a = 0; a < skeleton.axes.count; a++) {
			if (skeleton.axes.order[a] !== 0) continue;
			const n = skeleton.axes.first[a] as number;
			feet.push([skeleton.position[n * 3] as number, skeleton.position[n * 3 + 2] as number]);
		}
		expect(feet.length).toBeGreaterThan(4);
		const centres = [0, 1, 2, 3].map((c) => {
			const mine = feet.filter((_, f) => f % 4 === c);
			const x = mine.reduce((s, p) => s + (p[0] as number), 0) / mine.length;
			const z = mine.reduce((s, p) => s + (p[1] as number), 0) / mine.length;
			return { x, z, mine };
		});
		for (const centre of centres) {
			// Each mass's fronds stand within its disc, and its centre sits on the named ring.
			for (const p of centre.mine)
				expect(Math.hypot((p[0] as number) - centre.x, (p[1] as number) - centre.z)).toBeLessThan(
					0.25,
				);
			expect(Math.hypot(centre.x, centre.z)).toBeGreaterThan(0.4);
			expect(Math.hypot(centre.x, centre.z)).toBeLessThan(0.8);
		}
	});

	it('grows no crown: each frond rises alone on a stipe rooted at the ground', () => {
		const { axes, buds, position } = summer;
		const stipes: number[] = [];
		for (let a = 0; a < axes.count; a++) {
			if ((axes.kind[a] as number) !== AXIS_STIPE) continue;
			stipes.push(a);
			expect(axes.parent[a]).toBe(-1);
			expect(position[(axes.first[a] as number) * 3 + 1]).toBe(0);
		}
		const colony = brackenRecord.growth as { fronds: { mean: number; spread: number } };
		expect(stipes.length).toBeGreaterThanOrEqual(colony.fronds.mean - colony.fronds.spread - 4);
		expect(stipes.length).toBeLessThanOrEqual(spreadMax(colony.fronds));
		// No two stipes share a foot: the fronds stand apart along the rhizome.
		for (let i = 0; i < stipes.length; i++)
			for (let j = i + 1; j < stipes.length; j++) {
				const a = (axes.first[stipes[i] as number] as number) * 3;
				const b = (axes.first[stipes[j] as number] as number) * 3;
				const gap = Math.hypot(
					(position[a] as number) - (position[b] as number),
					(position[a + 2] as number) - (position[b + 2] as number),
				);
				expect(gap).toBeGreaterThan(0.04);
			}
		// One bud a frond, at the blade's base on the rachis that leads on from the stipe's top.
		expect(buds.count).toBe(stipes.length);
		for (let b = 0; b < buds.count; b++) {
			const axis = buds.axis[b] as number;
			expect(axes.kind[axis]).toBe(AXIS_RACHIS);
			expect(buds.kind[b]).toBe(BUD_TERMINAL);
			const stipe = axes.parent[axis] as number;
			expect(axes.kind[stipe]).toBe(AXIS_STIPE);
			expect(axes.parentNode[axis]).toBe(axes.last[stipe] as number);
		}
	});

	it('holds each mature blade near level on top of its stipe, the blades in tiers', () => {
		const { axes, buds } = summer;
		const bases: number[] = [];
		let level = 0;
		let mature = 0;
		for (let b = 0; b < buds.count; b++) {
			bases.push(buds.position[b * 3 + 1] as number);
			if ((buds.vigor[b] as number) !== MATURE_AGE) continue;
			mature++;
			const axis = buds.axis[b] as number;
			const first = axes.first[axis] as number;
			const last = axes.last[axis] as number;
			const span = last - first;
			// The middle half of the blade's rachis runs within 30 degrees of level.
			const angle = slope(summer, first + Math.floor(span * 0.3), first + Math.floor(span * 0.7));
			if (Math.abs(angle) < 30) level++;
		}
		expect(mature).toBeGreaterThan(buds.count / 2);
		expect(level).toBe(mature);
		bases.sort((a, b) => a - b);
		expect((bases[bases.length - 1] as number) - (bases[0] as number)).toBeGreaterThan(0.2);
	});

	it('ages its fronds by the season', () => {
		const vigor = (skeleton: MacroSkeleton) => Array.from(skeleton.buds.vigor);
		expect(vigor(grow('blossom')).every((age) => age < MATURE_AGE)).toBe(true);
		const young = vigor(summer).filter((age) => age < MATURE_AGE).length;
		expect(young).toBeLessThanOrEqual(3);
		expect(vigor(grow('autumn')).every((age) => age > MATURE_AGE)).toBe(true);
		// Winter's dead fronds lie flat: nothing stands above a few stipes' broken height.
		const winter = grow('winter');
		expect(winter.height).toBeLessThan(0.45);
		expect(winter.buds.count).toBeLessThan(summer.buds.count + 4);
	});

	it('grows the same bytes twice, and other bytes for another variant or seed', () => {
		const first = digest(summer);
		expect(digest(grow())).toBe(first);
		expect(digest(grow('summer', 1))).not.toBe(first);
		expect(digest(grow('summer', 0, 12))).not.toBe(first);
	});

	it('grows the same bytes in a worker', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'frond-colony-'));
		try {
			const script = join(dir, 'worker.ts');
			writeFileSync(
				script,
				`import { growFrondColony } from ${JSON.stringify(join(import.meta.dirname, 'frond-colony.ts'))};
import { brackenRecord } from ${JSON.stringify(join(import.meta.dirname, 'bracken.fixture.ts'))};
self.onmessage = () => {
	const skeleton = growFrondColony({ record: brackenRecord, seed: 11, variant: 0, season: 'summer' });
	postMessage(skeleton);
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
			expect(digest(grown)).toBe(digest(summer));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('stays inside the species box in every season and variant', () => {
		const box = speciesBox(brackenRecord);
		for (const season of ['summer', 'autumn', 'winter', 'blossom'] as const)
			for (let variant = 0; variant < brackenRecord.variants; variant++) {
				const { min, max } = grow(season, variant).bounds;
				for (let k = 0; k < 3; k++) {
					expect(min[k] as number).toBeGreaterThan(box.min[k] as number);
					expect(max[k] as number).toBeLessThan(box.max[k] as number);
				}
			}
	});

	it('meshes every stipe as wood and every blade as foliage, within the ground caps', async () => {
		const { grower } = await import('./frond-colony');
		const caps = capsFor(brackenRecord);
		for (const detail of DETAILS) {
			const input = meshInput(summer, detail);
			const triangles = [0, 1, 2].map((level) => {
				const lod = level as 0 | 1 | 2;
				const wood = meshWood(input, lod);
				const fronds = grower.foliage?.(input, lod);
				if (!fronds) throw new Error('no foliage');
				expect(wood.indices.length).toBeGreaterThan(0);
				expect(fronds.indices.length).toBeGreaterThan(0);
				// Every vertex keeps its share along the frond and its browning within 0 to 1.
				for (const value of fronds.uvs1) {
					expect(value).toBeGreaterThanOrEqual(0);
					expect(value).toBeLessThanOrEqual(1);
				}
				return (wood.indices.length + fronds.indices.length) / 3;
			});
			expect(triangles[1] as number).toBeLessThan(triangles[0] as number);
			expect(triangles[2] as number).toBeLessThan(triangles[1] as number);
			if (detail === 'high') {
				expect(triangles[0] as number).toBeLessThan(caps.lod0Triangles);
				expect(triangles[1] as number).toBeLessThan(caps.lod1Triangles);
				expect(triangles[2] as number).toBeLessThan(caps.lod2Triangles);
			}
		}
	});
});
