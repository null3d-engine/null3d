import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { jpegHeader, pngHeader } from '../../../../tests/pages/lib/image-headers';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { Assets } from './assets';
import type { Texture, TextureOptions, Textures } from './textures';

const PAGE = 'https://game.example/levels/one.html';

/** What the fake server answers for each address: a body, an HTTP status, or a network failure. */
type Answer = string | Uint8Array<ArrayBuffer> | number | 'network';

const realFetch = globalThis.fetch;
const realDecode = globalThis.createImageBitmap;

/** The addresses fetched, in order, and the options of each decode. */
let fetched: string[];
let decoded: ImageBitmapOptions[];

/** Answers fetches from `answers`, and decodes any body but 'broken' into a 4 x 2 image. */
function serve(answers: Record<string, Answer>): void {
	globalThis.fetch = (async (input: string | URL) => {
		const url = String(input);
		fetched.push(url);
		const answer = answers[url];
		if (answer === undefined || answer === 'network') throw new TypeError('Failed to fetch');
		if (typeof answer === 'number') return new Response('', { status: answer });
		return new Response(answer);
	}) as typeof fetch;
	globalThis.createImageBitmap = (async (blob: Blob, options: ImageBitmapOptions) => {
		decoded.push(options);
		if ((await blob.text()) === 'broken')
			throw new DOMException('The source image could not be decoded.');
		return { width: 4, height: 2, close() {} } as ImageBitmap;
	}) as typeof createImageBitmap;
}

/** Textures that record what `fromImage` got. */
function fakeTextures() {
	const made: [ImageBitmap, TextureOptions, number][] = [];
	const textures = {
		fromImage(image: ImageBitmap, options: TextureOptions, premultiplied: number) {
			made.push([image, options, premultiplied]);
			return { width: image.width } as Texture;
		},
	} as unknown as Textures;
	return { textures, made };
}

beforeEach(() => {
	setErrorFixes(ERROR_FIXES);
	fetched = [];
	decoded = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
	globalThis.createImageBitmap = realDecode;
});

/**
 * The code and details of the error that `load` rejects with: its message up to the fix, which
 * starts after the details' closing period.
 */
async function codeOf(load: Promise<unknown>): Promise<string> {
	try {
		await load;
	} catch (error) {
		if (!(error instanceof EngineError)) return String(error);
		const fix = ERROR_FIXES[error.code];
		return error.message.slice(0, error.message.indexOf(` ${fix}`));
	}
	return 'resolved';
}

