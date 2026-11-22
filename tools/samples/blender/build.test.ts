import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScene, levelMismatches } from './build';

/** A binary glTF file of a JSON chunk and, when given, a binary chunk. */
function glb(json: object, bin = new Uint8Array(0)): Uint8Array {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const padded = new Uint8Array(text.length + ((4 - (text.length % 4)) % 4)).fill(0x20);
	padded.set(text);
	const data = new Uint8Array(bin.length + ((4 - (bin.length % 4)) % 4));
	data.set(bin);
	const out = new Uint8Array(20 + padded.length + (bin.length > 0 ? 8 + data.length : 0));
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, padded.length, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(padded, 20);
	if (bin.length > 0) {
		view.setUint32(20 + padded.length, data.length, true);
		view.setUint32(24 + padded.length, 0x004e4942, true);
		out.set(data, 28 + padded.length);
	}
	return out;
}

/**
 * A square with one lower level, as Blender writes a model: floats throughout. The full level's
 * texture coordinates reach `uvTop` across, and the lower level has normals when `levelNormals`.
 */
function square({ uvTop = 1, levelNormals = true }: { uvTop?: number; levelNormals?: boolean }) {
	const chunks: Uint8Array[] = [];
	const views: { buffer: 0; byteOffset: number; byteLength: number }[] = [];
	const accessors: object[] = [];
	let length = 0;
	const add = (array: Float32Array | Uint16Array, type: string, extra: object = {}) => {
		chunks.push(new Uint8Array(array.buffer));
		views.push({ buffer: 0, byteOffset: length, byteLength: array.byteLength });
		length += array.byteLength;
		const componentType = array instanceof Float32Array ? 5126 : 5123;
		const count = array.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3 } as Record<string, number>)[type]!;
		accessors.push({ bufferView: views.length - 1, componentType, count, type, ...extra });
		return accessors.length - 1;
	};
	const mesh = (top: number, normals: boolean) => {
		const attributes: Record<string, number> = {
			POSITION: add(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]), 'VEC3', {
				min: [0, 0, 0],
				max: [1, 0, 1],
			}),
			TEXCOORD_0: add(new Float32Array([0, 0, top, 0, 0, 1, top, 1]), 'VEC2'),
		};
		if (normals)
			attributes.NORMAL = add(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 'VEC3');
		return {
			primitives: [{ attributes, indices: add(new Uint16Array([0, 2, 1, 1, 2, 3]), 'SCALAR') }],
		};
	};
	const meshes = [mesh(uvTop, true), mesh(1, levelNormals)];
	const bin = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		bin.set(chunk, at);
		at += chunk.length;
	}
	return glb(
		{
			asset: { version: '2.0' },
			extensionsUsed: ['MSFT_lod'],
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [
				{
					name: 'square',
					mesh: 0,
					extensions: { MSFT_lod: { ids: [1] } },
					extras: { NULL3D_lod_error: [0.05] },
				},
				{ name: 'square-1', mesh: 1 },
			],
			meshes,
			accessors,
			bufferViews: views,
			buffers: [{ byteLength: length }],
		},
		bin,
	);
}

/**
 * Runs `buildScene` on one model, with a stand-in for Blender that writes the given file into the
 * folder that follows `--`, and returns the built file.
 */
async function build(model: Uint8Array): Promise<Uint8Array> {
	const dir = mkdtempSync(join(tmpdir(), 'build-scene-'));
	const blender = process.env.BLENDER;
	try {
		writeFileSync(join(dir, 'square.glb'), model);
		const stand = join(dir, 'blender.sh');
		writeFileSync(
			stand,
			`#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nmkdir -p "$2"\ncp "${join(dir, 'square.glb')}" "$2/square.glb"\n`,
		);
		chmodSync(stand, 0o755);
		process.env.BLENDER = stand;
		await buildScene({ script: 'square.py', models: ['square'], swaying: [] }, [join(dir, 'out')]);
		return new Uint8Array(readFileSync(join(dir, 'out', 'square.glb')));
	} finally {
		if (blender === undefined) delete process.env.BLENDER;
		else process.env.BLENDER = blender;
		rmSync(dir, { recursive: true, force: true });
	}
}

/** A tree with one lower level, whose texture coordinates are stored as `levelUv`. */
function tree(levelUv: { componentType: number; normalized?: boolean }) {
	return glb({
		nodes: [
			{ name: 'wood', mesh: 0, extensions: { MSFT_lod: { ids: [1] } } },
			{ name: 'wood-1', mesh: 1 },
		],
		meshes: [
			{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] },
			{ primitives: [{ attributes: { POSITION: 2, TEXCOORD_0: 3 } }] },
		],
		accessors: [
			{ count: 3, componentType: 5123, type: 'VEC3' },
			{ count: 3, componentType: 5126, type: 'VEC2' },
			{ count: 3, componentType: 5123, type: 'VEC3' },
			{ count: 3, type: 'VEC2', ...levelUv },
		],
	});
}

describe('levelMismatches', () => {
	test('names a level that stores an attribute in another form than its full level', () => {
		const found = levelMismatches(tree({ componentType: 5123, normalized: true }));
		expect(found).toHaveLength(1);
		expect(found[0]).toContain('wood-1 against wood');
		expect(found[0]).toContain('TEXCOORD_0: 5123 normalized VEC2');
		expect(found[0]).toContain('TEXCOORD_0: 5126 VEC2');
	});

	test('passes levels stored like their full level', () => {
		expect(levelMismatches(tree({ componentType: 5126 }))).toEqual([]);
	});
});

describe('buildScene', () => {
	test('stores every level like its full level when only the full level passes 1', async () => {
		expect(levelMismatches(await build(square({ uvTop: 1.04 })))).toEqual([]);
	});

	test('stops a build whose levels are stored unlike their full level', async () => {
		await expect(build(square({ levelNormals: false }))).rejects.toThrow(
			'square.glb stores levels unlike their full level',
		);
	});
});
