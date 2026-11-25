import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { checkImpostorFile } from '@null3d/impostors/atlas-file';
import { bakeImpostorAtlas, type ImpostorBakePart, octahedralAtlas } from '@null3d/impostors/bake';
import { UsageError } from '../args.js';
import { run as runAssets } from '../assets.js';
import { encodePng, readPng } from '../png.js';
import {
	impostorFileNames,
	impostorParts,
	parseImpostorArgs,
	run,
	uprightImage,
} from './impostor.js';

const scratch = mkdtempSync(join(tmpdir(), 'null3d-impostor-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A square from (-0.5, 0) to (0.5, 1) in the xy plane, facing +z, in two triangles. */
const SQUARE = {
	positions: [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 1, 1, 1, 1, 0, 0, 0],
	indices: [0, 1, 2, 0, 2, 3],
};

interface ModelOptions {
	/** The node's translation and scale. */
	translation?: [number, number, number];
	scale?: [number, number, number];
	/** The material's base color factor. */
	color?: [number, number, number, number];
	/** A base color image, PNG bytes, and its MIME type. */
	image?: { bytes: Uint8Array; mimeType: string };
	alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
}

/** A model of one square, written as a binary glTF file, and its path. */
async function squareModel(name: string, options: ModelOptions = {}): Promise<string> {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const accessor = (
		array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
		type: 'VEC3' | 'VEC2' | 'SCALAR',
	) => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
	const material = doc
		.createMaterial('square')
		.setBaseColorFactor(options.color ?? [1, 1, 1, 1])
		.setAlphaMode(options.alphaMode ?? 'OPAQUE');
	if (options.image) {
		const texture = doc
			.createTexture('picture')
			.setImage(options.image.bytes)
			.setMimeType(options.image.mimeType);
		material.setBaseColorTexture(texture);
	}
	const primitive = doc
		.createPrimitive()
		.setAttribute('POSITION', accessor(new Float32Array(SQUARE.positions), 'VEC3'))
		.setAttribute('NORMAL', accessor(new Float32Array(SQUARE.normals), 'VEC3'))
		.setAttribute('TEXCOORD_0', accessor(new Float32Array(SQUARE.uvs), 'VEC2'))
		.setIndices(accessor(new Uint16Array(SQUARE.indices), 'SCALAR'))
		.setMaterial(material);
	const node = doc
		.createNode('square')
		.setMesh(doc.createMesh('square').addPrimitive(primitive))
		.setTranslation(options.translation ?? [0, 0, 0])
		.setScale(options.scale ?? [1, 1, 1]);
	doc.getRoot().setDefaultScene(doc.createScene('scene').addChild(node));
	const path = join(scratch, `${name}.glb`);
	await new NodeIO().write(path, doc);
	return path;
}

/** The square's positions moved by a translation and a scale. */
function moved(translation: readonly number[], scale: readonly number[]): number[] {
	return SQUARE.positions.map(
		(v, i) => v * (scale[i % 3] as number) + (translation[i % 3] as number),
	);
}

describe('parseImpostorArgs', () => {
	it('takes the model and the defaults, and writes beside the model', () => {
		const args = parseImpostorArgs(['models/pine.glb']);
		expect(args.input.endsWith(join('models', 'pine.glb'))).toBe(true);
		expect(args.out.endsWith('models')).toBe(true);
		expect(args.views).toBe(25);
		expect(args.texels).toBe(64);
	});

	it('refuses a bad count, a second file and a model it cannot read', () => {
		expect(() => parseImpostorArgs(['pine.glb', '--views', '0'])).toThrow(UsageError);
		expect(() => parseImpostorArgs(['pine.glb', '--texels', '2.5'])).toThrow(UsageError);
		expect(() => parseImpostorArgs(['pine.glb', 'fir.glb'])).toThrow(UsageError);
		expect(() => parseImpostorArgs(['pine.obj'])).toThrow('assets convert');
	});

	it('names the three files after the model', () => {
		expect(impostorFileNames('/a/pine.glb')).toEqual({
			json: 'pine-impostor.json',
			color: 'pine-impostor-color.png',
			surface: 'pine-impostor-surface.png',
		});
	});
});

describe('impostorParts', () => {
	it('moves the parts into the scene frame and mirrors the triangles of a flipped node', async () => {
		const path = await squareModel('mirrored', { translation: [2, 1, 0], scale: [-2, 1, 1] });
		const doc = await new NodeIO().read(path);
		const { parts, min, max } = impostorParts(doc);
		expect(parts).toHaveLength(1);
		const part = parts[0] as ImpostorBakePart;
		expect(Array.from(part.positions)).toEqual(moved([2, 1, 0], [-2, 1, 1]));
		expect(min).toEqual([1, 1, 0]);
		expect(max).toEqual([3, 2, 0]);
		// The mirror swaps each triangle's last two corners, so its winding still faces +z.
		expect(Array.from(part.indices)).toEqual([0, 2, 1, 0, 3, 2]);
		// The normal keeps facing +z: the mirror runs along x.
		expect(
			Array.from(part.normals ?? [])
				.slice(0, 3)
				.map((v) => v + 0),
		).toEqual([0, 0, 1]);
	});

	it('takes a masked material’s texture alpha as the coverage', async () => {
		const image = encodePng({
			width: 2,
			height: 1,
			data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]),
		});
		const path = await squareModel('masked', {
			image: { bytes: image, mimeType: 'image/png' },
			alphaMode: 'MASK',
		});
		const { parts } = impostorParts(await new NodeIO().read(path));
		const part = parts[0] as ImpostorBakePart;
		expect(part.color?.width).toBe(2);
		expect(Array.from(part.coverage?.data ?? [])).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
		expect(part.alphaCutoff).toBe(0.5);
	});

	it('refuses a texture that it cannot decode', async () => {
		const path = await squareModel('compressed', {
			image: { bytes: new Uint8Array([0xab, 0x4b, 0x54, 0x58]), mimeType: 'image/ktx2' },
		});
		const doc = await new NodeIO().read(path);
		expect(() => impostorParts(doc)).toThrow('before assets optimize');
	});
});

