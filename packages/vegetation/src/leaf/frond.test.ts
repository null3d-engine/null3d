// The frond builder: a frond's ages, the rachis's droop and coil, the pinnae's places, the outline
// drawn from the pinnae, the sheet that never tears between pinnae, the pinnae's droop and the V of
// their pinnules, and the kit's whole frond on its stipe at every tier.
import { describe, expect, it } from 'bun:test';
import { radians } from '../core/math';
import type { FrondShape } from '../core/record';
import { noTextureFiles } from '../core/textures';
import { curveAt, DETAILS } from '../core/types';
import { brackenRecord } from '../grow/bracken.fixture';
import { axisPath } from '../wood/frames';
import {
	builder,
	FrondBlade,
	frondAge,
	frondCut,
	frondOutline,
	MATURE_AGE,
	pinnaPlaces,
	rachisBend,
	rachisCurve,
} from './frond';
import { signedArea } from './outline';

const shape = (brackenRecord.growth as { frond: FrondShape }).frond;
const pinnae = shape.pinnae as NonNullable<FrondShape['pinnae']>;
const mature = frondAge(MATURE_AGE);

/** A straight rachis up +Y, its upper face toward +Z. */
function straightPath(length: number) {
	return axisPath(
		new Float64Array([0, 0, 0, 0, length, 0]),
		new Float64Array([0.003, 0.001]),
		2,
		[0, 0, 1],
	);
}

/** A point of the flat blade placed by a blade. */
function placed(blade: FrondBlade, x: number, y: number): [number, number, number] {
	const out = { at: [0, 0, 0] as [number, number, number], share: 0, brown: 0 };
	blade.place(x, y, out);
	return [out.at[0], out.at[1], out.at[2]];
}

