import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { Document } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import { ktx2Header, transcodeLevel } from '../../../../tests/lib/basis-transcoder.ts';
import { encodePng } from '../png.js';
import { encodeTexture, joinLevels } from './encoder.js';
import { encodeOnce } from './encoder-pool.js';
import { resizeImage, textureSize } from './images.js';
import { modelReport, reportLines, textureMemory } from './report.js';
import { BAKE_LIMIT, bakedRoughness, bakeLevels } from './roughness.js';
import { encodeTextures, planBakes, type TextureRecord, textureKinds } from './textures.js';

// Texture encodes take seconds each on a busy machine or a CI runner of four cores.
setDefaultTimeout(60_000);

/** An RGBA8 image whose pixels `pixel` gives. */
function image(width: number, height: number, pixel: (x: number, y: number) => readonly number[]) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
	return { width, height, data };
}

/** A normal tilted by `angle` radians toward +x or -x, as a normal map stores it. */
const tilted = (angle: number, sign: number) => [
	Math.round((sign * Math.sin(angle) * 0.5 + 0.5) * 255),
	128,
	Math.round((Math.cos(angle) * 0.5 + 0.5) * 255),
	255,
];

/** A normal map whose texels tilt left and right in a checkerboard. */
const checkerNormals = (side: number, angle: number) =>
	image(side, side, (x, y) => tilted(angle, (x + y) % 2 === 0 ? 1 : -1));

/** A flat normal map. */
const flatNormals = (side: number) => image(side, side, () => [128, 128, 255, 255]);

/** A metal-rough map: full occlusion, one roughness, metal in the left half. */
const metalRough = (side: number, roughness: number) =>
	image(side, side, (x) => [255, roughness, x < side / 2 ? 255 : 0, 255]);

/** The unit normal of a stored texel, as the bake reads it. */
function unit(texel: readonly number[], scale = 1) {
	const v = [
		((texel[0]! / 255) * 2 - 1) * scale,
		((texel[1]! / 255) * 2 - 1) * scale,
		(texel[2]! / 255) * 2 - 1,
	];
	const length = Math.hypot(...v);
	return v.map((c) => c / length);
}

/** The length of the average of the left and the right tilt of a checkerboard. */
function checkerLength(angle: number, scale = 1) {
	const a = unit(tilted(angle, 1), scale);
	const b = unit(tilted(angle, -1), scale);
	return Math.hypot(...a.map((c, k) => (c + b[k]!) / 2));
}

describe('the roughness formula', () => {
	it('leaves a texel alone where the normals agree', () => {
		expect(bakedRoughness(0.3, 1, 1)).toBe(0.3);
	});

	it("adds three times the lobe's variance to the squared roughness, as Godot does", () => {
		const r = 0.98;
		const kappa = (3 * r - r ** 3) / (1 - r ** 2);
		expect(bakedRoughness(0.3, r, 1)).toBeCloseTo(Math.sqrt(0.09 + 3 * (0.25 / kappa)), 12);
	});

	it('adds at most the limit, and keeps the result within 1', () => {
		expect(bakedRoughness(0.1, 0, 1)).toBeCloseTo(Math.sqrt(0.01 + BAKE_LIMIT ** 2), 12);
		expect(bakedRoughness(0.95, 0.2, 1)).toBe(1);
	});

	it("divides the added roughness by the square of the material's factor", () => {
		const r = 0.99;
		const added = bakedRoughness(0, r, 1) ** 2;
		expect(bakedRoughness(0.2, r, 0.5) ** 2).toBeCloseTo(0.04 + added / 0.25, 12);
	});
});

