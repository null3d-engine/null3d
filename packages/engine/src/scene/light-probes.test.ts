import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import { Environment } from './environment';
import { toHalfFloat } from './half-float';
import {
	bakeProbes,
	FEWEST_PROBES,
	fibonacciDirections,
	gridBytes,
	gridTexels,
	LightProbeGridData,
	l1Irradiance,
	MOST_PROBES,
	PROBE_FLOATS,
	PROBE_MASK_SUBVOLUME,
	PROBE_SUBVOLUMES,
	packProbes,
	SceneLightProbeGrid,
	sampleGrid,
	VOLUME_TEXELS,
} from './light-probes';
import type { CoreMemory } from './memory';
import type { RaycastBatchHits } from './queries';
import type { Scene } from './scene';
import type { Texture, Textures } from './textures';

/** The probe grid's shader, which decides what the grid's values mean per pixel. */
const SHADER_FILE = join(
	import.meta.dir,
	'../../../../crates/null3d-shaders/wgsl/lib/probe_grid.wgsl',
);

test('fibonacci directions are unit length and spread evenly', () => {
	const count = 64;
	const directions = new Float32Array(count * 3);
	fibonacciDirections(count, directions);
	let sx = 0;
	let sy = 0;
	let sz = 0;
	for (let i = 0; i < count; i++) {
		const x = directions[i * 3] as number;
		const y = directions[i * 3 + 1] as number;
		const z = directions[i * 3 + 2] as number;
		expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
		sx += x;
		sy += y;
		sz += z;
	}
	// Evenly spread directions cancel out: every axis's mean is near zero.
	for (const axis of [sx, sy, sz]) expect(Math.abs(axis / count)).toBeLessThan(0.05);
});

test('the L0 coefficient lights every normal the same', () => {
	const coefficients = new Float32Array(PROBE_FLOATS);
	coefficients[0] = 1;
	coefficients[1] = 2;
	coefficients[2] = 4;
	const out = new Float32Array(3);
	l1Irradiance(coefficients, 0, 0, 1, 0, out);
	expect(out[0]).toBeCloseTo(0.886227, 5);
	expect(out[1]).toBeCloseTo(2 * 0.886227, 5);
	expect(out[2]).toBeCloseTo(4 * 0.886227, 5);
	// A normal that faces the other way gives the same light.
	l1Irradiance(coefficients, 0, 0, -1, 0, out);
	expect(out[0]).toBeCloseTo(0.886227, 5);
});

test('each L1 coefficient lights the normal along its own axis and darkens the opposite one', () => {
	// The shader's order: L1 along y, then z, then x.
	for (const [slot, axis] of [
		[3, 1],
		[6, 2],
		[9, 0],
	] as const) {
		const coefficients = new Float32Array(PROBE_FLOATS);
		coefficients[slot] = 1;
		const out = new Float32Array(3);
		for (let other = 0; other < 3; other++) {
			const normal: [number, number, number] = [0, 0, 0];
			normal[other] = 1;
			l1Irradiance(coefficients, 0, ...normal, out);
			expect(out[0]).toBeCloseTo(other === axis ? 1.023328 : 0, 5);
			normal[other] = -1;
			l1Irradiance(coefficients, 0, ...normal, out);
			expect(out[0]).toBeCloseTo(other === axis ? -1.023328 : 0, 5);
		}
	}
});

test('the CPU irradiance matches the shader formula for every axis and a diagonal', () => {
	// probe_grid.wgsl: c0 * 0.886227 + 2 * 0.511664 * (c1 * n.y + c2 * n.z + c3 * n.x), where c0
	// to c3 are the four RGB coefficients in order. Each term and channel has its own value, so a
	// swapped or missing term changes the result.
	const at = PROBE_FLOATS;
	const coefficients = new Float32Array(2 * PROBE_FLOATS);
	const terms = [
		[0.9, 1.3, 1.7],
		[0.31, -0.53, 0.71],
		[-0.43, 0.67, -0.29],
		[0.59, 0.23, -0.83],
	];
	for (let term = 0; term < 4; term++)
		for (let c = 0; c < 3; c++)
			coefficients[at + term * 3 + c] = (terms[term] as number[])[c] as number;
	const shader = (x: number, y: number, z: number, c: number) => {
		const [c0, c1, c2, c3] = terms.map((term) => term[c] as number) as number[];
		return (
			(c0 as number) * 0.886227 +
			2 * 0.511664 * ((c1 as number) * y + (c2 as number) * z + (c3 as number) * x)
		);
	};
	const d = 1 / Math.sqrt(14);
	const out = new Float32Array(3);
	for (const [x, y, z] of [
		[1, 0, 0],
		[-1, 0, 0],
		[0, 1, 0],
		[0, -1, 0],
		[0, 0, 1],
		[0, 0, -1],
		[d, 2 * d, -3 * d],
	] as const) {
		l1Irradiance(coefficients, at, x, y, z, out);
		for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(shader(x, y, z, c), 5);
	}
});

