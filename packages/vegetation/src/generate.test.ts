import { describe, expect, test } from 'bun:test';
import type { PlantAsset } from './asset';
import { ALL_SPECIES, builtInSpecies } from './builtin';
import { generatePlant, generateVariantSet } from './generate';
import { run } from './generate-task';
import type { Species } from './species';

/** Every typed array in an asset, minus the timing, for a byte comparison. */
function arraysOf(asset: PlantAsset): (Float32Array | Uint8Array | Uint16Array | Uint32Array)[] {
	const arrays: (Float32Array | Uint8Array | Uint16Array | Uint32Array)[] = [];
	for (const level of asset.levels)
		for (const part of level.parts)
			arrays.push(
				part.arrays.positions,
				part.arrays.normals,
				part.arrays.uvs,
				part.arrays.colors,
				...(part.arrays.targets ? [part.arrays.targets] : []),
				part.arrays.indices,
			);
	arrays.push(asset.wind.pivots);
	return arrays;
}

/** Whether two typed arrays hold the same bytes. */
function sameBytes(
	a: Float32Array | Uint8Array | Uint16Array | Uint32Array,
	b: Float32Array | Uint8Array | Uint16Array | Uint32Array,
): boolean {
	if (a.length !== b.length) return false;
	const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
	const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
	for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
	return true;
}

const oak = builtInSpecies('oak') as Species;