describe('assets impostor', () => {
	it('writes the bake of the model, upright, with a file that the add-on reads', async () => {
		const path = await squareModel('square', { translation: [0, 0.5, 0], color: [1, 0, 0, 1] });
		const out = join(scratch, 'out');
		const log = spyOn(console, 'log').mockImplementation(() => {});
		try {
			expect(
				await runAssets(['impostor', path, '--out', out, '--views', '9', '--texels', '8']),
			).toBe(0);
		} finally {
			log.mockRestore();
		}
		const file = checkImpostorFile(
			JSON.parse(readFileSync(join(out, 'square-impostor.json'), 'utf8')),
			'square-impostor.json',
		);
		const atlas = octahedralAtlas(9);
		expect(file.atlas).toEqual(atlas);
		expect(file.texels).toBe(8);
		expect(file.color).toBe('square-impostor-color.png');

		// The same parts, baked here, give the same texels, with the image's rows upright.
		const bake = bakeImpostorAtlas({
			atlas,
			texels: 8,
			parts: [
				{
					positions: moved([0, 0.5, 0], [1, 1, 1]),
					normals: SQUARE.normals,
					indices: SQUARE.indices,
					tint: [1, 0, 0],
					alphaCutoff: 0.5,
					doubleSided: false,
					colors: Array.from({ length: 16 }, () => 1),
				},
			],
			min: [-0.5, 0.5, 0],
			max: [0.5, 1.5, 0],
		});
		expect(file.size).toEqual(bake.size);
		expect(file.room).toBe(bake.room);
		expect(file.depth).toBe(bake.depth);
		const color = readPng(join(out, file.color));
		const surface = readPng(join(out, file.surface));
		expect(Array.from(color.data)).toEqual(Array.from(uprightImage(bake.color).data));
		expect(Array.from(surface.data)).toEqual(Array.from(uprightImage(bake.surface).data));
		// The square faces +z, so the front view draws it red, and some texels stay empty.
		expect(color.data.some((byte, i) => i % 4 === 0 && byte === 255)).toBe(true);
		expect(color.data.some((byte, i) => i % 4 === 3 && byte === 0)).toBe(true);
	});

	it('reports a model that it cannot read, and exits with 1', async () => {
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(await run([join(scratch, 'missing.glb')])).toBe(1);
			expect(String(error.mock.calls[0]?.[0])).toContain('missing.glb');
		} finally {
			error.mockRestore();
		}
	});
});
