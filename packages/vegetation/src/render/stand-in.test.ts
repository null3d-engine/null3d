// What the page draws for stand-in plants: each variant's batches with their meshes, levels, rows
// and distance bands, and its far cards with their atlases, sizes and bands. Scenes place stand-ins
// until their species ship, so what they draw must stay the same as the real stages land, as the
// stand-ins' own bytes do. A fake page records every object that placing makes, and the test holds
// a hash of the record, and that each far card stands at its plant's size.
import { describe, expect, it, mock } from 'bun:test';
import { hashBytes } from '../core/hash';

/** Every number that placing hands the page, in the order it hands them over. */
const record: number[] = [];
const words = (values: ArrayLike<number>) => {
	for (let i = 0; i < values.length; i++) record.push(values[i] as number);
};
/** A text's characters as numbers, so names join the record. */
const text = (value: string) => words(Array.from(value, (c) => c.charCodeAt(0)));

/** A batch of rows, as the engine's instance batches hold them, with the bands it was given. */
interface FakeBatch {
	readonly positions: Float32Array;
	readonly rotations: Float32Array;
	readonly scales: Float32Array;
	readonly ranges: number[];
	readonly tag: string;
	setDrawRange(near: number, far: number): void;
	markDirty(): void;
	destroy(): void;
}

/** Every batch that placing made, in order. */
const batches: FakeBatch[] = [];

/** A batch of rows, as the engine's instance batches hold them. */
function fakeBatch(count: number, tag: string): FakeBatch {
	const batch: FakeBatch = {
		positions: new Float32Array(count * 3),
		rotations: new Float32Array(count * 4),
		scales: new Float32Array(count * 3).fill(1),
		ranges: [] as number[],
		tag,
		setDrawRange(near: number, far: number) {
			batch.ranges.push(near, far);
		},
		markDirty() {},
		destroy() {},
	};
	batches.push(batch);
	return batch;
}

mock.module('@null3d/impostors', () => ({
	createImpostors(
		_owner: unknown,
		options: {
			positions: number[];
			turn: number[];
			size: readonly [number, number];
			depth: number;
			room: number;
			atlas: { columns: number; rows: number };
			alphaMode: string;
		},
	) {
		text('impostors');
		words(options.positions);
		words(options.turn);
		words([
			...options.size,
			options.depth,
			options.room,
			options.atlas.columns,
			options.atlas.rows,
		]);
		text(options.alphaMode);
		const batch = fakeBatch(options.turn.length, 'cards');
		for (let i = 0; i < options.turn.length; i++)
			batch.scales.set([options.size[0], options.size[1], 1], i * 3);
		return { batch, markDirty() {}, destroy() {} };
	},
}));

const { standInMaterials, standInPlace } = await import('./stand-in');
const { record: oak } = await import('../species/pedunculate-oak/record');
const { standInSpecies } = await import('../core/stand-in');
const { bakeFarNow, buildKitNow, growPlantNow, loadPlantCode } = await import('../generate');

/** A page that records what placing asks of it. */
const ctx = {
	geometry: {
		fromArrays(arrays: {
			positions: Float32Array;
			normals: Float32Array;
			uvs: Float32Array;
			indices: ArrayLike<number>;
		}) {
			text('mesh');
			record.push(hashBytes(new Uint8Array(arrays.positions.buffer)) >>> 0);
			record.push(hashBytes(new Uint8Array(arrays.normals.buffer)) >>> 0);
			record.push(hashBytes(new Uint8Array(arrays.uvs.buffer)) >>> 0);
			words(arrays.indices);
			return {
				setLevels(levels: { distance: number }[]) {
					text('levels');
					words(levels.map((level) => level.distance));
				},
			};
		},
	},
	scene: {
		createInstances(
			_mesh: unknown,
			count: number,
			options: { material: { name: string }; castShadows: boolean; ranges: boolean },
		) {
			text(`instances ${options.material.name} ${options.castShadows} ${options.ranges}`);
			record.push(count);
			return fakeBatch(count, options.material.name);
		},
	},
	materials: {},
	textures: {
		fromData(data: { width: number; height: number; data: Uint8Array; colorSpace: string }) {
			text(`texture ${data.colorSpace}`);
			record.push(data.width, data.height, hashBytes(data.data) >>> 0);
			return {};
		},
	},
};