describe('the generator', () => {
	test('grows the same plant from the same seed and variant', () => {
		const first = generatePlant(oak, { seed: 7, variant: 2 });
		const second = generatePlant(oak, { seed: 7, variant: 2 });
		const left = arraysOf(first);
		const right = arraysOf(second);
		expect(left.length).toBe(right.length);
		for (let i = 0; i < left.length; i++)
			expect(sameBytes(left[i] as Float32Array, right[i] as Float32Array)).toBe(true);
		expect(first.crown).toEqual(second.crown);
		expect(first.wind.pivots.length).toBe(second.wind.pivots.length);
	});

	test('grows a different plant from another seed or variant', () => {
		const base = generatePlant(oak, { seed: 7, variant: 0 });
		const other = generatePlant(oak, { seed: 8, variant: 0 });
		const variant = generatePlant(oak, { seed: 7, variant: 1 });
		expect(
			sameBytes(
				base.levels[0]?.parts[0]?.arrays.positions as Float32Array,
				other.levels[0]?.parts[0]?.arrays.positions as Float32Array,
			),
		).toBe(false);
		expect(
			sameBytes(
				base.levels[0]?.parts[0]?.arrays.positions as Float32Array,
				variant.levels[0]?.parts[0]?.arrays.positions as Float32Array,
			),
		).toBe(false);
	});

	test('writes arrays that the engine reads', () => {
		for (const species of ALL_SPECIES) {
			const asset = generatePlant(species, { seed: 3 });
			expect(asset.levels.length).toBe(species.levels);
			for (const level of asset.levels) {
				expect(level.parts.length).toBeGreaterThan(0);
				for (const part of level.parts) {
					const { positions, normals, uvs, colors, indices } = part.arrays;
					const vertices = positions.length / 3;
					expect(positions.length % 3).toBe(0);
					expect(normals.length).toBe(vertices * 3);
					expect(uvs.length).toBe(vertices * 2);
					expect(colors.length).toBe(vertices * 4);
					expect(indices.length % 3).toBe(0);
					for (let i = 0; i < positions.length; i++)
						expect(Number.isFinite(positions[i] as number)).toBe(true);
					for (let i = 0; i < indices.length; i++)
						expect(indices[i] as number).toBeLessThan(vertices);
					for (let v = 0; v < vertices; v++) {
						const length = Math.hypot(
							normals[v * 3] as number,
							normals[v * 3 + 1] as number,
							normals[v * 3 + 2] as number,
						);
						expect(length).toBeGreaterThan(0.9);
						expect(length).toBeLessThan(1.1);
					}
				}
			}
		}
	});

	test('keeps the first level exact and the others within the crown', () => {
		const asset = generatePlant(oak, { seed: 5 });
		expect(asset.levels[0]?.error).toBe(0);
		for (let level = 1; level < asset.levels.length; level++)
			expect(asset.levels[level]?.error as number).toBeGreaterThan(
				asset.levels[level - 1]?.error as number,
			);
		const { min, max } = asset.crown;
		for (const part of asset.levels[0]?.parts ?? []) {
			const positions = part.arrays.positions;
			for (let i = 0; i < positions.length; i += 3) {
				expect(positions[i] as number).toBeGreaterThanOrEqual(min[0] - 1e-3);
				expect(positions[i] as number).toBeLessThanOrEqual(max[0] + 1e-3);
				expect(positions[i + 2] as number).toBeGreaterThanOrEqual(min[2] - 1e-3);
				expect(positions[i + 2] as number).toBeLessThanOrEqual(max[2] + 1e-3);
			}
		}
	});

	test('makes every variant a plant of its own', () => {
		const assets = generateVariantSet(oak, { seed: 11 });
		expect(assets.length).toBe(oak.variants);
		for (let i = 1; i < assets.length; i++)
			expect(
				sameBytes(
					assets[0]?.levels[0]?.parts[0]?.arrays.positions as Float32Array,
					assets[i]?.levels[0]?.parts[0]?.arrays.positions as Float32Array,
				),
			).toBe(false);
	});

	test('grows a plant of one level when asked', () => {
		const asset = generatePlant(oak, { seed: 2, levels: 1 });
		expect(asset.levels.length).toBe(1);
	});

	test('gives every leaf part a target record for the level after it', () => {
		const asset = generatePlant(oak, { seed: 5 });
		for (const [level, record] of asset.levels.entries()) {
			const error =
				level + 1 < asset.levels.length ? (asset.levels[level + 1]?.error as number) : 0;
			for (const part of record.parts) {
				if (part.name !== 'leaves') {
					expect(part.arrays.targets).toBeUndefined();
					continue;
				}
				const vertices = part.arrays.positions.length / 3;
				const targets = part.arrays.targets as Float32Array;
				expect(targets.length).toBe(vertices * 4);
				for (let v = 0; v < vertices; v++) expect(targets[v * 4 + 3]).toBeCloseTo(error, 5);
			}
		}
	});

	test('counts what it grew', () => {
		const asset = generatePlant(oak, { seed: 4 });
		const triangles = asset.levels.reduce((sum, level) => sum + level.triangles, 0);
		expect(asset.stats.triangles).toBe(triangles);
		expect(asset.stats.vertices).toBeGreaterThan(0);
		expect(asset.stats.bytes).toBeGreaterThan(0);
		expect(asset.stats.milliseconds).toBeGreaterThanOrEqual(0);
	});

	test('refuses a record that cannot grow', () => {
		expect(() => generatePlant({ ...oak, height: 0 } as Species, { seed: 1 })).toThrow(/height/);
	});

	test('grows the same plant in the worker task as in the page', () => {
		const direct = generatePlant(oak, { seed: 9, variant: 3 });
		const answer = run({ species: oak, seed: 9, variant: 3 });
		const worker = answer.output;
		const left = arraysOf(direct);
		const right = arraysOf(worker);
		expect(left.length).toBe(right.length);
		for (let i = 0; i < left.length; i++)
			expect(sameBytes(left[i] as Float32Array, right[i] as Float32Array)).toBe(true);
		expect(answer.transfer.length).toBe(left.length);
		expect(answer.transfer.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
	});

	test('crosses to a worker as plain data', () => {
		const asset = generatePlant(oak, { seed: 1 });
		const clone = structuredClone(asset);
		expect(clone.stats.triangles).toBe(asset.stats.triangles);
		expect(clone.wind.pivots.length).toBe(asset.wind.pivots.length);
		expect(clone.levels[0]?.parts.length).toBe(asset.levels[0]?.parts.length);
		for (const species of [oak, builtInSpecies('hosta') as Species]) {
			const answer = run({ species, seed: 1 });
			expect(new Set(answer.transfer).size).toBe(answer.transfer.length);
		}
	});

	test('turns every face the way its vertex normals say', () => {
		for (const id of ['oak', 'conifer', 'fern', 'hosta', 'meadow-grass']) {
			const species = builtInSpecies(id) as Species;
			const asset = generatePlant(species, { seed: 8 });
			for (const part of asset.levels[0]?.parts ?? []) {
				const { positions, normals, indices } = part.arrays;
				for (let t = 0; t < indices.length; t += 3) {
					const [a, b, c] = [
						indices[t] as number,
						indices[t + 1] as number,
						indices[t + 2] as number,
					];
					const ax = positions[a * 3] as number;
					const ay = positions[a * 3 + 1] as number;
					const az = positions[a * 3 + 2] as number;
					const e1x = (positions[b * 3] as number) - ax;
					const e1y = (positions[b * 3 + 1] as number) - ay;
					const e1z = (positions[b * 3 + 2] as number) - az;
					const e2x = (positions[c * 3] as number) - ax;
					const e2y = (positions[c * 3 + 1] as number) - ay;
					const e2z = (positions[c * 3 + 2] as number) - az;
					const fx = e1y * e2z - e1z * e2y;
					const fy = e1z * e2x - e1x * e2z;
					const fz = e1x * e2y - e1y * e2x;
					if (Math.hypot(fx, fy, fz) < 1e-9) continue;
					for (const v of [a, b, c])
						expect(
							(normals[v * 3] as number) * fx +
								(normals[v * 3 + 1] as number) * fy +
								(normals[v * 3 + 2] as number) * fz,
						).toBeGreaterThan(-1e-6);
				}
			}
		}
	});

	test('keeps the built-in set inside the budgets that M3-V1 measured', () => {
		const started = performance.now();
		let variants = 0;
		let bytes = 0;
		for (const species of ALL_SPECIES) {
			for (const asset of generateVariantSet(species, { seed: 1 })) {
				variants += 1;
				bytes += asset.stats.bytes;
			}
		}
		const elapsed = performance.now() - started;
		expect(variants).toBe(ALL_SPECIES.length * 6);
		// The measured total is 29.75 MiB of arrays, 31,192,082 bytes, the leaf targets
		// included, and the device time
		// budgets are far above the Mac's. These bounds catch a generator that slowed by an order
		// of magnitude.
		expect(bytes).toBeLessThan(30 * 1024 * 1024);
		expect(elapsed).toBeLessThan(3000);
	});
});
