import { describe, expect, it } from 'bun:test';
import { hashBytes } from '../core/hash';
import { oakRecord } from '../grow/oak.fixture';
import { growSelfOrganizing } from '../grow/self-organizing';
import { dequantisePosition, quantise, WOOD_UV_STEPS } from '../lod/quantise';
import type { MeshLevel } from '../stages';
import { stemSection } from './flare';
import { ParentSurface } from './junction';
import { tilesRound } from './uv';
import { measureDensity, measureWelds } from './wood-measure';
import { meshWood, meshWoodReport, WOOD_RADIUS_RANGE } from './wood-mesh';
import { testMeshInput, testOak, testRecord, testSkeleton } from './wood-test-tree';

const LEVELS: readonly MeshLevel[] = [0, 1, 2];
const oak = testOak();
const reports = LEVELS.map((level) => meshWoodReport(testMeshInput('high', oak), level));
const oakWelds = reports.map((report) => measureWelds(report));

describe('the wood mesher', () => {
	it('welds every child onto its parent with no gap of a millimetre, at every level', () => {
		const small = LEVELS.map((level) =>
			measureWelds(meshWoodReport(testMeshInput('high', testSkeleton()), level)),
		);
		for (const welds of [...small, ...oakWelds]) {
			expect(welds.length).toBeGreaterThan(0);
			for (const weld of welds) expect(weld.gap).toBeLessThan(0.001);
		}
	});

	it('runs v on from the parent into each child, with no jump at the weld', () => {
		for (const welds of oakWelds) for (const weld of welds) expect(weld.vJump).toBeLessThan(0.001);
	});

	it('pushes no child tube into its parent at the joint', () => {
		const report = reports[0] as (typeof reports)[0];
		for (const [child, parent] of report.parents) {
			if (parent < 0) continue;
			const surface = new ParentSurface(report.axisRings.get(parent) as never);
			const rings = report.axisRings.get(child);
			if (!rings) continue;
			// The weld and its blend rings; past the joint a crooked child may bend back into its
			// parent, which is the skeleton's shape and not a weld.
			// The weld ring lies on the parent's triangles, which the weld test measures exactly; a
			// fork's leader shares its parent's last ring. The rings after it must stand clear.
			const from = rings.first[1] as number;
			const end = Math.min(rings.count, Math.max(2, rings.welded));
			const last = end < rings.count ? (rings.first[end] as number) : rings.vertices;
			let deepest = 0;
			for (let i = from; i < last; i++)
				deepest = Math.min(
					deepest,
					surface.distance(
						rings.position[i * 3] as number,
						rings.position[i * 3 + 1] as number,
						rings.position[i * 3 + 2] as number,
					),
				);
			expect(deepest).toBeGreaterThan(-0.001);
		}
	});

	it('keeps the bark texel density within 30 per cent of the target on every ring, at every tier', () => {
		for (const detail of ['low', 'medium', 'high', 'ultra'] as const)
			for (const level of LEVELS) {
				const density = measureDensity(meshWoodReport(testMeshInput(detail, oak), level));
				expect(density.rings).toBeGreaterThan(20);
				expect(density.around).toBeLessThanOrEqual(0.3);
				expect(density.along).toBeLessThanOrEqual(0.3);
			}
	});

	it('wraps a whole number of tiles round a ring where one fits, and true metres where none does', () => {
		expect(tilesRound(3.1, 0.5, -1)).toBe(6);
		expect(tilesRound(3.4, 0.5, 6)).toBe(6);
		expect(tilesRound(4.2, 0.5, 6)).toBe(8);
		expect(tilesRound(0.3, 0.5, -1)).toBe(0);
		expect(tilesRound(0.72, 0.5, -1)).toBe(0);
		expect(tilesRound(0.55, 0.5, -1)).toBe(0);
		expect(tilesRound(1.3, 0.5, -1)).toBe(3);
		expect(tilesRound(1.3, 0.5, 0)).toBe(0);
	});

	it('writes bark coordinates in range, normals of unit length, and indices of its own vertices', () => {
		for (const report of reports) {
			const { mesh } = report;
			const count = mesh.positions.length / 3;
			for (let i = 0; i < count; i++) {
				const u = mesh.uvs[i * 2] as number;
				const v = mesh.uvs[i * 2 + 1] as number;
				expect(u).toBeGreaterThanOrEqual(0);
				expect(v).toBeGreaterThanOrEqual(0);
				expect(Math.max(u, v)).toBeLessThan(65535 / WOOD_UV_STEPS);
				const n = Math.hypot(
					mesh.normals[i * 3] as number,
					mesh.normals[i * 3 + 1] as number,
					mesh.normals[i * 3 + 2] as number,
				);
				expect(Math.abs(n - 1)).toBeLessThan(1e-4);
				// The pipe radius, which no wood of this tree passes a metre in.
				expect((mesh.uvs1[i * 2] as number) * WOOD_RADIUS_RANGE).toBeLessThan(1);
			}
			for (const index of mesh.indices) expect(index).toBeLessThan(count);
		}
	});

	it('faces every triangle outward', () => {
		const { mesh } = reports[0] as (typeof reports)[0];
		const p = mesh.positions;
		const n = mesh.normals;
		let inward = 0;
		let faces = 0;
		for (let t = 0; t < mesh.indices.length; t += 3) {
			const a = mesh.indices[t] as number;
			const b = mesh.indices[t + 1] as number;
			const c = mesh.indices[t + 2] as number;
			const e1 = [0, 1, 2].map((k) => (p[b * 3 + k] as number) - (p[a * 3 + k] as number));
			const e2 = [0, 1, 2].map((k) => (p[c * 3 + k] as number) - (p[a * 3 + k] as number));
			const face = [
				(e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number),
				(e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number),
				(e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number),
			];
			const area = Math.hypot(face[0] as number, face[1] as number, face[2] as number);
			if (area < 1e-10) continue;
			faces++;
			let dot = 0;
			for (let k = 0; k < 3; k++)
				dot +=
					(face[k] as number) *
					((n[a * 3 + k] as number) + (n[b * 3 + k] as number) + (n[c * 3 + k] as number));
			if (dot < 0) inward++;
		}
		expect(faces).toBeGreaterThan(1000);
		expect(inward / faces).toBeLessThan(0.002);
	});

	it('flares the stem at the ground into buttress lobes', () => {
		const input = testMeshInput('high', oak);
		const base = input.record.base;
		const section = stemSection(base, input.seed, input.record.seedSalt, input.variant, 0);
		expect(section).toBeDefined();
		if (!section || !base) return;
		expect(section.lobes.length).toBeGreaterThanOrEqual(4);
		const pipe = 0.55;
		let low = Number.POSITIVE_INFINITY;
		let high = 0;
		let peaks = 0;
		const samples = 720;
		const at = (k: number) => section.radius(0, (k / samples) * 2 * Math.PI, pipe);
		for (let k = 0; k < samples; k++) {
			const r = at(k);
			low = Math.min(low, r);
			high = Math.max(high, r);
			if (r > at(k - 1) && r >= at(k + 1) && r > pipe * (1 + base.flare.amount) * 1.02) peaks++;
		}
		expect(low).toBeGreaterThan(pipe * (1 + base.flare.amount) * 0.99);
		expect(high).toBeGreaterThan(low * 1.15);
		expect(peaks).toBe(section.lobes.length);
		// A metre and a half up, the foot has gone.
		expect(section.radius(1.5, 0.3, pipe)).toBeLessThan(pipe * 1.03);
	});

	it('keeps fewer orders and fewer triangles at the card levels', () => {
		const counts = reports.map((report) => report.mesh.indices.length / 3);
		expect(counts[1] as number).toBeLessThan((counts[0] as number) / 3);
		expect(counts[2] as number).toBeLessThan((counts[1] as number) / 2);
		const record = testMeshInput('high', oak).record;
		for (const [level, report] of reports.entries()) {
			const keep = level === 0 ? 255 : (record.lod.woodOrders[level - 1] as number);
			for (const axis of report.axisRings.keys())
				expect(oak.axes.order[axis] as number).toBeLessThanOrEqual(keep);
		}
	});

	it('gives the same bytes every time', () => {
		const digest = (level: MeshLevel) => {
			const mesh = meshWood(testMeshInput('medium', oak), level);
			let h = hashBytes(new Uint8Array(mesh.positions.buffer));
			h = hashBytes(new Uint8Array(mesh.uvs.buffer), h);
			h = hashBytes(new Uint8Array(mesh.normals.buffer), h);
			return hashBytes(new Uint8Array(mesh.indices.buffer), h);
		};
		expect(digest(0)).toBe(digest(0));
		expect(digest(1)).toBe(digest(1));
	});
});