test('the shader keeps a grid in place at an intensity of 0, lighting nothing', () => {
	// probe_grid.wgsl runs only on a device, so its source is the thing to check: a grid's
	// presence comes from the scene's own marker and never from the intensity, so fading the
	// intensity to 0 fades the grid's light out and does not hand the environment's back.
	const source = readFileSync(SHADER_FILE, 'utf8');
	const presence = source.slice(
		source.indexOf('fn has_probe_grid'),
		source.indexOf('fn probe_grid_irradiance'),
	);
	expect(presence).toContain('grid.origin.w');
	expect(presence).not.toContain('grid.params');
	// The light itself takes the intensity, so 0 gives none of it.
	expect(source).toContain('* grid.params.x;');
});

test('packing puts each coefficient in its sub-volume and leaves the padding zero', () => {
	const counts = [2, 2, 2] as [number, number, number];
	const coefficients = new Float32Array(counts[0] * counts[1] * counts[2] * PROBE_FLOATS);
	// Probe (1, 0, 0) holds its twelve values, one per coefficient, and every probe its whole
	// weight and half the sky.
	for (let c = 0; c < PROBE_FLOATS; c++) coefficients[PROBE_FLOATS + c] = c + 1;
	const validity = new Float32Array(8).fill(1);
	const occlusion = new Float32Array(8).fill(0.5);
	const [w, h, d] = gridTexels(counts);
	expect([w, h, d]).toEqual([2, 2, PROBE_SUBVOLUMES * 4]);
	const texels = new Uint16Array(w * h * d * 4);
	packProbes(counts, coefficients, validity, occlusion, texels, toHalfFloat);
	const at = (x: number, y: number, z: number, c: number) =>
		texels[((z * h + y) * w + x) * 4 + c] as number;
	// Probe (1, 0, 0) sits one slice in, so its first texel is at x 1, y 0, z 1.
	for (let s = 0; s < PROBE_MASK_SUBVOLUME; s++)
		for (let c = 0; c < 4; c++)
			expect(at(1, 0, s * (counts[2] + 2) + 1, c)).toBe(toHalfFloat((s * 4 + c + 1) * 1));
	// The mask sub-volume holds the sky occlusion times the weight, and the weight itself.
	const mask = PROBE_MASK_SUBVOLUME * (counts[2] + 2) + 1;
	expect(at(1, 0, mask, 0)).toBe(toHalfFloat(0.5));
	expect(at(1, 0, mask, 1)).toBe(0);
	expect(at(1, 0, mask, 2)).toBe(0);
	expect(at(1, 0, mask, 3)).toBe(toHalfFloat(1));
	// Every padding slice is zero, at both ends of each sub-volume.
	for (let s = 0; s < PROBE_SUBVOLUMES; s++)
		for (let c = 0; c < 4; c++) {
			expect(at(1, 0, s * (counts[2] + 2), c)).toBe(0);
			expect(at(1, 0, s * (counts[2] + 2) + 3, c)).toBe(0);
		}
});

test('a probe without weight packs no light and no sky', () => {
	const counts = [2, 1, 1] as [number, number, number];
	const coefficients = new Float32Array(2 * PROBE_FLOATS).fill(1);
	const validity = new Float32Array([1, 0]);
	const occlusion = new Float32Array([1, 1]);
	const [w, h, d] = gridTexels(counts);
	const texels = new Uint16Array(w * h * d * 4);
	packProbes(counts, coefficients, validity, occlusion, texels, toHalfFloat);
	const at = (x: number, z: number, c: number) => texels[(z * h * w + x) * 4 + c] as number;
	// The first probe keeps its light; the second holds nothing, at any sub-volume.
	expect(at(0, 1, 0)).toBe(toHalfFloat(1));
	for (let s = 0; s < PROBE_SUBVOLUMES; s++)
		for (let c = 0; c < 4; c++) expect(at(1, s * (counts[2] + 2) + 1, c)).toBe(0);
});

