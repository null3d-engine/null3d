import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { Downloads, type FetchFile } from './downloads';
import { serialLoadWarning } from './serial-loads';

const PAGE = 'https://game.example/levels/one.html';
const at = (path: string) => new URL(path, PAGE);

/** A fetch whose answers the test gives, one address at a time, in any order. */
function heldFetches() {
	const asked: string[] = [];
	const answers = new Map<string, (response: Response) => void>();
	const fetchFile: FetchFile = (address) => {
		asked.push(address.pathname);
		return new Promise((resolve) => answers.set(address.pathname, resolve));
	};
	/** Answers the fetch of `path` with `body`, or with a status, and lets the download finish. */
	const answer = async (path: string, body: string | number = path) => {
		const resolve = answers.get(path);
		if (!resolve) throw new Error(`${path} was not fetched`);
		answers.delete(path);
		resolve(
			typeof body === 'number'
				? new Response('', { status: body })
				: new Response(body, { headers: { 'content-length': String(body.length) } }),
		);
		// The body reads, and the next file starts, over a few turns of the event loop.
		for (let turn = 0; turn < 10; turn++) await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	};
	return { asked, fetchFile, answer };
}

const realFetch = globalThis.fetch;

beforeEach(() => setErrorFixes(ERROR_FIXES));
afterEach(() => {
	globalThis.fetch = realFetch;
});

/**
 * Lists `paths` the way the thread that runs the sketch does: the first two fetched at once, and at
 * most `most` downloading while loads wait for them.
 */
function listOf(downloads: Downloads, paths: string[], fetchFile: FetchFile, most = 4): void {
	const addresses = paths.map(at);
	downloads.list(addresses, addresses.slice(0, 2).map(fetchFile), 2, most, fetchFile);
}

