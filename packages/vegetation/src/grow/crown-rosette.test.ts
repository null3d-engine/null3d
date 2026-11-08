// The crown-rosette grower on a small palm-like test record: one stem with its growing point at
// the top, a living crown whose fronds span crozier to mature, a skirt of dead fronds, each frond a
// stipe and a rachis whose pinnae are axes with terminal buds, the same bytes twice and in a worker,
// inside the species box, and its pinnae meshed as foliage within the palm caps.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { speciesBox } from '../core/box';
import { capsFor } from '../core/caps';
import { speciesProblems } from '../core/check';
import {
	AXIS_LIMB,
	AXIS_RACHIS,
	AXIS_STEM,
	AXIS_STIPE,
	BUD_TERMINAL,
	type MacroSkeleton,
	skeletonBuffers,
} from '../core/graph';
import { hashAt, hashBytes } from '../core/hash';
import { emptyRows } from '../core/placeholder';
import type { CrownRosette } from '../core/record';
import { noTextureFiles } from '../core/textures';
import { DETAILS, spreadMax } from '../core/types';
import { lightCrown } from '../crown/visibility';
import { MATURE_AGE } from '../leaf/frond';
import type { MeshInput } from '../stages';
import { meshWood } from '../wood/wood-mesh';
import { growCrownRosette, grower } from './crown-rosette';
import { palmRecord } from './crown-rosette.fixture';

/** A hash of every array a skeleton holds. */
function digest(skeleton: MacroSkeleton): number {
	let hash = hashAt(skeleton.nodeCount, skeleton.axes.count, skeleton.buds.count);
	for (const buffer of skeletonBuffers(skeleton)) hash = hashBytes(new Uint8Array(buffer), hash);
	return hash;
}

function grow(variant = 0, seed = 11): MacroSkeleton {
	return growCrownRosette({ record: palmRecord, seed, variant, season: 'summer' });
}

/** A grown plant dressed for the meshers, with no shoots. */
function meshInput(skeleton: MacroSkeleton, detail: MeshInput['detail']): MeshInput {
	const record = palmRecord;
	const kit = {
		record,
		manifest: noTextureFiles(record.id).manifest,
		key: 'crown-rosette-test',
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

const grown = grow();

describe('the crown-rosette grower', () => {
	it('takes a record the check passes', () => {
		expect(speciesProblems(palmRecord)).toEqual([]);
	});

	it('grows one stem with its growing point at the top', () => {
		const { axes, position } = grown;
		const stems: number[] = [];
		for (let a = 0; a < axes.count; a++) if ((axes.kind[a] as number) === AXIS_STEM) stems.push(a);
		expect(stems.length).toBe(1);
		// The stem's top is the plant's highest wood, under the crown's fronds.
		const top = (axes.last[stems[0] as number] as number) * 3 + 1;
		expect(position[top] as number).toBeGreaterThan(1.9);
		expect(position[top] as number).toBeLessThan(2.1);
	});

	it('hangs every frond on the stem, and every pinna on its frond', () => {
		const { axes } = grown;
		let stipes = 0;
		let rachises = 0;
		let pinnae = 0;
		for (let a = 0; a < axes.count; a++) {
			const kind = axes.kind[a] as number;
			const parent = axes.parent[a] as number;
			if (kind === AXIS_STIPE) {
				stipes++;
				expect(axes.kind[parent]).toBe(AXIS_STEM);
				expect(axes.order[a]).toBe(1);
			} else if (kind === AXIS_RACHIS) {
				rachises++;
				expect(axes.kind[parent]).toBe(AXIS_STIPE);
				expect(axes.order[a]).toBe(2);
			} else if (kind === AXIS_LIMB) {
				pinnae++;
				expect(axes.kind[parent]).toBe(AXIS_RACHIS);
				expect(axes.order[a]).toBe(3);
			}
		}
		const crown = (palmRecord.growth as CrownRosette).crown;
		expect(stipes).toBeGreaterThanOrEqual(Math.round(spreadMax(crown.fronds)));
		expect(rachises).toBe(stipes);
		// Each rachis of a mature frond carries a pinna pair at every place.
		expect(pinnae).toBeGreaterThan(stipes * 4);
	});

	it('gives every pinna a terminal bud that carries its frond age', () => {
		const { axes, buds } = grown;
		let croziers = 0;
		let mature = 0;
		let dead = 0;
		for (let b = 0; b < buds.count; b++) {
			expect(buds.kind[b]).toBe(BUD_TERMINAL);
			expect(axes.kind[buds.axis[b] as number]).toBe(AXIS_LIMB);
			const age = buds.vigor[b] as number;
			if (age < 0.25) croziers++;
			else if (age <= MATURE_AGE) mature++;
			else dead++;
		}
		expect(croziers).toBeGreaterThan(0);
		expect(mature).toBeGreaterThan(0);
		expect(dead).toBeGreaterThan(0);
	});

	it('grows the same bytes twice, and other bytes for another variant or seed', () => {
		const first = digest(grown);
		expect(digest(grow())).toBe(first);
		expect(digest(grow(1))).not.toBe(first);
		expect(digest(grow(0, 12))).not.toBe(first);
	});

	it('grows the same bytes in a worker', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'crown-rosette-'));
		try {
			const script = join(dir, 'worker.ts');
			writeFileSync(
				script,
				`import { growCrownRosette } from ${JSON.stringify(join(import.meta.dirname, 'crown-rosette.ts'))};
import { palmRecord } from ${JSON.stringify(join(import.meta.dirname, 'crown-rosette.fixture.ts'))};
self.onmessage = () => {
	const skeleton = growCrownRosette({ record: palmRecord, seed: 11, variant: 0, season: 'summer' });
	postMessage(skeleton);
};
`,
			);
			const worker = new Worker(script);
			const made = await new Promise<MacroSkeleton>((resolve, reject) => {
				worker.onmessage = (event) => resolve(event.data as MacroSkeleton);
				worker.onerror = (event) => reject(new Error(String(event.message)));
				worker.postMessage(0);
			});
			worker.terminate();
			expect(digest(made)).toBe(digest(grown));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('stays inside the species box in every variant', () => {
		const box = speciesBox(palmRecord);
		for (let variant = 0; variant < palmRecord.variants; variant++) {
			const { min, max } = grow(variant).bounds;
			for (let k = 0; k < 3; k++) {
				expect(min[k] as number).toBeGreaterThan(box.min[k] as number);
				expect(max[k] as number).toBeLessThan(box.max[k] as number);
			}
		}
	});

	it('meshes its wood and its pinnae as foliage within the palm caps', () => {
		const caps = capsFor(palmRecord);
		for (const detail of DETAILS) {
			const input = meshInput(grown, detail);
			const triangles = [0, 1, 2].map((level) => {
				const lod = level as 0 | 1 | 2;
				const wood = meshWood(input, lod);
				const foliage = grower.foliage?.(input, lod);
				if (!foliage) throw new Error('no foliage');
				expect(wood.indices.length).toBeGreaterThan(0);
				expect(foliage.indices.length).toBeGreaterThan(0);
				for (const value of foliage.uvs1) {
					expect(value).toBeGreaterThanOrEqual(0);
					expect(value).toBeLessThanOrEqual(1);
				}
				return (wood.indices.length + foliage.indices.length) / 3;
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