test('a uniform grid gives every surface the same light as one probe does', () => {
	const counts = [3, 3, 3] as [number, number, number];
	const coefficients = new Float32Array(27 * PROBE_FLOATS);
	for (let p = 0; p < 27; p++) {
		coefficients[p * PROBE_FLOATS] = 1;
		coefficients[p * PROBE_FLOATS + 3] = 0.5;
	}
	const origin = new Float32Array([0, 0, 0]);
	const spacing = new Float32Array([1, 1, 1]);
	const grid = new LightProbeGridData(origin, spacing, counts, coefficients);
	const one = new Float32Array(3);
	l1Irradiance(coefficients, 0, 1, 0, 0, one);
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	const dark = new Float32Array(3);
	for (const [px, py, pz] of [
		[0, 0, 0],
		[1.4, 2.2, 0.6],
		[-5, 9, 9],
	])
		for (const normal of [
			[1, 0, 0],
			[0, 1, 0],
			[0.3, -0.7, 0.6],
		]) {
			l1Irradiance(
				coefficients,
				0,
				normal[0] as number,
				normal[1] as number,
				normal[2] as number,
				one,
			);
			sampleGrid(
				grid,
				px as number,
				py as number,
				pz as number,
				normal[0] as number,
				normal[1] as number,
				normal[2] as number,
				{ environment: dark },
				work,
				out,
			);
			expect(out[0]).toBeCloseTo(one[0] as number, 4);
			expect(out[1]).toBeCloseTo(one[1] as number, 4);
		}
});

test('the grid interpolates the light between two probes', () => {
	const counts = [FEWEST_PROBES, 1, 1] as [number, number, number];
	const coefficients = new Float32Array(2 * PROBE_FLOATS);
	coefficients[0] = 0; // the first probe is dark
	coefficients[PROBE_FLOATS] = 1; // the second is bright
	const origin = new Float32Array([0, 0, 0]);
	const spacing = new Float32Array([1, 1, 1]);
	const grid = new LightProbeGridData(origin, spacing, counts, coefficients);
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	const dark = new Float32Array(3);
	const at = (x: number) => {
		// The sample point moves half a spacing along +x, so the answer lags the position by 0.5.
		sampleGrid(grid, x, 0, 0, 1, 0, 0, { environment: dark }, work, out);
		return out[0] as number;
	};
	expect(at(-1)).toBeCloseTo(0, 5);
	expect(at(0)).toBeCloseTo(0.886227 / 2, 4); // sample point 0.5: halfway between the probes
	expect(at(0.6)).toBeCloseTo(0.886227, 4); // sample point 1.1, past the bright probe, clamps
});

test('the filter drops a probe that carries no weight and lights the surface from the rest', () => {
	// Two probes one apart: the first is bright, the second carries no weight. A sample twice as
	// near the second takes the first probe's whole light, not a fraction of it, because the
	// weight that the filtered light is divided by is the first probe's own share.
	const counts = [FEWEST_PROBES, 1, 1] as [number, number, number];
	const coefficients = new Float32Array(2 * PROBE_FLOATS);
	coefficients[0] = 1;
	const grid = new LightProbeGridData(
		new Float32Array([0, 0, 0]),
		new Float32Array([1, 1, 1]),
		counts,
		coefficients,
		new Float32Array([1, 0]),
	);
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	const dark = new Float32Array(3);
	// The sample point moves half a spacing along the normal, so 0.4 stands at the second probe's
	// quarter and takes a quarter of its weight, which the first probe makes up.
	sampleGrid(grid, 0.4, 0, 0, 1, 0, 0, { environment: dark }, work, out);
	expect(out[0]).toBeCloseTo(0.886227, 4);
	// With both probes holding their weight, the same place takes a tenth of the first probe's
	// light, because the sample point stands nine tenths of the way to the second.
	grid.validity.fill(1);
	sampleGrid(grid, 0.4, 0, 0, 1, 0, 0, { environment: dark }, work, out);
	expect(out[0]).toBeCloseTo(0.886227 / 10, 4);
});