describe('quantisation', () => {
	it('moves no wood vertex by a millimetre, and keeps its bark coordinates to a millimetre', () => {
		const box = { min: [-24, -3.3, -24] as const, max: [24, 26, 24] as const };
		const mesh = (reports[0] as (typeof reports)[0]).mesh;
		const q = quantise(mesh, box, WOOD_UV_STEPS);
		const out: [number, number, number] = [0, 0, 0];
		let worst = 0;
		let worstUv = 0;
		let worstNormal = 0;
		for (let i = 0; i < mesh.positions.length / 3; i++) {
			dequantisePosition(q.positions, i, box, out);
			worst = Math.max(
				worst,
				Math.hypot(
					out[0] - (mesh.positions[i * 3] as number),
					out[1] - (mesh.positions[i * 3 + 1] as number),
					out[2] - (mesh.positions[i * 3 + 2] as number),
				),
			);
			for (let k = 0; k < 2; k++)
				worstUv = Math.max(
					worstUv,
					Math.abs((q.uvs[i * 2 + k] as number) / WOOD_UV_STEPS - (mesh.uvs[i * 2 + k] as number)),
				);
			for (let k = 0; k < 3; k++)
				worstNormal = Math.max(
					worstNormal,
					Math.abs((q.normals[i * 3 + k] as number) / 127 - (mesh.normals[i * 3 + k] as number)),
				);
		}
		expect(worst).toBeLessThan(0.001);
		expect(worstUv).toBeLessThan(0.001);
		expect(worstNormal).toBeLessThan(0.005);
		expect(q.colors).toEqual(mesh.colors);
		expect(Array.from(q.indices)).toEqual(Array.from(mesh.indices));
	});

	it('holds every value within its 16 bits', () => {
		const q = quantise(
			{
				positions: new Float32Array([-100, 0, 100]),
				normals: new Float32Array([1.2, -1.2, 0]),
				uvs: new Float32Array([-1, 100]),
				uvs1: new Float32Array([2, -1]),
				colors: new Uint8Array(4),
				indices: new Uint16Array(0),
			},
			{ min: [-1, -1, -1], max: [1, 1, 1] },
			WOOD_UV_STEPS,
		);
		expect(Array.from(q.positions)).toEqual([0, 32768, 65535]);
		expect(Array.from(q.normals)).toEqual([127, -127, 0]);
		expect(Array.from(q.uvs)).toEqual([0, 65535]);
		expect(Array.from(q.uvs1)).toEqual([65535, 0]);
	});
});

