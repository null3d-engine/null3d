// Times a load of KTX2 files, for the cache of transcoded textures. The page starts the engine with
// the texture cache sketch and sends it the files that ?files= names: `test`, the KTX2 test files,
// or `city`, the city scene's textures, which the server lists. The sketch loads them all at once
// and answers once every texture is on the GPU. The page reports the time from navigation to that
// answer, the sketch's own times, and the entries that the cache held when the page started and
// once the engine wrote the new ones.
// ?clear deletes the cache first, as on a first visit. ?fresh gives each file's address a query of
// its own, so the browser's HTTP cache holds none of them, as on a first visit. The engine's
// ?texture-cache=off switch turns the cache off.
import { createEngine } from '@null3d/engine';
import { CACHE_NAME } from '../../packages/engine/src/scene/ktx2-cache';
import { SAMPLE_TEXTURES_LIST } from '../../tools/lib/sample-url';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
const files = params.get('files') ?? 'test';

/** The KTX2 test files: ETC1S, UASTC with alpha, and a size that takes no compressed format. */
const TEST_FILES = ['quarters-etc1s', 'quarters-uastc', 'ramp-uastc'].map(
	(name) => new URL(`./assets/textures/${name}.ktx2`, import.meta.url).href,
);

/** The addresses of the files that ?files= names. */
async function addresses(): Promise<string[]> {
	if (files === 'test') return TEST_FILES;
	if (files !== 'city') throw new Error(`?files=${files} names no set of files: use test or city`);
	const response = await fetch(SAMPLE_TEXTURES_LIST);
	if (!response.ok)
		throw new Error(`the server did not list the city's textures: ${response.status}`);
	const { textures } = (await response.json()) as { textures: string[] };
	return textures.map((path) => new URL(path, location.href).href);
}

/** The entries of the cache of transcoded textures, or null where the page has no Cache Storage. */
async function cacheEntries(): Promise<number | null> {
	if (!globalThis.caches) return null;
	if (!(await caches.has(CACHE_NAME))) return 0;
	return (await (await caches.open(CACHE_NAME)).keys()).length;
}

/** How often the page counts the cache's entries while the engine writes them. */
const POLL_MS = 50;
/** How long the count may stay the same before the page takes the writes as done. */
const SETTLED_MS = 1000;

/**
 * Waits until the cache holds an entry for each of `files`, or until its count stays the same for
 * a while, as the engine writes entries after it makes the textures. Files with the same bytes
 * share an entry. Then the page may stop the engine, which would end writes under way. Gives the
 * count, or null without Cache Storage, and when the page last saw it change.
 */
async function writesDone(files: number): Promise<{ count: number | null; lastMs: number }> {
	let count = await cacheEntries();
	let lastMs = performance.now();
	if (count === null || params.get('texture-cache') === 'off') return { count, lastMs };
	while (count < files && performance.now() - lastMs < SETTLED_MS) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		const now = (await cacheEntries()) ?? 0;
		if (now !== count) lastMs = performance.now();
		count = now;
	}
	return { count, lastMs };
}

/** What the sketch answers once every texture is on the GPU. */
interface SketchAnswer {
	/** Milliseconds from the sketch's message to the last texture made. */
	loadMs: number;
	/** Milliseconds from the sketch's message to the last texture on the GPU. */
	uploadedMs: number;
	/** True when the sketch's thread downloaded the transcoder's module. */
	transcoder: boolean;
	textures: { format: string; bytes: number }[];
}

run('texture-cache', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	if (params.has('clear') && globalThis.caches) await caches.delete(CACHE_NAME);
	const entriesBefore = await cacheEntries();
	const fresh = Date.now().toString(36);
	const urls = (await addresses()).map((address) => {
		const url = new URL(address);
		if (params.has('fresh')) url.searchParams.set('fresh', fresh);
		return url.href;
	});
	progress(`${urls.length} files to load`);
	const startMs = performance.now();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/texture-cache-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const engineMs = performance.now();
	const answer = new Promise<SketchAnswer>((resolve, reject) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'result') resolve(data as SketchAnswer);
			if (name === 'error') reject(new Error(String(data)));
		}),
	);
	engine.postToSketch('load', { urls });
	const sketch = await answer;
	const doneMs = performance.now();
	const writes = await writesDone(new Set(urls).size);
	const { mode, capabilities } = engine;
	await engine.destroy();
	return {
		mode,
		tier: capabilities.tier,
		files,
		count: urls.length,
		cache: params.get('texture-cache') !== 'off',
		entriesBefore,
		entriesAfter: writes.count,
		/** Milliseconds from every texture on the GPU to the last write to the cache. */
		writesMs: writes.lastMs - doneMs,
		/** Milliseconds from navigation to every texture on the GPU: what the visitor waits. */
		readyMs: doneMs,
		/** Milliseconds from navigation to the engine's start, and from there to every texture. */
		startMs,
		engineMs: engineMs - startMs,
		texturesMs: doneMs - engineMs,
		...sketch,
	};
});