describe('the baked levels', () => {
	const angle = 0.5;

	it('take the formula at every level below the full size, and keep occlusion and metalness', () => {
		// Each texel of the 8 x 8 map covers 2 x 2 texels of the normal map or more, with as many
		// of each tilt, so every level's normals average to the same length.
		const levels = bakeLevels(metalRough(8, 100), checkerNormals(16, angle), 1, 1);
		expect(levels.map((l) => [l.width, l.height])).toEqual([
			[8, 8],
			[4, 4],
			[2, 2],
			[1, 1],
		]);
		const expected = Math.round(bakedRoughness(100 / 255, checkerLength(angle), 1) * 255);
		expect(expected).toBeGreaterThan(100);
		levels.forEach((level, k) => {
			const plain = resizeImage(metalRough(8, 100), level.width, level.height, false);
			for (let i = 0; i < level.data.length; i += 4) {
				expect([k, i, level.data[i + 1]]).toEqual([k, i, k === 0 ? 100 : expected]);
				for (const c of [0, 2, 3])
					expect([k, i, level.data[i + c]]).toEqual([k, i, plain.data[i + c]]);
			}
		});
	});

	it('take the normal scale into the spread of the normals', () => {
		const half = bakeLevels(metalRough(8, 100), checkerNormals(16, angle), 0.5, 1)[1]!;
		expect(half.data[1]).toBe(
			Math.round(bakedRoughness(100 / 255, checkerLength(angle, 0.5), 1) * 255),
		);
		expect(half.data[1]).toBeLessThan(
			bakeLevels(metalRough(8, 100), checkerNormals(16, angle), 1, 1)[1]!.data[1]!,
		);
	});

	it('read one normal under each texel where the normal map is the smaller', () => {
		// The 4 x 4 level's texels each lie on one texel of the 2 x 2 normal map, whose normals
		// all agree with themselves, so only the 1 x 1 level takes the bake.
		const levels = bakeLevels(metalRough(8, 100), checkerNormals(2, angle), 1, 1);
		expect(levels.map((l) => l.data[1])).toEqual([
			100,
			100,
			100,
			Math.round(bakedRoughness(100 / 255, checkerLength(angle), 1) * 255),
		]);
	});

	it('equal the plain levels under a flat normal map', () => {
		const source = metalRough(8, 100);
		for (const level of bakeLevels(source, flatNormals(32), 1, 1))
			expect(level.data).toEqual(resizeImage(source, level.width, level.height, false).data);
	});
});

describe('the baked file', () => {
	const job = {
		bytes: encodePng(metalRough(8, 100)),
		mimeType: 'image/png',
		kind: 'data',
		codec: 'uastc',
		maxSide: 2048,
		bake: { bytes: encodePng(checkerNormals(16, 0.5)), mimeType: 'image/png', scale: 1, factor: 1 },
	} as const;

	it('holds every level in UASTC with Zstandard, each with the baked roughness', async () => {
		const texture = await encodeTexture(job);
		expect(ktx2Header(texture.ktx2)).toEqual({
			vkFormat: 0,
			width: 8,
			height: 8,
			levels: 4,
			supercompression: 2,
		});
		const levels = bakeLevels(metalRough(8, 100), checkerNormals(16, 0.5), 1, 1);
		for (const [k, level] of levels.entries()) {
			const { srgb, out } = await transcodeLevel(texture.ktx2, k);
			expect(srgb).toBe(false);
			expect(out.length).toBe(level.data.length);
			// UASTC keeps flat blocks within a step or two of 255.
			for (let i = 0; i < out.length; i++)
				expect(Math.abs(out[i]! - level.data[i]!)).toBeLessThanOrEqual(2);
		}
	});

	it('gives the same bytes on two runs', async () => {
		const [a, b] = await Promise.all([encodeTexture(job), encodeTexture(job)]);
		expect(Buffer.from(a.ktx2).equals(Buffer.from(b.ktx2))).toBe(true);
	});

	it("lays out joined levels as the encoder lays out its own: one file's levels split and joined give its bytes", async () => {
		const own = await encodeTexture({ ...job, bake: undefined });
		expect(ktx2Header(own.ktx2).supercompression).toBe(2);
		const levels = Array.from({ length: ktx2Header(own.ktx2).levels }, (_, k) =>
			singleLevel(own.ktx2, k),
		);
		expect(Buffer.from(joinLevels(levels)).equals(Buffer.from(own.ktx2))).toBe(true);
	});

	it('is a separate encode from the same map without the bake, or with another', async () => {
		const calls: unknown[] = [];
		const encode = encodeOnce(async (j) => {
			calls.push(j);
			return encodeTexture(j);
		});
		await Promise.all([
			encode(job),
			encode(job),
			encode({ ...job, bake: undefined }),
			encode({ ...job, bake: { ...job.bake, factor: 0.5 } }),
		]);
		expect(calls.length).toBe(3);
	});
});