test("a surface with no probe of weight around it takes the environment's own light", () => {
	const counts = [FEWEST_PROBES, 1, 1] as [number, number, number];
	const grid = new LightProbeGridData(
		new Float32Array([0, 0, 0]),
		new Float32Array([1, 1, 1]),
		counts,
		new Float32Array(2 * PROBE_FLOATS).fill(5),
		new Float32Array([0, 0]),
	);
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	sampleGrid(grid, 0.5, 0, 0, 0, 1, 0, { environment: [1, 2, 3] }, work, out);
	expect(Array.from(out)).toEqual([1, 2, 3]);
});

test("the sky term is the environment's light times the probes' share of the sky", () => {
	const counts = [FEWEST_PROBES, 1, 1] as [number, number, number];
	const grid = new LightProbeGridData(
		new Float32Array([0, 0, 0]),
		new Float32Array([1, 1, 1]),
		counts,
		new Float32Array(2 * PROBE_FLOATS),
		new Float32Array([1, 1]),
		new Float32Array([1, 0.5]),
	);
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	// The sample point moves half a spacing along -x, so a place at -0.5 stands on the first probe.
	sampleGrid(grid, -1, 0, 0, -1, 0, 0, { environment: [1, 2, 3] }, work, out);
	expect(out[0]).toBeCloseTo(1, 4);
	expect(out[1]).toBeCloseTo(2, 4);
	// A place halfway between the two probes takes half of each one's sky.
	sampleGrid(grid, 0.5, 0, 0, 0, 0, 0, { environment: [1, 2, 3] }, work, out);
	expect(out[0]).toBeCloseTo(0.75, 4);
	// The sky's brightness now against the bake's scales the bounce, and none of the sky.
	grid.coefficients[0] = 1;
	grid.skyOcclusion.fill(0);
	sampleGrid(grid, -1, 0, 0, -1, 0, 0, { environment: [1, 2, 3], skyScale: 0.5 }, work, out);
	expect(out[0]).toBeCloseTo(0.886227 * 0.5, 4);
});

test('the byte count is 32 per probe plus the padding slices', () => {
	expect(gridBytes([2, 2, 2])).toBe(2 * 2 * 16 * 8);
	expect(gridBytes([16, 4, 16])).toBe(16 * 4 * (PROBE_SUBVOLUMES * 18) * 8);
});

test('the documented bake passes its grid to the grid setter as it is, and spaces probes by meters', () => {
	setErrorFixes(ERROR_FIXES);
	// A scene whose rays all reach the sky, and a core that records the grid's values.
	const scene = {
		raycastBatch(_rays: Float32Array, _options: unknown, hits: RaycastBatchHits) {
			hits.distances.fill(-1);
		},
	} as unknown as Scene;
	const block = new Float32Array(C.LIGHT_PROBE_VALUE_COUNT);
	const handles: number[] = [];
	const core = {
		generation: 0,
		f32: () => block,
		check: (status: number) => status,
		glue: {
			lightProbeValues: () => 0,
			setLightProbeGrid(texture: number) {
				handles.push(texture);
				return 0;
			},
		},
		holdViews: () => {},
	} as unknown as CoreMemory;
	const volumes: number[][] = [];
	const textures = {
		fromVolumeData(width: number, height: number, depth: number, format: string) {
			volumes.push([width, height, depth, format === 'rgba16float' ? 1 : 0]);
			return { handle: 5 } as unknown as Texture;
		},
	} as unknown as Textures;
	const sh = new Float32Array(27);
	sh[0] = 1;
	// The calls of the scene page's bake example.
	const grey = [0.8, 0.8, 0.8] as const;
	const bake = bakeProbes(scene, {
		box: { min: [-12, 0, -12], max: [12, 8, 12] },
		spacing: [1, 2, 1],
		environment: environmentOf(sh),
		albedo: () => grey,
	});
	let baking = true;
	for (let frame = 0; frame < 10000 && baking; frame++) if (bake.step(4096)) baking = false;
	expect(baking).toBe(false);
	const grid = bake.grid;
	expect(grid.counts).toEqual([25, 5, 25]);
	new SceneLightProbeGrid(core).set({
		texture: grid.toTexture(textures),
		origin: grid.origin,
		spacing: grid.spacing,
		counts: grid.counts,
		skyLuminance: grid.skyLuminance,
	});
	expect(handles).toEqual([5]);
	// The texture is a 3D texture of half floats, which the frame's group binds.
	expect(volumes[0]).toEqual([25, 5, PROBE_SUBVOLUMES * (25 + 2), 1]);
	const at = (offset: number) => Array.from(block.subarray(offset, offset + 3));
	expect(at(C.LIGHT_PROBE_VALUE_ORIGIN)).toEqual([-12, 0, -12]);
	expect(at(C.LIGHT_PROBE_VALUE_SPACING)).toEqual([1, 2, 1]);
	expect(at(C.LIGHT_PROBE_VALUE_COUNTS)).toEqual([25, 5, 25]);
	// The bake carries the sky's brightness into the values, so a day cycle can scale its bounce.
	expect(block[C.LIGHT_PROBE_VALUE_SKY_LUMINANCE]).toBeCloseTo(0.2126, 4);
	// The development check still refuses a value that is not three finite numbers.
	expect(() =>
		new SceneLightProbeGrid(core).set({
			texture: grid.toTexture(textures),
			origin: new Float32Array([0, Number.NaN, 0]),
			spacing: grid.spacing,
			counts: grid.counts,
		}),
	).toThrow('E1203');
});