describe('the wood of the grown oak', () => {
	// The self-organizing grower's oak, with the test record's bark and stem foot.
	const record = { ...oakRecord, bark: testRecord().bark, base: testRecord().base };
	const skeleton = growSelfOrganizing({ record, seed: 11, variant: 0, season: 'summer' });
	const report = meshWoodReport({ ...testMeshInput('high', skeleton), record }, 0);

	it('welds every one of its children within a millimetre, with v running on', () => {
		const welds = measureWelds(report);
		expect(welds.length).toBeGreaterThan(1000);
		for (const weld of welds) {
			expect(weld.gap).toBeLessThan(0.001);
			expect(weld.vJump).toBeLessThan(0.001);
		}
	});

	it('keeps the bark texel density within 30 per cent of the target on every ring', () => {
		const density = measureDensity(report);
		expect(density.rings).toBeGreaterThan(5000);
		expect(density.around).toBeLessThanOrEqual(0.3);
		expect(density.along).toBeLessThanOrEqual(0.3);
	});

	it('keeps v within the 16 bits that hold it', () => {
		let most = 0;
		for (let i = 1; i < report.mesh.uvs.length; i += 2)
			most = Math.max(most, report.mesh.uvs[i] as number);
		expect(most).toBeLessThan(65535 / WOOD_UV_STEPS);
	});
});