/** One level of a KTX2 file as a file of its own, laid out as the encoder writes one. */
function singleLevel(ktx2: Uint8Array, level: number) {
	const view = new DataView(ktx2.buffer, ktx2.byteOffset, ktx2.byteLength);
	const dfd = view.getUint32(48, true);
	const dfdLength = view.getUint32(52, true);
	const kvdLength = view.getUint32(60, true);
	const entry = 80 + level * 24;
	const offset = Number(view.getBigUint64(entry, true));
	const length = Number(view.getBigUint64(entry + 8, true));
	const descriptors = ktx2.subarray(dfd, dfd + dfdLength + kvdLength);
	const out = new Uint8Array(104 + descriptors.length + length);
	const head = new DataView(out.buffer);
	out.set(ktx2.subarray(0, 48));
	head.setUint32(40, 1, true);
	head.setUint32(48, 104, true);
	head.setUint32(52, dfdLength, true);
	head.setUint32(56, 104 + dfdLength, true);
	head.setUint32(60, kvdLength, true);
	head.setBigUint64(80, BigInt(104 + descriptors.length), true);
	head.setBigUint64(88, BigInt(length), true);
	head.setBigUint64(96, view.getBigUint64(entry + 16, true), true);
	out.set(descriptors, 104);
	out.set(ktx2.subarray(offset, offset + length), 104 + descriptors.length);
	return out;
}

/** A document with a texture of each map, read by materials that `materials` sets up. */
function scene() {
	const doc = new Document();
	const texture = (name: string, png: Uint8Array) =>
		doc.createTexture(name).setImage(png).setMimeType('image/png');
	const rough = texture('rough', encodePng(metalRough(8, 100)));
	const bumps = texture('bumps', encodePng(checkerNormals(16, 0.5)));
	const dents = texture('dents', encodePng(checkerNormals(16, 0.3)));
	return { doc, rough, bumps, dents };
}

/** The report of a model whose only facts are its textures and the materials left unbaked. */
function texturesReport(
	doc: Document,
	textures: TextureRecord[],
	unbaked: { material: string; reason: string }[] = [],
) {
	return modelReport(doc, {
		name: 'scene.glb',
		inputBytes: 0,
		modelBytes: 0,
		textures,
		unbaked,
		files: new Map(),
		levels: [],
		merged: { textures: 0, materials: 0, accessors: 0, meshes: 0 },
		spatial: {
			blockers: 0,
			blockerTriangles: 0,
			ownBlockers: 0,
			noBlocker: [],
			trees: 0,
			treeBytes: 0,
		},
		ms: 0,
	});
}