describe('the download list', () => {
	test('keeps two files downloading at once, in the list order, and each load takes its file without a second fetch', async () => {
		const held = heldFetches();
		// A load that the list did not start fetches through the page's own fetch.
		globalThis.fetch = (async () => {
			throw new Error('a listed file was fetched again');
		}) as unknown as typeof fetch;
		const downloads = new Downloads(PAGE);
		listOf(downloads, ['/a.glb', '/b.glb', '/c.glb', '/d.glb'], held.fetchFile);
		expect(held.asked).toEqual(['/a.glb', '/b.glb']);
		await held.answer('/a.glb');
		expect(held.asked).toEqual(['/a.glb', '/b.glb', '/c.glb']);
		const a = await downloads.load(at('/a.glb'), 'assets.loadBinary');
		expect(await a.text()).toBe('/a.glb');
		await held.answer('/b.glb');
		await held.answer('/c.glb');
		expect(held.asked).toEqual(['/a.glb', '/b.glb', '/c.glb', '/d.glb']);
		await held.answer('/d.glb');
		for (const path of ['/b.glb', '/c.glb', '/d.glb'])
			expect(await (await downloads.load(at(path), 'assets.loadBinary')).text()).toBe(path);
	});

	test('a load of a file that the list has not started starts it at once, and later files wait for it', async () => {
		const held = heldFetches();
		const loaded: string[] = [];
		globalThis.fetch = (async (input: URL) => {
			loaded.push(input.pathname);
			return new Response('d');
		}) as unknown as typeof fetch;
		const downloads = new Downloads(PAGE);
		listOf(downloads, ['/a.glb', '/b.glb', '/c.glb', '/d.glb'], held.fetchFile);
		const d = downloads.load(at('/d.glb'), 'assets.loadGltf');
		expect(await (await d).text()).toBe('d');
		// The load fetched at its own priority, through the page's fetch, and only once.
		expect(loaded).toEqual(['/d.glb']);
		await held.answer('/a.glb');
		expect(held.asked).toEqual(['/a.glb', '/b.glb', '/c.glb']);
		expect(held.asked).not.toContain('/d.glb');
	});

	test('a load past the most at once waits ahead of the rest of the list, and starts as a download ends', async () => {
		const held = heldFetches();
		// The loads' own downloads answer when the test says, as the list's do.
		globalThis.fetch = ((input: URL) => held.fetchFile(input)) as unknown as typeof fetch;
		const downloads = new Downloads(PAGE);
		listOf(downloads, ['/a.glb', '/b.glb', '/c.glb', '/d.glb', '/e.glb'], held.fetchFile, 3);
		const c = downloads.load(at('/c.glb'), 'assets.loadGltf');
		const d = downloads.load(at('/d.glb'), 'assets.loadGltf');
		// Two of the list's own and one that a load asked for download; the second load waits.
		expect(held.asked).toEqual(['/a.glb', '/b.glb', '/c.glb']);
		expect(downloads.load(at('/d.glb'), 'assets.loadGltf')).toBe(d);
		await held.answer('/a.glb');
		// The waiting load goes first, ahead of the list's next file.
		expect(held.asked).toEqual(['/a.glb', '/b.glb', '/c.glb', '/d.glb']);
		await held.answer('/b.glb');
		// The list's own files start only while fewer than two listed files download.
		expect(held.asked).not.toContain('/e.glb');
		await held.answer('/c.glb');
		expect(held.asked).toContain('/e.glb');
		await held.answer('/d.glb');
		await held.answer('/e.glb');
		expect(await (await c).text()).toBe('/c.glb');
		expect(await (await d).text()).toBe('/d.glb');
		expect(held.asked.filter((path) => path === '/d.glb')).toHaveLength(1);
	});

	test('a listed file that fails reaches the load that takes it, and a file that no load takes costs only its download', async () => {
		const held = heldFetches();
		const downloads = new Downloads(PAGE);
		listOf(downloads, ['/missing.glb', '/unused.glb'], held.fetchFile);
		await held.answer('/missing.glb', 404);
		await held.answer('/unused.glb');
		let caught: unknown;
		try {
			await downloads.load(at('/missing.glb'), 'assets.loadGltf');
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(EngineError);
		expect((caught as EngineError).message).toStartWith(
			'E1411: the downloads of defineSketch() could not download https://game.example/missing.glb: HTTP 404.',
		);
		expect(held.asked).toEqual(['/missing.glb', '/unused.glb']);
	});

	test('a handler that the setup adds after the list started still sees the bytes arrive', async () => {
		const held = heldFetches();
		const downloads = new Downloads(PAGE);
		listOf(downloads, ['/a.bin'], held.fetchFile);
		const seen: [number, number, string][] = [];
		downloads.onProgress((loaded, total, url) => seen.push([loaded, total, url]));
		await held.answer('/a.bin', 'abcd');
		expect(seen.at(-1)).toEqual([4, 4, 'https://game.example/a.bin']);
	});
});

describe('the warning for loads one after another', () => {
	/**
	 * Downloads whose answers come at once, watched, with each warning that they print. The fetch of
	 * `/slow.glb` answers only when the test calls `finishSlow`.
	 */
	function watched(watching = true) {
		let finish = () => {};
		const slow = new Promise<void>((resolve) => {
			finish = resolve;
		});
		globalThis.fetch = (async (input: URL) => {
			if (input.pathname === '/slow.glb') await slow;
			return new Response(input.pathname);
		}) as unknown as typeof fetch;
		const warnings: string[] = [];
		const warn = spyOn(console, 'warn').mockImplementation((text: string) => {
			warnings.push(text);
		});
		const downloads = new Downloads(PAGE);
		downloads.watch(() => watching);
		return { downloads, warnings, finishSlow: finish, restore: () => warn.mockRestore() };
	}

	test('warns once, naming both files, when a load starts only after another load had its file', async () => {
		const { downloads, warnings, restore } = watched();
		try {
			await downloads.load(at('/a.ktx2'), 'assets.loadEnvironment');
			await downloads.load(at('/b.glb'), 'assets.loadGltf');
			await downloads.load(at('/c.glb'), 'assets.loadGltf');
			expect(warnings).toEqual([
				serialLoadWarning(
					'assets.loadGltf',
					'https://game.example/a.ktx2 had arrived',
					at('/b.glb'),
				),
			]);
			expect(warnings[0]).toContain('https://game.example/b.glb');
			expect(warnings[0]).toContain('serialLoadWarning: false');
		} finally {
			restore();
		}
	});

	test('counts an environment that the engine made with no file as an earlier load', async () => {
		const { downloads, warnings, restore } = watched();
		try {
			downloads.noteMade("assets.builtinEnvironment('room')");
			await downloads.load(at('/ship.glb'), 'assets.loadGltf');
			expect(warnings).toEqual([
				serialLoadWarning(
					'assets.loadGltf',
					"assets.builtinEnvironment('room') had finished",
					at('/ship.glb'),
				),
			]);
		} finally {
			restore();
		}
	});

	test("stays quiet while another file downloads, for a model's own files, and outside the setup", async () => {
		const quiet = watched();
		try {
			const a = quiet.downloads.load(at('/a.glb'), 'assets.loadGltf');
			const slow = quiet.downloads.load(at('/slow.glb'), 'assets.loadGltf');
			await a;
			// The link is not idle: the other file still downloads.
			await quiet.downloads.load(at('/b.glb'), 'assets.loadGltf');
			quiet.finishSlow();
			await slow;
			// A model's own files are the loader's, not the sketch's own loads.
			await quiet.downloads.file(at('/texture.png'), 'assets.loadGltf');
			expect(quiet.warnings).toEqual([]);
		} finally {
			quiet.restore();
		}
		const after = watched(false);
		try {
			await after.downloads.load(at('/a.glb'), 'assets.loadGltf');
			await after.downloads.load(at('/b.glb'), 'assets.loadGltf');
			expect(after.warnings).toEqual([]);
		} finally {
			after.restore();
		}
	});

	test('stays quiet for files that a preload started, and for a file that the JSON before it names', async () => {
		const preloaded = watched();
		try {
			await preloaded.downloads.preload([at('/a.glb'), at('/b.glb')], 'assets.preload');
			await preloaded.downloads.load(at('/a.glb'), 'assets.loadGltf');
			await preloaded.downloads.load(at('/b.glb'), 'assets.loadGltf');
			expect(preloaded.warnings).toEqual([]);
		} finally {
			preloaded.restore();
		}
		const named = watched();
		try {
			await named.downloads.load(at('/level.json'), 'assets.loadJson');
			named.downloads.noteText(at('/level.json'), '{"model":"models/ship.glb"}');
			await named.downloads.load(at('/models/ship.glb'), 'assets.loadGltf');
			expect(named.warnings).toEqual([]);
			// A file that the JSON does not name still warns.
			await named.downloads.load(at('/models/boat.glb'), 'assets.loadGltf');
			expect(named.warnings).toHaveLength(1);
		} finally {
			named.restore();
		}
	});
});
