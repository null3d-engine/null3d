import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { speciesBox } from '../core/box';
import { capsFor } from '../core/caps';
import { NODE_STUB } from '../core/graph';
import { hashBytes } from '../core/hash';
import type { Species } from '../core/record';
import { DETAILS } from '../core/types';
import { oakRecord } from '../grow/oak.fixture';
import { growSelfOrganizing } from '../grow/self-organizing';
import {
	dequantisePosition,
	PART_VERTICES,
	quantise,
	quantiseParts,
	splitMesh,
	WOOD_UV_STEPS,
} from '../lod/quantise';
import type { MeshLevel } from '../stages';
import { stemSection } from './flare';
import { axisPath, KINK_BEND, roundKinks } from './frames';
import { ParentSurface } from './junction';
import { ringArcs, ringTurn, tubeDetail } from './tube';
import { tilesRound } from './uv';
import { measureDensity, measureLeaders, measureWelds } from './wood-measure';
import { meshWood, meshWoodReport, WOOD_RADIUS_RANGE } from './wood-mesh';
import { testMeshInput, testOak, testRecord, testSkeleton } from './wood-test-tree';

const LEVELS: readonly MeshLevel[] = [0, 1, 2];
/**
 * How far a stem's foot may stray round the stem: it keeps the plain stem's tile count, so its
 * plates widen by as much as the flare and the lobes swell it.
 */