describe('the stand-ins on the page', () => {
	it('places the same batches, rows, bands and far cards as real stages land', async () => {
		const species = standInSpecies('holm-oak', {
			height: 11,
			aspect: 0.8,
			leaf: [0.04, 0.085, 0.028],
			bark: [0.14, 0.11, 0.08],
			variants: 2,
		});
		await loadPlantCode(species.record);
		const data = buildKitNow(species, { detail: 'high', placeholders: true });
		const kit = { ...data, textures: {} } as never;
		const assets = [0, 1].map((variant) => growPlantNow(data, { seed: 17, variant, near: true }));
		const far = await Promise.all(
			assets.map(async (asset) => ({
				variant: asset.variant,
				bake: await bakeFarNow(data, asset),
			})),
		);
		const copies = {
			count: 5,
			position: new Float32Array([0, 0, 0, 30, 1, -4, -60, 2, 9, 200, 0, 200, -400, 5, 120]),
			turn: new Float32Array([0, 1, 2, 3, 4]),
			scale: new Float32Array([1, 0.8, 1.25, 1.1, 0.9]),
			variant: new Uint8Array([0, 1, 0, 1, 0]),
		};
		const material = (name: string) => ({ name }) as never;
		standInPlace(ctx as never, kit, assets, copies, {
			materials: {
				wood: material('wood'),
				shoots: material('shoots'),
				cards: material('cards'),
				foliage: material('foliage'),
				foliageFar: material('foliage'),
				extras: material('extras'),
			},
			far,
			view: { height: 1080, fov: 50 },
			castShadows: true,
		});
		for (const batch of batches) {
			text(batch.tag);
			words(batch.positions);
			words(batch.rotations);
			words(batch.scales);
			words(batch.ranges);
		}
		// Each far card stands at its plant's size, times its copy's scale.
		const farBatches = batches.filter((one) => one.ranges[1] === 1e9);
		expect(farBatches).toHaveLength(far.length);
		farBatches.forEach((batch, variant) => {
			const size = (far[variant] as (typeof far)[number]).bake.size;
			const rows = [...copies.variant.keys()].filter((copy) => copies.variant[copy] === variant);
			rows.forEach((copy, row) => {
				const scale = copies.scale[copy] as number;
				expect(batch.scales[row * 3]).toBeCloseTo(size[0] * scale, 4);
				expect(batch.scales[row * 3 + 1]).toBeCloseTo(size[1] * scale, 4);
			});
		});
		const floats = new Float32Array(record);
		expect(hashBytes(new Uint8Array(floats.buffer)) >>> 0).toBe(2053914147);
	});
});

describe('the stand-in materials', () => {
	it('draw the measured bark times its tint, and a stand-in species in its own colour', () => {
		const page = {
			materials: { standard: (options: Record<string, unknown>) => options },
		} as unknown as Parameters<typeof standInMaterials>[0];
		const colourOf = (record: typeof oak, bark?: unknown) =>
			(
				standInMaterials(page, {
					record,
					manifest: { bark },
					textures: { cardColor: undefined },
				} as unknown as Parameters<typeof standInMaterials>[1]).wood as unknown as {
					color: readonly number[];
				}
			).color;
		const tint = oak.bark?.zones[0]?.tint as readonly [number, number, number];
		expect(tint).toBeDefined();
		const mean = [0.25, 0.22, 0.18] as const;
		const wood = colourOf(oak, { layers: [{ mean }] });
		mean.forEach((c, k) => {
			expect(wood[k]).toBeCloseTo(c * (tint[k] as number), 12);
		});
		// A stand-in species measures no bark and gives its colour in the tint.
		const standIn = standInSpecies('bark-colour-test').record;
		expect(colourOf(standIn)).toEqual([...(standIn.bark?.zones[0]?.tint ?? [])]);
		const plain = {
			...oak,
			bark: {
				...(oak.bark as NonNullable<typeof oak.bark>),
				zones: [{ layer: 0, by: 'height' as const, from: 0, to: 40, blend: 0 }],
			},
		};
		expect(colourOf(plain)).toEqual([0.2, 0.16, 0.12]);
	});
});