describe('a frond', () => {
	it('reads its age as how far it has unrolled and browned', () => {
		expect(frondAge(0)).toEqual({ unrolled: 0, brown: 0 });
		expect(frondAge(0.25)).toEqual({ unrolled: 0.5, brown: 0 });
		expect(frondAge(MATURE_AGE)).toEqual({ unrolled: 1, brown: 0 });
		expect(frondAge(1)).toEqual({ unrolled: 1, brown: 1 });
	});

	it('droops its rachis by the record when mature, and coils a crozier toward its upper face', () => {
		for (const t of [0, 0.3, 0.7, 1])
			expect(rachisBend(shape, mature, t)).toBeCloseTo(radians(curveAt(shape.droop, t)), 6);
		const young = frondAge(0.15);
		expect(rachisBend(shape, young, 1)).toBeLessThan(-Math.PI * 2);
		// The bend runs on without a jump where the unrolled part meets the coil.
		const u = young.unrolled;
		expect(Math.abs(rachisBend(shape, young, u + 1e-6) - rachisBend(shape, young, u))).toBeLessThan(
			1e-3,
		);
		// A dead frond slumps further than a mature one.
		expect(rachisBend(shape, frondAge(1), 1)).toBeGreaterThan(rachisBend(shape, mature, 1));
	});

	it('lays the rachis out at its full length, and rolls a crozier up near its base', () => {
		const length = 0.6;
		for (const age of [mature, frondAge(0.1)]) {
			const curve = rachisCurve(shape, age, length);
			let arc = 0;
			for (let i = 3; i < curve.length; i += 3)
				arc += Math.hypot(
					(curve[i] as number) - (curve[i - 3] as number),
					(curve[i + 1] as number) - (curve[i - 2] as number),
				);
			expect(arc).toBeGreaterThan(length * 0.97);
			expect(arc).toBeLessThan(length * 1.001);
		}
		const coil = rachisCurve(shape, frondAge(0.05), length);
		const tip = coil.length - 3;
		expect(Math.hypot(coil[tip] as number, coil[tip + 1] as number)).toBeLessThan(length * 0.4);
	});

	it('spaces the pinnae by their length, closer toward the tip', () => {
		const places = pinnaPlaces(pinnae);
		expect(places).toHaveLength(12);
		expect(places[0]).toBe(0);
		for (let k = 1; k < places.length; k++)
			expect(places[k] as number).toBeGreaterThan(places[k - 1] as number);
		const first = (places[1] as number) - (places[0] as number);
		const last = (places[11] as number) - (places[10] as number);
		expect(last).toBeLessThan(first);
	});

	it('draws an outline from its pinnae, counter-clockwise, inside the texture', () => {
		const outline = frondOutline(shape);
		expect(signedArea(outline.points)).toBeGreaterThan(0);
		for (const value of outline.points) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});

	it('carries the flat blade into space without a tear, between pinnae or anywhere', () => {
		const length = 0.6;
		for (const age of [mature, frondAge(0.2), frondAge(1)]) {
			const blade = new FrondBlade(shape, age, straightPath(length), 1);
			// A tear would move a point by centimetres for a step of a tenth of a millimetre.
			const step = 0.0001;
			let worst = 0;
			for (let y = -0.02; y < length + 0.02; y += 0.005)
				for (let x = -0.35; x <= 0.35; x += 0.005) {
					const p = placed(blade, x, y);
					const across = placed(blade, x + step, y);
					const along = placed(blade, x, y + step);
					worst = Math.max(
						worst,
						Math.hypot(across[0] - p[0], across[1] - p[1], across[2] - p[2]),
						Math.hypot(along[0] - p[0], along[1] - p[1], along[2] - p[2]),
					);
				}
			expect(worst).toBeLessThan(0.002);
		}
	});

	it('droops a mature pinna away from its upper face, and curls a young one toward it', () => {
		const length = 0.6;
		const y = 0.1;
		const reach = curveAt(pinnae.length, y / length) * length;
		const angle = radians(curveAt(pinnae.angle, y / length));
		const x = Math.sin(angle) * reach;
		const tipY = y + Math.cos(angle) * reach;
		const grown = new FrondBlade(shape, mature, straightPath(length), 0);
		expect(placed(grown, x, tipY)[2]).toBeLessThan(-0.02);
		const young = new FrondBlade(shape, frondAge(0.05), straightPath(length), 0);
		expect(placed(young, x, tipY)[2]).toBeGreaterThan(0.01);
	});

	it('lifts the pinnules between two pinnae into a V about each costa', () => {
		const length = 0.6;
		const places = pinnaPlaces(pinnae);
		const k = 3;
		const costa = (places[k] as number) * length;
		const between = (((places[k] as number) + (places[k + 1] as number)) / 2) * length;
		const folded = new FrondBlade(shape, mature, straightPath(length), 1);
		const flat = new FrondBlade(shape, mature, straightPath(length), 0);
		const x = 0.05;
		const angle = radians(curveAt(pinnae.angle, between / length));
		const y = between + (x * Math.cos(angle)) / Math.sin(angle);
		const lift = placed(folded, x, y)[2] - placed(flat, x, y)[2];
		expect(lift).toBeGreaterThan(0.001);
		const yOn = costa + (x * Math.cos(angle)) / Math.sin(angle);
		expect(Math.abs(placed(folded, x, yOn)[2] - placed(flat, x, yOn)[2])).toBeLessThan(lift / 2);
	});

	it('builds the kit a whole frond on its stipe at every tier, finer at each', () => {
		const manifest = noTextureFiles('bracken').manifest;
		let previous = 0;
		for (const detail of DETAILS) {
			const [leaf] = builder.leaves(brackenRecord, manifest, detail);
			if (!leaf) throw new Error('no frond');
			const triangles = leaf.indices.length / 3;
			expect(triangles).toBeGreaterThan(previous);
			previous = triangles;
			let top = 0;
			let stems = 0;
			let up = 0;
			for (let i = 0; i < leaf.positions.length / 3; i++) {
				top = Math.max(top, leaf.positions[i * 3 + 1] as number);
				// The stipe's tube writes no second coordinates; the blade writes its metres.
				if (leaf.uvs1[i * 2] === 0 && leaf.uvs1[i * 2 + 1] === 0) stems++;
				else up += leaf.normals[i * 3 + 2] as number;
			}
			expect(stems).toBeGreaterThan(0);
			expect(up).toBeGreaterThan(0);
			expect(top).toBeGreaterThan(0.85 + 0.66 * 0.9);
		}
	});

	it('cuts fewer rows for the card levels', () => {
		for (const detail of DETAILS) {
			expect(frondCut(detail, 1).rows).toBeLessThan(frondCut(detail, 0).rows);
			expect(frondCut(detail, 2).rows).toBeLessThanOrEqual(frondCut(detail, 1).rows);
		}
	});
});