describe('the bake plan', () => {
	it('bakes a shared metal-rough map once for each normal map, and keeps a plain copy', () => {
		const { doc, rough, bumps, dents } = scene();
		const a = doc.createMaterial('a').setMetallicRoughnessTexture(rough).setNormalTexture(bumps);
		const b = doc.createMaterial('b').setMetallicRoughnessTexture(rough).setNormalTexture(bumps);
		const c = doc.createMaterial('c').setMetallicRoughnessTexture(rough).setNormalTexture(dents);
		const d = doc.createMaterial('d').setMetallicRoughnessTexture(rough);
		const e = doc.createMaterial('e').setMetallicRoughnessTexture(rough).setNormalTexture(bumps);
		e.setRoughnessFactor(0.5);
		const kinds = textureKinds(doc);
		const { bakes, skipped } = planBakes(doc, kinds);
		expect(skipped).toEqual([]);
		const read = [a, b, c, d, e].map((m) => m.getMetallicRoughnessTexture());
		expect(read[0]).toBe(rough);
		expect(read[1]).toBe(rough);
		expect(new Set(read).size).toBe(4);
		expect(bakes.get(rough)).toEqual({ normal: bumps, scale: 1, factor: 1 });
		expect(bakes.get(read[2]!)?.normal).toBe(dents);
		expect(bakes.has(read[3]!)).toBe(false);
		expect(bakes.get(read[4]!)?.factor).toBe(0.5);
		for (const texture of read) expect(kinds.get(texture!)).toBe('data');
	});

	it('skips materials whose maps read different coordinates, or whose roughness factor is 0', () => {
		const { doc, rough, bumps } = scene();
		const transform = doc.createExtension(KHRTextureTransform);
		const moved = doc.createMaterial('moved').setMetallicRoughnessTexture(rough);
		moved.setNormalTexture(bumps);
		moved
			.getNormalTextureInfo()!
			.setExtension('KHR_texture_transform', transform.createTransform().setScale([2, 2]));
		const other = doc.createMaterial('other set').setNormalTexture(bumps);
		other.setMetallicRoughnessTexture(rough).getMetallicRoughnessTextureInfo()!.setTexCoord(1);
		const smooth = doc.createMaterial('mirror').setNormalTexture(bumps);
		smooth.setMetallicRoughnessTexture(rough).setRoughnessFactor(0);
		const { bakes, skipped } = planBakes(doc, textureKinds(doc));
		expect(bakes.size).toBe(0);
		expect(skipped).toEqual([
			{ material: 'moved', reason: expect.stringContaining('different texture coordinates') },
			{ material: 'other set', reason: expect.stringContaining('different texture coordinates') },
			{ material: 'mirror', reason: 'its roughness factor is 0' },
		]);
	});

	it('encodes baked maps in UASTC, and reports them', async () => {
		const { doc, rough, bumps } = scene();
		doc.createMaterial('a').setMetallicRoughnessTexture(rough).setNormalTexture(bumps);
		const options = { encode: encodeTexture, maxSide: 2048, quality: 'size', folder: 't' } as const;
		const { records, skipped } = await encodeTextures(doc, { ...options, roughnessBake: true });
		const baked = records.find((r) => r.name === 'rough')!;
		expect(baked).toMatchObject({ baked: true, codec: 'uastc', width: 8, height: 8 });
		const report = texturesReport(doc, records, [
			...skipped,
			{ material: 'mirror', reason: 'its roughness factor is 0' },
		]);
		const lines = reportLines(report).join('\n');
		expect(lines).toContain('  roughness levels baked from normal maps: 1 texture');
		expect(lines).toContain(
			'  no roughness bake for 1 material:\n    mirror: its roughness factor is 0',
		);
	});
});

describe('whole blocks', () => {
	it('leave the tool from a texture of 1,023 x 517', async () => {
		expect(textureSize(1023, 517, 2048)).toEqual([1024, 512]);
		const texture = await encodeTexture({
			bytes: encodePng(image(1023, 517, (x, y) => [x & 255, y & 255, 90, 255])),
			mimeType: 'image/png',
			kind: 'color',
			codec: 'etc1s',
			maxSide: 2048,
		});
		const { width, height } = ktx2Header(texture.ktx2);
		expect([width % 4, height % 4, width, height]).toEqual([0, 0, 1024, 512]);
	});

	it('count a kept KTX2 file in partial blocks as uncompressed, and report it', () => {
		const record: TextureRecord = {
			name: 'odd',
			uri: 't/odd.ktx2',
			kind: 'kept',
			codec: 'uastc',
			width: 30,
			height: 20,
			sourceWidth: 30,
			sourceHeight: 20,
			alpha: false,
			baked: false,
			bytes: 100,
			ms: 0,
		};
		const memory = textureMemory([record]);
		expect(memory.etc2).toBe(memory.rgba8);
		expect(memory.bc7).toBe(memory.rgba8);
		const report = texturesReport(new Document(), [record]);
		expect(report.partialBlocks).toEqual(['odd']);
		expect(reportLines(report).join('\n')).toContain(
			"odd: its KTX2 file's sides are not whole blocks of 4 texels",
		);
	});
});
