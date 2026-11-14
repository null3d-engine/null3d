import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGround } from '../scenes/desert';
import { readGlb } from './city-files';
import {
	DESERT_ASSET_OPTIONS,
	type DesertManifest,
	desertFileFor,
	desertGlb,
	rawKey,
	writeGlb,
} from './desert-files';

describe('the GLB writer', () => {
	test('writes a header, a JSON chunk and a binary chunk that a reader takes back', () => {
		const bin = new Uint8Array([1, 2, 3, 4, 5]);
		const glb = writeGlb({ asset: { version: '2.0' } }, bin);
		const view = new DataView(glb.buffer);
		expect(view.getUint32(0, true)).toBe(0x46546c67);
		expect(view.getUint32(8, true)).toBe(glb.length);
		expect(view.getUint32(12, true) % 4).toBe(0);
		expect(glb.length % 4).toBe(0);
		const back = readGlb(glb);
		expect(back.json).toEqual({ asset: { version: '2.0' }, buffers: [{ byteLength: 5 }] });
		// The binary chunk pads to a multiple of 4 bytes with zeros.
		expect([...back.bin]).toEqual([1, 2, 3, 4, 5, 0, 0, 0]);
	});

	test('writes each mesh as a node of its name, with its material once and its bounds', () => {
		const data = buildGround(2);
		const glb = desertGlb('props', [
			{ name: 'a', material: 'rock', data },
			{ name: 'b', material: 'rock', data },
		]);
		const { json, bin } = readGlb(glb);
		expect(json.scenes?.[0] as unknown).toEqual({ name: 'desert-props', nodes: [0, 1] });
		expect(json.nodes?.map((node) => [node.name, node.mesh])).toEqual([
			['a', 0],
			['b', 1],
		]);
		expect((json as { materials: { name: string }[] }).materials.map((m) => m.name)).toEqual([
			'rock',
		]);
		const [position, normal, index] = json.accessors ?? [];
		expect(position).toMatchObject({ componentType: 5126, count: 9, type: 'VEC3' });
		expect(position?.min?.[0]).toBe(-400);
		expect(position?.max?.[2]).toBe(400);
		expect(normal).toMatchObject({ count: 9, type: 'VEC3' });
		expect(index).toMatchObject({ componentType: 5125, count: 24, type: 'SCALAR' });
		const views = json.bufferViews ?? [];
		expect(views.map((v) => v.target)).toEqual([34962, 34962, 34963, 34962, 34962, 34963]);
		const indexView = views[2];
		if (!indexView) throw new Error('the file lost its index view');
		const indices = new Uint32Array(
			bin.slice(indexView.byteOffset, (indexView.byteOffset ?? 0) + indexView.byteLength).buffer,
		);
		expect([...indices]).toEqual([...data.indices]);
	});
});

describe('the desert build', () => {
	test('gives the ground a tree of cluster patches and the props levels alone', () => {
		expect(DESERT_ASSET_OPTIONS.ground).toMatchObject({ lod: true, clusters: true });
		expect(DESERT_ASSET_OPTIONS.props).toMatchObject({ lod: true });
		expect(DESERT_ASSET_OPTIONS.props.clusters).toBeUndefined();
	});

	test('keys the raw files by the bytes of the sources that write them', () => {
		const dir = mkdtempSync(join(tmpdir(), 'desert-key-'));
		try {
			const source = join(dir, 'scene.ts');
			writeFileSync(source, 'one');
			const first = rawKey([source]);
			expect(rawKey([source])).toBe(first);
			writeFileSync(source, 'two');
			expect(rawKey([source])).not.toBe(first);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('serves the files that the manifest names, and refuses other addresses', () => {
		const manifest: DesertManifest = {
			key: 'k',
			files: { '/bench-desert/raw/ground.glb': { path: import.meta.path, sha256: 'abc' } },
		};
		expect(desertFileFor(manifest, '/bench-desert/raw/ground.glb?x=1')).toEqual({
			path: import.meta.path,
			sha256: 'abc',
		});
		expect(desertFileFor(manifest, '/bench-desert/raw/sky.glb')).toEqual({
			problem: '/bench-desert/raw/sky.glb is not a desert model file',
		});
		expect(desertFileFor(manifest, '/bench-desert/null3d/props.glb')).toEqual({
			problem: '/bench-desert/null3d/props.glb is not built: run bun bench/lib/desert-files.ts',
		});
		expect(desertFileFor(null, '/bench-desert/raw/ground.glb')).toHaveProperty('problem');
	});
});