/** An environment whose diffuse light has the nine RGB coefficients `sh`. */
function environmentOf(sh: Float32Array): Environment {
	return new Environment({ handle: 1 } as unknown as Texture, 1, 1, 'rgb9e5ufloat', sh);
}

/**
 * Bakes one probe at the origin with 1024 directions, in a scene whose rays all reach the sky, or
 * all hit a surface 1 m away when `albedo` is given.
 */
function bakeGrid(
	sh: Float32Array,
	options: {
		intensity?: number;
		rotation?: [number, number, number];
		albedo?: number;
		sky?: number;
	} = {},
): LightProbeGridData {
	const scene = {
		raycastBatch(_rays: Float32Array, _options: unknown, hits: RaycastBatchHits) {
			// The validity test's six rays reach only around the probe, and meet nothing here.
			if (hits.distances.length === 6) {
				hits.distances.fill(-1);
				return;
			}
			// `sky` is the share of the rays that reach the sky; the rest hit a surface 1 m away. A
			// bake with an albedo puts every ray on a surface unless the test says otherwise.
			const sky = options.sky ?? (options.albedo === undefined ? 1 : 0);
			const misses = Math.round(sky * hits.distances.length);
			hits.distances.fill(1);
			hits.distances.fill(-1, 0, misses);
			const normals = hits.normals as Float32Array;
			normals.fill(0);
			for (let s = 0; s < hits.distances.length; s++) normals[s * 3 + 1] = 1;
		},
	} as unknown as Scene;
	const albedo = options.albedo;
	const colour = [albedo ?? 0, albedo ?? 0, albedo ?? 0] as const;
	return bakeProbes(scene, {
		box: { min: [0, 0, 0], max: [0.01, 0.01, 0.01] },
		samples: 1024,
		environment: environmentOf(sh),
		environmentOptions: { intensity: options.intensity, rotation: options.rotation },
		albedo: albedo === undefined ? undefined : () => colour,
	}).finish();
}

/** The grid's irradiance at a unit normal, with the environment's light at that normal supplied. */
function probeLight(
	grid: LightProbeGridData,
	environment: ArrayLike<number>,
	x: number,
	y: number,
	z: number,
): number[] {
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	sampleGrid(grid, 0, 0, 0, x, y, z, { environment }, work, out);
	return Array.from(out);
}

/** The probe's own baked light at a unit normal, which carries no sky. */
function bounceLight(grid: LightProbeGridData, x: number, y: number, z: number): number[] {
	const out = new Float32Array(3);
	l1Irradiance(grid.coefficients, 0, x, y, z, out);
	return Array.from(out);
}

const AXES = [
	[1, 0, 0],
	[-1, 0, 0],
	[0, 1, 0],
	[0, -1, 0],
	[0, 0, 1],
	[0, 0, -1],
] as const;

test("a probe under an open sky sees all of it, so its light is the environment's own", () => {
	const sh = new Float32Array(27);
	sh.set([1, 2, 3]);
	const grid = bakeGrid(sh);
	expect(grid.skyOcclusion[0] as number).toBeCloseTo(1, 5);
	for (const [x, y, z] of AXES) {
		const [r, g, b] = probeLight(grid, [1, 2, 3], x, y, z) as [number, number, number];
		expect(r).toBeCloseTo(1, 2);
		expect(g).toBeCloseTo(2, 2);
		expect(b).toBeCloseTo(3, 2);
	}
	// The probes themselves hold no sky: the light is the live environment's, so a sky that moves
	// needs no new bake.
	expect(bounceLight(grid, 0, 1, 0)[0]).toBeCloseTo(0, 5);
});