describe('assets', () => {
	test('resolves addresses against the page, and decodes as the texture options ask', async () => {
		serve({ 'https://game.example/levels/tex/brick.png': 'png' });
		const { textures, made } = fakeTextures();
		const assets = new Assets(textures, PAGE);
		const texture = await assets.loadTexture('tex/brick.png');
		expect(texture.width).toBe(4);
		expect(decoded[0]).toEqual({
			premultiplyAlpha: 'none',
			colorSpaceConversion: 'default',
			imageOrientation: 'flipY',
		});
		await assets.loadTexture('/levels/tex/brick.png', {
			colorSpace: 'linear',
			flipY: false,
			premultipliedAlpha: true,
			wrap: 'repeat',
		});
		expect(decoded[1]).toEqual({ premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' });
		expect(made[1]?.[1].wrap).toBe('repeat');
		expect(made.map(([, , premultiplied]) => premultiplied)).toEqual([0, 1]);
		const bitmap = await assets.loadImageBitmap(
			new URL('https://game.example/levels/tex/brick.png'),
		);
		expect(bitmap.height).toBe(2);
		expect(fetched).toEqual(Array(3).fill('https://game.example/levels/tex/brick.png'));
	});

	test('loads JSON and bytes', async () => {
		serve({
			'https://game.example/level.json': '{"enemies":3}',
			'https://game.example/bad.json': '{enemies',
			'https://game.example/blob.bin': 'abc',
		});
		const assets = new Assets(fakeTextures().textures, PAGE);
		expect(await assets.loadJson<{ enemies: number }>('/level.json')).toEqual({ enemies: 3 });
		const bytes = await assets.loadBinary('/blob.bin');
		expect([...new Uint8Array(bytes)]).toEqual([97, 98, 99]);
		expect(await codeOf(assets.loadJson('/bad.json'))).toStartWith(
			'E1412: assets.loadJson() could not read https://game.example/bad.json as JSON',
		);
	});

	test('reports each download in order, and loads take preloaded files from memory', async () => {
		serve({
			'https://game.example/a.png': 'a',
			'https://game.example/b.bin': 'b',
			'https://game.example/c.json': '1',
		});
		const { textures } = fakeTextures();
		const assets = new Assets(textures, PAGE);
		const events: string[] = [];
		const stop = assets.onProgress((loaded, total, url) =>
			events.push(`${loaded}/${total} ${url}`),
		);
		await assets.preload(['/a.png', '/b.bin', '/c.json', '/a.png']);
		expect(events).toEqual([
			'1/3 https://game.example/a.png',
			'2/3 https://game.example/b.bin',
			'3/3 https://game.example/c.json',
		]);
		await assets.loadTexture('/a.png');
		await assets.loadBinary('/b.bin');
		expect(await assets.loadJson<number>('/c.json')).toBe(1);
		expect(fetched.length).toBe(3);
		expect(events.length).toBe(3);
		// The next load of an address downloads again, and counts again.
		await assets.loadBinary('/b.bin');
		expect(events.at(-1)).toBe('4/4 https://game.example/b.bin');
		// Loads of one address at the same time share one download.
		await Promise.all([assets.loadBinary('/b.bin'), assets.loadBinary('/b.bin')]);
		expect(fetched.length).toBe(5);
		stop();
		await assets.loadBinary('/b.bin');
		expect(events.length).toBe(5);
	});

	test('an image whose header claims more pixels than its use takes fails with E1412 before it decodes', async () => {
		serve({
			'https://game.example/huge.png': pngHeader(65536, 65536) as Uint8Array<ArrayBuffer>,
			'https://game.example/wide.jpg': jpegHeader(20000, 10) as Uint8Array<ArrayBuffer>,
			'https://game.example/ok.png': pngHeader(4096, 2) as Uint8Array<ArrayBuffer>,
		});
		const { textures } = fakeTextures();
		Object.defineProperty(textures, 'maxSize', { value: 4096 });
		const assets = new Assets(textures, PAGE);
		expect(await codeOf(assets.loadTexture('/huge.png'))).toBe(
			'E1412: assets.loadTexture() could not decode https://game.example/huge.png as an image: its header gives 65536 x 65536 pixels, larger than the 4096 a side that it may have.',
		);
		// A bitmap for other uses may reach the largest canvas, 16,384 a side.
		expect(await codeOf(assets.loadImageBitmap('/wide.jpg'))).toContain(
			'its header gives 20000 x 10 pixels, larger than the 16384 a side',
		);
		expect(decoded).toEqual([]);
		await assets.loadTexture('/ok.png');
		expect(decoded).toHaveLength(1);
	});

	test('a missing file gives E1411, a blocked file of another origin E1413, and a broken image E1412', async () => {
		serve({
			'https://game.example/missing.png': 404,
			'https://game.example/offline.png': 'network',
			'https://cdn.example/brick.png': 'network',
			'https://game.example/broken.png': 'broken',
		});
		const assets = new Assets(fakeTextures().textures, PAGE);
		const events: number[] = [];
		assets.onProgress((loaded) => events.push(loaded));
		expect(await codeOf(assets.loadTexture('/missing.png'))).toBe(
			'E1411: assets.loadTexture() could not download https://game.example/missing.png: HTTP 404.',
		);
		expect(await codeOf(assets.loadBinary('/offline.png'))).toBe(
			'E1411: assets.loadBinary() could not download https://game.example/offline.png: Failed to fetch.',
		);
		expect(await codeOf(assets.loadTexture('https://cdn.example/brick.png'))).toBe(
			'E1413: assets.loadTexture() could not read https://cdn.example/brick.png: its server did not allow this page to read it, or could not be reached (Failed to fetch).',
		);
		expect(await codeOf(assets.loadTexture('/broken.png'))).toBe(
			'E1412: assets.loadTexture() could not decode https://game.example/broken.png as an image: The source image could not be decoded.',
		);
		// Failed downloads count as done, so a loading bar reaches its end.
		expect(events).toEqual([1, 2, 3, 4]);
		// A failed preload rejects, and the next load of the file tries again.
		expect(await codeOf(assets.preload(['/missing.png']))).toStartWith('E1411: assets.preload()');
		expect(await codeOf(assets.loadBinary('/missing.png'))).toStartWith(
			'E1411: assets.loadBinary()',
		);
		expect(fetched.filter((url) => url.endsWith('missing.png')).length).toBe(3);
	});
});
