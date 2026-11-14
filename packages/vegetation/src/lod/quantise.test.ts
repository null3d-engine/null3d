// The quantiser: positions in the species box's 16-bit steps, and, for a part of small shapes, the
// rest of each position below one step in the texture coordinates, which the plant shader adds back.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { MeshArrays } from '../asset';
import type { SpeciesBox } from '../core/box';
import { dequantisePosition, quantise, REST_STEPS, TEXTURE_UV_STEPS } from './quantise';

/** A tree's box: steps near a millimetre across the ground and half that up the height. */
const BOX: SpeciesBox = { min: [-28.5, -3.5, -28.5], max: [28.5, 27, 28.5] };

/** Points of an acorn's ring, 7 mm round a point out in a crown. */
function ring(count: number): MeshArrays {
	const positions: number[] = [];
	for (let k = 0; k < count; k++) {
		const a = (2 * Math.PI * k) / count;
		positions.push(-15.2 + 0.007 * Math.cos(a), 7.4, 6.1 + 0.007 * Math.sin(a));
	}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(count * 3),
		uvs: new Float32Array(count * 2).fill(0.25),
		uvs1: new Float32Array(count * 2),
		colors: new Uint8Array(count * 4),
		indices: new Uint16Array(0),
	};
}

/** The largest distance, in metres, from a part's dequantised points to the points it was made from. */
function worst(mesh: MeshArrays, uvs?: Uint16Array, positions?: Uint16Array): number {
	const out: [number, number, number] = [0, 0, 0];
	let most = 0;
	for (let i = 0; i < mesh.positions.length / 3; i++) {
		dequantisePosition(positions as Uint16Array, i, BOX, out, uvs);
		for (let k = 0; k < 3; k++)
			most = Math.max(most, Math.abs((out[k] as number) - (mesh.positions[i * 3 + k] as number)));
	}
	return most;
}

describe('the quantiser', () => {
	const mesh = ring(24);
	const step = (BOX.max[0] - BOX.min[0]) / 65535;

	it('holds a position to half a step of the species box', () => {
		const plain = quantise(mesh, BOX, TEXTURE_UV_STEPS);
		// Half a step of a 57 m box is near half a millimetre: a fifteenth of an acorn's radius.
		expect(worst(mesh, undefined, plain.positions)).toBeLessThanOrEqual(step / 2 + 1e-9);
		expect(worst(mesh, undefined, plain.positions)).toBeGreaterThan(step / 4);
		// The texture coordinates keep their own steps.
		expect(plain.uvs[0]).toBe(Math.round(0.25 * TEXTURE_UV_STEPS));
	});

	it("keeps a part's position rest to a 255th of a step in its texture coordinates", () => {
		const rested = quantise(mesh, BOX, TEXTURE_UV_STEPS, true);
		// The steps are the same; the rest, read back, brings each point within a 255th of a step.
		expect(Array.from(rested.positions)).toEqual(
			Array.from(quantise(mesh, BOX, TEXTURE_UV_STEPS).positions),
		);
		expect(worst(mesh, rested.uvs, rested.positions)).toBeLessThanOrEqual(
			step / REST_STEPS / 2 + 1e-7,
		);
		// The second number's low byte is unused.
		for (let i = 1; i < rested.uvs.length; i += 2) expect((rested.uvs[i] as number) & 255).toBe(0);
	});

	it('writes the rest in the layout the plant shader reads', () => {
		const wgsl = readFileSync(new URL('../render/plant.wgsl', import.meta.url), 'utf8');
		expect(wgsl).toContain(`const REST_STEPS: f32 = ${REST_STEPS}.0;`);
		expect(wgsl).toContain('let codes = vec3f(f32(xy >> 8u), f32(xy & 255u), f32(z >> 8u));');
	});
});