const FOOT_SPREAD = 0.75;
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

	it('marks the parent crotch only where the record names creases', () => {
		const input = testMeshInput('high');
		const record = input.record;
		const bark = record.bark;
		if (!bark) throw new Error('the test record has no bark');
		const collar = bark.collar;
		const plain = meshWood(input, 0);
		const zero = meshWood(
			{ ...input, record: { ...record, bark: { ...bark, collar: { ...collar, creases: 0 } } } },
			0,
		);
		expect(zero.uvs1).toEqual(plain.uvs1);
		const creased = meshWood(
			{ ...input, record: { ...record, bark: { ...bark, collar: { ...collar, creases: 1 } } } },
			0,
		);
		let marked = 0;
		let strong = 0;
		for (let i = 0; i < creased.uvs1.length; i += 2) {
			if (creased.uvs1[i + 1] !== plain.uvs1[i + 1]) marked++;
			if ((creased.uvs1[i + 1] as number) > 0.6) strong++;
		}
		expect(marked).toBeGreaterThan(0);
		// The welds alone mark about a quarter of a thousand vertices; the fork's crooked side
		// carries the same mark up the parent from its end, so a tree with both reads far more.
		expect(strong).toBeGreaterThan(400);
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

	it('gives every fork leader its parent’s last ring in position, normal and bark', () => {
		for (const report of reports) {
			const leaders = measureLeaders(report);
			expect(leaders.length).toBeGreaterThan(0);
			for (const leader of leaders) {
				expect(leader.gap).toBeLessThan(1e-9);
				expect(leader.normal).toBeLessThan(1e-9);
				expect(leader.u).toBeLessThan(1e-9);
				expect(leader.v).toBeLessThan(1e-9);
			}
		}
	});

	it('keeps a fork leader’s bend rings round, so the bark does not shear across the joint', () => {
		for (const report of reports) {
			let bends = 0;
			for (const [, rings] of report.axisRings) {
				if (!rings.shared) continue;
				for (let r = 1; r < rings.count; r++) {
					const sides = rings.sides[r] as number;
					const first = rings.first[r] as number;
					const centre = [0, 0, 0];
					for (let j = 0; j < sides; j++)
						for (let k = 0; k < 3; k++)
							centre[k] =
								(centre[k] as number) + (rings.position[(first + j) * 3 + k] as number) / sides;
					let least = Number.POSITIVE_INFINITY;
					let most = 0;
					for (let j = 0; j < sides; j++) {
						const d = Math.hypot(
							(rings.position[(first + j) * 3] as number) - (centre[0] as number),
							(rings.position[(first + j) * 3 + 1] as number) - (centre[1] as number),
							(rings.position[(first + j) * 3 + 2] as number) - (centre[2] as number),
						);
						least = Math.min(least, d);
						most = Math.max(most, d);
					}
					expect((most - least) / most).toBeLessThan(0.01);
					bends++;
				}
			}
			expect(bends).toBeGreaterThan(0);
		}
	});

	it('runs a fork joint over a longer elbow at a larger bend, and swells its middle at a knot', () => {
		const plain = testMeshInput('high', oak);
		const bark = plain.record.bark as NonNullable<Species['bark']>;
		const joint = (fork: NonNullable<Species['bark']>['fork']) =>
			meshWoodReport({ ...plain, record: { ...plain.record, bark: { ...bark, fork } } }, 0);
		// Each leader's elbow: its rings from the parent's last ring to its own first plain one,
		// as the length its centre runs and each ring's mean radius.
		const elbows = (report: ReturnType<typeof meshWoodReport>) => {
			const out = new Map<number, { length: number; radii: number[] }>();
			for (const [key, rings] of report.axisRings) {
				if (!rings.shared) continue;
				let length = 0;
				const radii: number[] = [];
				for (let r = 0; r < rings.welded; r++) {
					if (r > 0)
						length += Math.hypot(
							(rings.centre[r * 3] as number) - (rings.centre[(r - 1) * 3] as number),
							(rings.centre[r * 3 + 1] as number) - (rings.centre[(r - 1) * 3 + 1] as number),
							(rings.centre[r * 3 + 2] as number) - (rings.centre[(r - 1) * 3 + 2] as number),
						);
					const first = rings.first[r] as number;
					const sides = rings.sides[r] as number;
					let sum = 0;
					for (let j = 0; j < sides; j++) sum += rings.rho[first + j] as number;
					radii.push(sum / sides);
				}
				out.set(key, { length, radii });
			}
			return out;
		};
		const base = elbows(joint(undefined));
		expect(base.size).toBeGreaterThan(0);
		// The default joint is today's.
		const same = elbows(joint({ bend: 1.5, knot: 0 }));
		for (const [key, elbow] of base) expect(same.get(key)?.length).toBeCloseTo(elbow.length, 9);
		// A larger bend runs every elbow out at least as far, and some further.
		let longer = 0;
		for (const [key, elbow] of elbows(joint({ bend: 3 }))) {
			const was = base.get(key)?.length ?? 0;
			expect(elbow.length).toBeGreaterThanOrEqual(was - 1e-9);
			if (elbow.length > was * 1.2) longer++;
		}
		expect(longer).toBeGreaterThan(0);
		// A knot leaves both ends of an elbow as they were and swells its middle, by no more than
		// its share.
		let swollen = 0;
		for (const [key, elbow] of elbows(joint({ knot: 0.25 }))) {
			const was = base.get(key)?.radii ?? [];
			expect(elbow.radii.length).toBe(was.length);
			expect(elbow.radii[0]).toBeCloseTo(was[0] as number, 9);
			for (let r = 1; r < was.length; r++) {
				const share = (elbow.radii[r] as number) / (was[r] as number);
				expect(share).toBeGreaterThanOrEqual(1 - 1e-9);
				expect(share).toBeLessThanOrEqual(1.25 + 1e-9);
				if (share > 1.05) swollen++;
			}
		}
		expect(swollen).toBeGreaterThan(0);
	});

	it('keeps the bark texel density within 30 per cent of the target on every ring, at every tier', () => {
		for (const detail of ['low', 'medium', 'high', 'ultra'] as const)
			for (const level of LEVELS) {
				const density = measureDensity(meshWoodReport(testMeshInput(detail, oak), level));
				expect(density.rings).toBeGreaterThan(20);
				expect(density.around).toBeLessThanOrEqual(0.3);
				expect(density.along).toBeLessThanOrEqual(0.3);
				expect(density.foot).toBeLessThanOrEqual(FOOT_SPREAD);
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
			// Surface roots have no skeleton axis: their numbers are below zero.
			for (const key of report.axisRings.keys()) {
				const axis = report.axisOf.get(key) as number;
				if (axis >= 0) expect(oak.axes.order[axis] as number).toBeLessThanOrEqual(keep);
			}
		}
	});

	it('peels strips of bark at the nearest level only, in the peel zone, as many as the record asks', () => {
		const input = testMeshInput('high', testSkeleton());
		const bark = input.record.bark as NonNullable<typeof input.record.bark>;
		const peel = { zone: 0, perSquareMetre: 8, width: { mean: 0.09, spread: 0.03 }, curl: 0.6 };
		const record = { ...input.record, bark: { ...bark, peel } };
		const plain = meshWood(input, 0);
		const peeled = meshWood({ ...input, record }, 0);
		// Each strip writes two faces of 5 by 3 vertices.
		const strips = (peeled.positions.length - plain.positions.length) / 3 / 30;
		expect(Number.isInteger(strips)).toBe(true);
		// The zone takes all the wood: its bark's area, from the rings, sets how many strips stand.
		let area = 0;
		for (const rings of meshWoodReport({ ...input, record }, 0).axisRings.values())
			for (let r = rings.welded; r + 1 < rings.count; r++) {
				const step = (rings.arc[r + 1] as number) - (rings.arc[r] as number);
				area += 2 * Math.PI * (rings.rho[rings.first[r] as number] as number) * step;
			}
		expect(strips).toBeGreaterThan(area * peel.perSquareMetre * 0.8);
		expect(strips).toBeLessThan(area * peel.perSquareMetre * 1.2);
		expect(meshWood({ ...input, record }, 1).positions.length).toBe(
			meshWood(input, 1).positions.length,
		);
		// Inner faces carry no pipe radius, so the shader draws them with the young bark.
		let inner = 0;
		for (let i = 0; i < peeled.positions.length / 3; i++)
			if ((peeled.uvs1[i * 2] as number) === 0) inner++;
		expect(inner).toBe(strips * 15);
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

/** Three points that kink by an angle in degrees at the middle one, a metre apart, of one radius. */
function kinked(degrees: number, radius: number) {
	const a = (degrees * Math.PI) / 180;
	return {
		points: new Float64Array([0, 0, 0, 0, 1, 0, Math.sin(a), 1 + Math.cos(a), 0]),
		radii: new Float64Array([radius, radius, radius]),
	};
}

/** The sharpest turn, in radians, between two spans of a list of points. */
function sharpestTurn(points: Float64Array, count: number): number {
	let most = 0;
	for (let i = 1; i < count - 1; i++) {
		const u = [0, 1, 2].map(
			(k) => (points[i * 3 + k] as number) - (points[(i - 1) * 3 + k] as number),
		);
		const v = [0, 1, 2].map(
			(k) => (points[(i + 1) * 3 + k] as number) - (points[i * 3 + k] as number),
		);
		const dot =
			(u[0] as number) * (v[0] as number) +
			(u[1] as number) * (v[1] as number) +
			(u[2] as number) * (v[2] as number);
		most = Math.max(most, Math.acos(Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...v)))));
	}
	return most;
}

describe('the joints inside an axis', () => {
	it('rounds a kink in thick wood into a bend, and keeps the sharp crook of a twig', () => {
		const thick = kinked(30, 0.1);
		const round = roundKinks(thick.points, thick.radii, 3, KINK_BEND);
		expect(round.count).toBeGreaterThan(3);
		expect(sharpestTurn(round.points, round.count)).toBeLessThan(0.2);
		// The ends stay where they were.
		expect(Array.from(round.points.subarray(0, 3))).toEqual([0, 0, 0]);
		expect(Array.from(round.points.subarray(-3))).toEqual(Array.from(thick.points.subarray(6)));
		const twig = kinked(30, 0.0002);
		expect(roundKinks(twig.points, twig.radii, 3, KINK_BEND).count).toBe(3);
	});

	it('rings thick wood closely round a bend, so it curves with no crease', () => {
		const tube = tubeDetail(0, 'high');
		const arcsOf = (radius: number) => {
			const { points, radii } = kinked(30, radius);
			const round = roundKinks(points, radii, 3, KINK_BEND);
			return ringArcs(
				axisPath(round.points, round.radii, round.count, [1, 0, 0]),
				0,
				() => radius,
				tube,
				() => false,
			).length;
		};
		expect(ringTurn(0.3, tube)).toBeLessThan(ringTurn(0.02, tube));
		expect(ringTurn(0.02, tube)).toBe(tube.maxTurn);
		expect(arcsOf(0.3)).toBeGreaterThan(arcsOf(0.02));
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
		expect(density.foot).toBeLessThanOrEqual(FOOT_SPREAD);
	});

	it('splits into parts of 16-bit indices that hold every triangle as it was', () => {
		const mesh = report.mesh;
		expect(mesh.positions.length / 3).toBeGreaterThan(PART_VERTICES);
		const pieces = splitMesh(mesh);
		expect(pieces.length).toBeGreaterThan(1);
		let triangles = 0;
		let at = 0;
		let moved = 0;
		for (const piece of pieces) {
			expect(piece.indices).toBeInstanceOf(Uint16Array);
			expect(piece.positions.length / 3).toBeLessThanOrEqual(PART_VERTICES);
			for (let i = 0; i < piece.indices.length; i++, at++) {
				const from = (mesh.indices[at] as number) * 3;
				const to = (piece.indices[i] as number) * 3;
				for (let k = 0; k < 3; k++)
					if (piece.positions[to + k] !== mesh.positions[from + k]) moved++;
			}
			triangles += piece.indices.length / 3;
		}
		expect(moved).toBe(0);
		expect(triangles).toBe(mesh.indices.length / 3);
	});

	it(
		'stays within the cap of the nearest wood at every tier',
		() => {
			const caps = capsFor(record).lod0WoodBytes;
			for (const detail of DETAILS) {
				const mesh = meshWood({ ...testMeshInput(detail, skeleton), record }, 0);
				let bytes = 0;
				for (const part of quantiseParts(mesh, speciesBox(record), WOOD_UV_STEPS))
					for (const array of [
						part.positions,
						part.normals,
						part.uvs,
						part.uvs1,
						part.colors,
						part.indices,
					])
						bytes += array.byteLength;
				expect(bytes).toBeLessThan(caps[detail]);
			}
		},
		scaledBudget(30_000),
	);

	it('divides an axis into a fork where a codominant child leaves short of its end', () => {
		const count = skeleton.axes.count;
		let runOn = 0;
		for (const [key, parent] of report.parents)
			if (key >= count) {
				runOn++;
				// The wood that runs on past the fork rises from the end of the axis's own wood below it,
				// or, where it is the thinner arm, from the thick child that leads the fork.
				const axis = report.axisOf.get(key) as number;
				const from = report.axisOf.get(parent) as number;
				expect(from === axis || skeleton.axes.parent[from] === axis).toBe(true);
			}
		expect(runOn).toBeGreaterThan(0);
	});

	it('gives a dead stub the grown bark of the wood it stands on, not young bark', () => {
		const young = record.bark?.youngRadius ?? 0;
		let stubs = 0;
		for (const [key, rings] of report.axisRings) {
			const axis = report.axisOf.get(key) as number;
			if (axis < 0 || key !== axis) continue;
			if (((skeleton.flags[skeleton.axes.first[axis] as number] as number) & NODE_STUB) === 0)
				continue;
			stubs++;
			for (let i = 0; i < rings.vertices; i++)
				expect(rings.pipe[i] as number).toBeGreaterThanOrEqual(young);
		}
		expect(stubs).toBeGreaterThan(0);
	});

	it('keeps v within the 16 bits that hold it', () => {
		let most = 0;
		for (let i = 1; i < report.mesh.uvs.length; i += 2)
			most = Math.max(most, report.mesh.uvs[i] as number);
		expect(most).toBeLessThan(65535 / WOOD_UV_STEPS);
	});
});
