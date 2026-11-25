import { describe, expect, test } from 'bun:test';
import type { LoadTextureOptions, Texture } from '@null3d/engine';
import { checkImpostorFile, IMPOSTOR_FILE_FORMAT, IMPOSTOR_FILE_VERSION } from './atlas-file';
import { loadImpostorAtlas } from './load';

/** An impostor atlas file as the command writes it. */
const FILE = {
	format: IMPOSTOR_FILE_FORMAT,
	version: IMPOSTOR_FILE_VERSION,
	atlas: { columns: 5, rows: 5 },
	texels: 64,
	color: 'pine-impostor-color.png',
	surface: 'pine-impostor-surface.png',
	size: [2.4, 7.4],
	room: 1.2,
	depth: 2.4,
	min: [-1.2, 0, -1.1],
	max: [1.1, 7.4, 1.3],
};

/** A stand-in for the sketch's asset loader: it answers one JSON file and records each texture. */
function fakeAssets(json: unknown) {
	const loads: { url: string; options: LoadTextureOptions | undefined }[] = [];
	const assets = {
		loadJson: async <T>(_url: string | URL) => json as T,
		loadTexture: async (url: string | URL, options?: LoadTextureOptions) => {
			loads.push({ url: String(url), options });
			return { url: String(url) } as unknown as Texture;
		},
	};
	return { assets, loads };
}

describe('loadImpostorAtlas', () => {
	test('loads both images from the file’s folder, with the bake’s figures', async () => {
		const { assets, loads } = fakeAssets(FILE);
		const pine = await loadImpostorAtlas(assets, 'trees/pine-impostor.json');
		expect(loads).toEqual([
			{ url: 'trees/pine-impostor-color.png', options: { colorSpace: 'srgb', mipmaps: false } },
			{ url: 'trees/pine-impostor-surface.png', options: { colorSpace: 'linear', mipmaps: false } },
		]);
		expect(pine.atlas).toEqual({ columns: 5, rows: 5 });
		expect(pine.size).toEqual([2.4, 7.4]);
		expect(pine.room).toBe(1.2);
		expect(pine.depth).toBe(2.4);
		expect(String((pine.color as unknown as { url: string }).url)).toBe(
			'trees/pine-impostor-color.png',
		);
	});

	test('resolves the images against an absolute address', async () => {
		const { assets, loads } = fakeAssets(FILE);
		await loadImpostorAtlas(assets, new URL('https://example.com/a/pine.json?v=2'));
		expect(loads.map((load) => load.url)).toEqual([
			'https://example.com/a/pine-impostor-color.png',
			'https://example.com/a/pine-impostor-surface.png',
		]);
	});

	test('refuses a file of another format or version, naming what is wrong', async () => {
		await expect(loadImpostorAtlas(fakeAssets({ format: 'x' }).assets, 'a.json')).rejects.toThrow(
			'a.json is not an impostor atlas file: its format is not "null3d-impostor".',
		);
		await expect(
			loadImpostorAtlas(fakeAssets({ ...FILE, version: 2 }).assets, 'a.json'),
		).rejects.toThrow('its version is 2');
	});
});

describe('checkImpostorFile', () => {
	test('names the field that is wrong', () => {
		expect(() => checkImpostorFile({ ...FILE, atlas: { columns: 0, rows: 5 } }, 'f')).toThrow(
			'whole numbers of columns and rows',
		);
		expect(() => checkImpostorFile({ ...FILE, size: [1] }, 'f')).toThrow('a width and a height');
		expect(() => checkImpostorFile({ ...FILE, max: [1, 2] }, 'f')).toThrow('two corners');
		expect(() => checkImpostorFile(null, 'f')).toThrow('no JSON object');
		expect(checkImpostorFile(FILE, 'f')).toBe(FILE as never);
	});
});