test('a probe sees the share of the sky that its rays reach', () => {
	const sh = new Float32Array(27);
	sh.set([1, 2, 3]);
	const grid = bakeGrid(sh, { sky: 0.25 });
	expect(grid.skyOcclusion[0] as number).toBeCloseTo(0.25, 2);
	expect(probeLight(grid, [1, 2, 3], 0, 1, 0)[0]).toBeCloseTo(0.25, 2);
});

test('a probe with no sky light takes none of the environment', () => {
	const sh = new Float32Array(27);
	sh.set([1, 2, 3]);
	const grid = bakeGrid(sh, { sky: 0 });
	expect(grid.skyOcclusion[0] as number).toBeCloseTo(0, 5);
	expect(probeLight(grid, [1, 2, 3], 0, 1, 0)[0]).toBeCloseTo(0, 5);
});

test("a probe enclosed by matte surfaces takes their albedo times the sky's irradiance", () => {
	const sh = new Float32Array(27);
	sh.fill(1, 0, 3);
	const grid = bakeGrid(sh, { albedo: 0.5 });
	// Each wall sends back albedo * E / pi, which the probe turns into albedo * E again.
	for (const [x, y, z] of AXES)
		expect(bounceLight(grid, x, y, z)[0]).toBeCloseTo(0.5 * 0.886227, 2);
});

test("the bounce takes the environment's rotation and intensity", () => {
	// Light from the map's +x. A quarter turn about z turns the world's +y, which every hit faces,
	// toward the map's +x, and intensity 2 doubles the light.
	const sh = new Float32Array(27);
	sh[0] = 1;
	sh[9] = 1;
	sh[10] = 1;
	sh[11] = 1;
	const plain = bakeGrid(sh, { albedo: 0.5 });
	expect(bounceLight(plain, 0, 1, 0)[0]).toBeCloseTo(0.5 * 0.886227, 2);
	const turned = bakeGrid(sh, { albedo: 0.5, intensity: 2, rotation: [0, 0, Math.PI / 2] });
	expect(bounceLight(turned, 0, 1, 0)[0]).toBeCloseTo(2 * 0.5 * (0.886227 + 1.023328), 2);
});

test('a probe in geometry loses its weight, and one in the open keeps it', () => {
	const bake = (wall: boolean) => {
		const scene = {
			raycastBatch(_rays: Float32Array, _options: unknown, hits: RaycastBatchHits) {
				const rays = hits.distances.length;
				hits.distances.fill(-1);
				if (!wall || rays !== 6) return;
				// The validity rays travel inward from 1.5 m, and a surface 0.1 m from the probe on
				// each side of x leaves it a gap of 0.2 m, narrower than the grid's spacing.
				hits.distances[0] = 1.4;
				hits.distances[1] = 1.4;
			},
		} as unknown as Scene;
		return bakeProbes(scene, {
			box: { min: [0, 0, 0], max: [0.01, 0.01, 0.01] },
			spacing: 1,
			distance: 4,
			samples: 8,
		}).finish();
	};
	expect(bake(true).validity[0]).toBe(0);
	expect(bake(false).validity[0]).toBe(1);
});

test('a grid fits the 3D texture size that the core allows, and the bake refuses one that does not', () => {
	setErrorFixes(ERROR_FIXES);
	const caps = readFileSync(
		new URL('../../../../crates/null3d-gpu/src/caps.rs', import.meta.url),
		'utf8',
	);
	expect(caps).toContain(`pub const TEXTURE_3D_SIZE: u32 = ${VOLUME_TEXELS};`);
	expect(gridTexels(MOST_PROBES).every((side) => side <= VOLUME_TEXELS)).toBe(true);
	const scene = {} as unknown as Scene;
	// A box whose depth fits one probe more than the most along z, then exactly the most.
	const z = MOST_PROBES[2] * 0.5;
	expect(() =>
		bakeProbes(scene, { box: { min: [0, 0, 0], max: [1, 1, z] }, spacing: 0.5 }),
	).toThrow('E1108');
	expect(() =>
		bakeProbes(scene, { box: { min: [0, 0, 0], max: [1, 1, z - 0.5] }, spacing: 0.5 }),
	).not.toThrow();
});
