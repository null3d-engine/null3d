// Staged levels of detail in a live engine: the model loads with its coarsest level, and each finer
// level downloads from a file of its own while the page draws it (tests/pages/sketches/
// staged-levels-sketch.ts). The page captures the picture that the file itself draws, then waits
// for every stage, and captures the picture again: the spec holds the stage files back until the
// page says it captured the first, so the coarse picture is the one that the file holds. `?max=1`
// loads no stage at all, and gives the picture that a page which never shows the finest level
// draws.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		/** True once the page has captured the picture of the file's own level. */
		__stagedCoarse?: boolean;
	}
}

/** The model, as the sketch loads it. */
const MODEL = 'assets/models/staged-terrain.glb';

/**
 * How many stages the model names, read from its own JSON, so the page knows when every level has
 * arrived.
 */
async function stageCount(url: string): Promise<number> {
	const bytes = await (await fetch(url)).arrayBuffer();
	const length = new DataView(bytes).getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))) as {
		nodes?: { extras?: { NULL3D_stages?: { levels: unknown[] } } }[];
	};
	const node = json.nodes?.find((n) => n.extras?.NULL3D_stages);
	return node?.extras?.NULL3D_stages?.levels.length ?? 0;
}

/**
 * How two pictures of one size differ: the share of the pixels that changed, and the share that the
 * first picture draws over its background, which is its top-left pixel.
 */
function changed(a: Uint8Array, b: Uint8Array): { changed: number; drawn: number } {
	const [r, g, bl] = [a[0], a[1], a[2]];
	let different = 0;
	let drawn = 0;
	for (let at = 0; at < a.length; at += 4) {
		if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2]) different += 1;
		if (a[at] !== r || a[at + 1] !== g || a[at + 2] !== bl) drawn += 1;
	}
	const pixels = a.length / 4;
	return { changed: different / pixels, drawn: drawn / pixels };
}

run('staged-levels', async () => {
	const params = new URLSearchParams(location.search);
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/staged-levels-sketch.ts', import.meta.url);
	if (params.has('max')) sketch.search = `?max=${params.get('max')}`;
	const expected = await stageCount(MODEL);
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	/** The messages of each name that no wait has taken yet. */
	const queues = new Map<string, unknown[]>();
	/** The waits for each name, waiting for its next message. */
	const waiting = new Map<string, ((data: unknown) => void)[]>();
	engine.onSketchMessage((name, data) => {
		const next = waiting.get(name)?.shift();
		if (next) next(data);
		else queues.set(name, [...(queues.get(name) ?? []), data]);
	});
	const message = (name: string) =>
		new Promise<unknown>((resolve) => {
			const queued = queues.get(name);
			if (queued && queued.length > 0) resolve(queued.shift());
			else waiting.set(name, [...(waiting.get(name) ?? []), resolve]);
		});
	await engine.firstFrame;
	const loaded = (await message('loaded')) as { levels: number; staged: boolean };
	// The picture that the file draws, before any stage arrives: the spec holds them back.
	const coarse = await engine.captureFrame();
	window.__stagedCoarse = true;
	let levels = loaded.levels;
	while (loaded.staged && levels < expected) {
		const next = (await message('levels')) as { levels: number };
		levels = next.levels;
	}
	const fine = await engine.captureFrame();
	const picture = changed(coarse.pixels, fine.pixels);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		loaded,
		expected,
		levels,
		size: [coarse.width, coarse.height],
		changed: picture.changed,
		drawn: picture.drawn,
		failures,
	};
});
