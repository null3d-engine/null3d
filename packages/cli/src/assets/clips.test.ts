import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Accessor, type AnimationSampler, type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { samplePath } from '../../../../tools/lib/samples.ts';
import { encodeOnce, encoderPool } from './encoder-pool.js';
import { MSFTLod } from './lod-extension.js';
import { DEFAULT_OPTIONS, optimizeModel } from './pipeline.js';
import { Null3dMeshBvh, Null3dOccluder } from './spatial-extensions.js';

// Texture encodes take seconds each on a busy machine or a CI runner of four cores.
setDefaultTimeout(60_000);

const pool = encoderPool(2);
const encode = encodeOnce((job) => pool.encode(job));
afterAll(() => pool.close());

const scratch = mkdtempSync(join(tmpdir(), 'null3d-clips-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Small textures, since these tests read only the clips. */
const OPTIONS = { ...DEFAULT_OPTIONS, maxTextureSize: 32 };

/**
 * Fox's Run clip lies on no grid; InterpolationTest has step, linear and cubic spline keys; the
 * Knight has 76 clips with many constant tracks.
 */
const MODELS = [
	samplePath('sources/characters/kaykit-knight/Knight.glb'),
	samplePath('sources/khronos/Fox/glTF-Binary/Fox.glb'),
	samplePath('sources/khronos/InterpolationTest/glTF-Binary/InterpolationTest.glb'),
];

const io = async () => {
	await MeshoptDecoder.ready;
	return new NodeIO()
		.registerExtensions([...ALL_EXTENSIONS, MSFTLod, Null3dOccluder, Null3dMeshBvh])
		.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
};

/** An output as glTF-Transform reads it, written to a folder with its texture files. */
async function readOutput(model: { glb: Uint8Array; files: Map<string, Uint8Array> }) {
	const folder = mkdtempSync(join(scratch, 'read-'));
	mkdirSync(join(folder, 'textures'));
	for (const [name, bytes] of model.files) writeFileSync(join(folder, 'textures', name), bytes);
	writeFileSync(join(folder, 'model.glb'), model.glb);
	return (await io()).read(join(folder, 'model.glb'));
}

/** The JSON of a binary glTF file. */
function glbJson(glb: Uint8Array) {
	const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
	return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

/** An accessor's values, with normalized integers as fractions. */
function floats(accessor: Accessor): number[] {
	const array = Array.from(accessor.getArray() as ArrayLike<number>);
	return accessor.getNormalized() ? array.map((v) => Math.max(v / 32767, -1)) : array;
}

/**
 * A sampler's value at `time`, as glTF defines it and three.js evaluates it: the first key before
 * the first time, the last after the last, the key at or before for step keys, slerp for linear
 * rotations, and the Hermite curve for cubic spline keys, with tangents scaled by the time
 * between keys.
 */
function evaluate(sampler: AnimationSampler, path: string, time: number): number[] {
	const { times, values } = keysOf(sampler);
	const interpolation = sampler.getInterpolation();
	const parts = interpolation === 'CUBICSPLINE' ? 3 : 1;
	const n = values.length / times.length / parts;
	const value = (k: number, part = parts === 3 ? 1 : 0) =>
		values.slice((k * parts + part) * n, (k * parts + part + 1) * n);
	const last = times.length - 1;
	// A key a rounding step after the time counts as reached, as the engine core takes it.
	const reached = time + Math.abs(time) * 1e-6;
	if (reached < (times[0] as number)) return value(0);
	let k = 0;
	while (k < last && (times[k + 1] as number) <= reached) k++;
	if (k === last || interpolation === 'STEP') return value(k);
	const [t0, t1] = [times[k] as number, times[k + 1] as number];
	const a = Math.min(Math.max((time - t0) / (t1 - t0), 0), 1);
	if (interpolation === 'CUBICSPLINE') {
		const span = t1 - t0;
		const [a2, a3] = [a * a, a * a * a];
		const out = value(k).map(
			(v0, c) =>
				(2 * a3 - 3 * a2 + 1) * v0 +
				(a3 - 2 * a2 + a) * (value(k, 2)[c] as number) * span +
				(-2 * a3 + 3 * a2) * (value(k + 1)[c] as number) +
				(a3 - a2) * (value(k + 1, 0)[c] as number) * span,
		);
		return path === 'rotation' ? normalize(out) : out;
	}
	const [p, q] = [value(k), value(k + 1)];
	if (path !== 'rotation') return p.map((v, c) => v + ((q[c] as number) - v) * a);
	const dot = p.reduce((sum, v, c) => sum + v * (q[c] as number), 0);
	const sign = dot < 0 ? -1 : 1;
	const angle = Math.acos(Math.min(Math.abs(dot), 1));
	if (angle < 1e-9) return normalize(p);
	const [s, u] = [Math.sin((1 - a) * angle), Math.sin(a * angle)];
	return normalize(p.map((v, c) => (v * s + sign * (q[c] as number) * u) / Math.sin(angle)));
}

/** A sampler's key times and values, read once. */
const keysOf = (() => {
	const read = new Map<AnimationSampler, { times: number[]; values: number[] }>();
	return (sampler: AnimationSampler) => {
		let keys = read.get(sampler);
		if (!keys) {
			keys = {
				times: floats(sampler.getInput() as Accessor),
				values: floats(sampler.getOutput() as Accessor),
			};
			read.set(sampler, keys);
		}
		return keys;
	};
})();

const normalize = (q: number[]) => {
	const length = Math.hypot(...q);
	return q.map((v) => v / length);
};

/** The largest difference between two values of a path; a rotation and its negation are one. */
function difference(path: string, a: readonly number[], b: readonly number[]): number {
	const plain = Math.max(...a.map((v, c) => Math.abs(v - (b[c] as number))));
	if (path !== 'rotation') return plain / Math.max(1, ...b.map(Math.abs));
	return Math.min(plain, Math.max(...a.map((v, c) => Math.abs(v + (b[c] as number)))));
}

/** The animations of a document, with each channel's path and sampler. */
const channelsOf = (doc: Document) =>
	doc
		.getRoot()
		.listAnimations()
		.map((animation) =>
			animation.listChannels().map((channel) => ({
				path: channel.getTargetPath() as string,
				sampler: channel.getSampler() as AnimationSampler,
			})),
		);

describe('the clip step', async () => {
	const runs = await Promise.all(
		MODELS.map(async (path) => {
			const [source, model, again] = await Promise.all([
				(await io()).read(path),
				optimizeModel(path, OPTIONS, encode),
				optimizeModel(path, OPTIONS, encode),
			]);
			return { path, source, model, again, output: await readOutput(model) };
		}),
	);

	it('stores keys that follow the source curves at the frames, within a 16-bit step', () => {
		for (const { path, source, output } of runs) {
			const before = channelsOf(source);
			const after = channelsOf(output);
			expect(after.map((a) => a.length)).toEqual(before.map((a) => a.length));
			after.forEach((channels, a) => {
				const grid = channels.find((c) => c.sampler.getInput()?.getCount() !== 1)?.sampler;
				const times = grid ? floats(grid.getInput() as Accessor) : [];
				const end = times.at(-1) ?? 0;
				let largest = 0;
				const sources = before[a] as typeof channels;
				channels.forEach(({ path: target, sampler }, c) => {
					const { sampler: original, path: sourcePath } = sources[c] as (typeof channels)[number];
					expect(target).toBe(sourcePath);
					expect(sampler.getInterpolation()).toBe(
						original.getInterpolation() === 'STEP' ? 'STEP' : 'LINEAR',
					);
					const keys = keysOf(sampler).values;
					const n = keys.length / (sampler.getInput() as Accessor).getCount();
					for (const [k, time] of times.entries()) {
						const key = keys.length === n ? keys : keys.slice(k * n, k * n + n);
						const want = evaluate(original, target, time);
						largest = Math.max(largest, difference(target, key, want));
					}
				});
				// One step of a 16-bit rotation component is 3.1e-5; the quaternion filter rebuilds
				// the largest component from the others.
				expect(largest, `${path} animation ${a}`).toBeLessThan(1e-4);
				// Every changing track shares the clip's frames, evenly spaced. Off a grid of up to 30
				// keys a second, the rate is 30, raised a little so that the last key falls on the end.
				for (const { sampler } of channels) {
					const input = sampler.getInput() as Accessor;
					if (input.getCount() === 1) expect(floats(input)).toEqual([end]);
					else expect(input).toBe(grid?.getInput() as Accessor);
				}
				expect(times.length - 1).toBeLessThanOrEqual(Math.ceil(end * 30));
				const step = end / (times.length - 1);
				for (const [k, time] of times.entries()) expect(time).toBeCloseTo(k * step, 5);
			});
		}
	});

	it('keeps a constant track as one key, and drops no track', () => {
		for (const { source, output } of runs) {
			const before = channelsOf(source).flat();
			const after = channelsOf(output).flat();
			expect(after).toHaveLength(before.length);
			after.forEach(({ path, sampler }, c) => {
				const original = (before[c] as (typeof after)[number]).sampler;
				const keys = floats(original.getOutput() as Accessor);
				const n = path === 'rotation' ? 4 : 3;
				const changes = keys.some((v, i) => v !== keys[i % n]);
				if (original.getInterpolation() !== 'CUBICSPLINE' && !changes)
					expect((sampler.getInput() as Accessor).getCount()).toBe(1);
			});
		}
		const knight = channelsOf((runs[0] as (typeof runs)[number]).output).flat();
		const constant = knight.filter(({ sampler }) => sampler.getInput()?.getCount() === 1);
		expect(constant.length).toBeGreaterThan(knight.length / 2);
	});

	it("stores changing rotations in 16 bits with meshopt's quaternion filter, and nothing else lossy", () => {
		for (const { output, model } of runs) {
			for (const { path, sampler } of channelsOf(output).flat()) {
				const keys = sampler.getOutput() as Accessor;
				const changing = keys.getCount() > 1;
				if (path === 'rotation' && changing) {
					expect(keys.getArray()).toBeInstanceOf(Int16Array);
					expect(keys.getNormalized()).toBe(true);
				} else expect(keys.getArray()).toBeInstanceOf(Float32Array);
			}
			const json = glbJson(model.glb);
			const filters = (json.bufferViews as { extensions?: Record<string, { filter?: string }> }[])
				.map((view) => view.extensions?.EXT_meshopt_compression?.filter)
				.filter((filter) => filter !== undefined);
			expect(filters).toEqual(['QUATERNION']);
		}
	});

	it('writes the same bytes on two runs', () => {
		for (const { model, again } of runs) expect(Buffer.compare(model.glb, again.glb)).toBe(0);
	});
});
