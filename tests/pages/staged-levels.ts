// Staged levels of detail in a live engine: the model loads with its coarsest level, and each finer
// level downloads from a file of its own while the page draws it (tests/pages/sketches/
// staged-levels-sketch.ts). The page captures the picture that the file itself draws, then waits
// for every stage, and captures the picture again: the spec holds the stage files back until the
// page says it captured the first, so the coarse picture is the one that the file holds. `?max=1`
// loads no stage at all, and gives the picture that a page which never shows the finest level
// draws. `?far` stands the camera where only the file's own level draws: the loader gives the
// stages that would never draw up, so one stage arrives and the finer ones are never asked for.
// `?near` starts at that camera and comes close after the loader gave them up: the stages that the
// camera then needs must arrive, within the wait that this page gives them.
//
// `?clusters` loads a model whose tree of cluster patches comes with its first band
// (sketches/cluster-staged-sketch.ts). It has the same four cameras and limits, and its stages are
// the tree's bands: the page captures the file's band, waits for the bands to refine the tree
// until the picture stops changing, and captures it again.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

declare global {
	interface Window {
		/** True once the page has captured the picture of the file's own level. */
		__stagedCoarse?: boolean;
	}
}

/** The model of the staged levels, as the sketch loads it. */
const MODEL = 'assets/models/staged-terrain.glb';
/** The model of the staged bands, as the sketch loads it. */
const CLUSTER_MODEL = 'assets/models/cluster-staged-terrain.glb';

/** How long the near page waits for the stages that its close camera brings back. */
const NEAR_WAIT_MS = 30_000;

/** How long the cluster page waits for its bands to stop refining the picture. */
const SETTLE_WAIT_MS = 30_000;

/**
 * How many stages the model names, read from its own JSON, so the page knows when every level or
 * band has arrived: the levels that replace the mesh's triangles and the bands that refine its
 * tree.
 */
async function stageCount(url: string): Promise<{ levels: number; bands: number }> {
	const bytes = await (await fetch(url)).arrayBuffer();
	const length = new DataView(bytes).getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))) as {
		nodes?: {
			extras?: { NULL3D_stages?: { levels?: unknown[]; bands?: unknown[] } };
		}[];
	};
	let levels = 0;
	let bands = 0;
	for (const node of json.nodes ?? []) {
		const staged = node.extras?.NULL3D_stages;
		levels += staged?.levels?.length ?? 0;
		bands += staged?.bands?.length ?? 0;
	}
	return { levels, bands };
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
	const clusters = params.has('clusters');
	// Each address is a literal, so a production build emits both sketches.
	const sketch = clusters
		? new URL('./sketches/cluster-staged-sketch.ts', import.meta.url)
		: new URL('./sketches/staged-levels-sketch.ts', import.meta.url);
	const far = params.has('far');
	const near = params.has('near');
	if (params.has('max')) sketch.search = `?max=${params.get('max')}`;
	else if (far) sketch.search = '?far=1';
	else if (near) sketch.search = '?near=1';
	const counts = await stageCount(clusters ? CLUSTER_MODEL : MODEL);
	const expected = clusters ? counts.bands : counts.levels;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	/** The messages of each name that no wait has taken yet. */
	const queues = new Map<string, unknown[]>();
	/** The waits for each name, waiting for its next message. */
	const waiting = new Map<string, ((data: unknown) => void)[]>();
	/** The list that the waits for each name join, which a wait that times out leaves again. */
	const waits = (name: string) => {
		let list = waiting.get(name);
		if (!list) {
			list = [];
			waiting.set(name, list);
		}
		return list;
	};
	engine.onSketchMessage((name, data) => {
		const next = waiting.get(name)?.shift();
		if (next) next(data);
		else queues.set(name, [...(queues.get(name) ?? []), data]);
	});
	/**
	 * Waits for the next message of `name`, and for at most `ms` when that is given. A wait that
	 * times out gives undefined and leaves the queue, so a message that comes later reaches the
	 * next wait.
	 */
	const message = (name: string, ms?: number) =>
		new Promise<unknown>((resolve) => {
			const queued = queues.get(name);
			if (queued && queued.length > 0) {
				resolve(queued.shift());
				return;
			}
			const list = waits(name);
			const take = () => {
				const at = list.indexOf(waiter);
				if (at >= 0) list.splice(at, 1);
			};
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waiter = (data: unknown) => {
				clearTimeout(timer);
				take();
				resolve(data);
			};
			if (ms !== undefined)
				timer = setTimeout(() => {
					take();
					resolve(undefined);
				}, ms);
			list.push(waiter);
		});
	await engine.firstFrame;
	const loaded = (await message('loaded')) as { levels: number };
	// The picture that the file draws, before any stage arrives: the spec holds them back.
	const coarse = await engine.captureFrame();
	window.__stagedCoarse = true;
	// Without a level limit the loader draws the file's level and then every stage, so the page waits
	// for the mesh to carry them all. With a limit it downloads no stage, and the count stays. The
	// far camera draws only the file's own level, so the loader brings one stage and gives the rest
	// up. The near page starts there and moves close, which must bring the stages that it gave up.
	const staged = !params.has('max') && expected > 0;
	const arriving = far ? 1 : expected;
	let levels = loaded.levels;
	/** Captures frames until two in a row agree and one differs from the coarse picture, or `ms` passes. */
	const settle = async (ms: number) => {
		const until = performance.now() + ms;
		let last = await engine.captureFrame();
		while (performance.now() < until) {
			await new Promise((resolve) => setTimeout(resolve, 600));
			const next = await engine.captureFrame();
			if (
				changed(last.pixels, next.pixels).changed < 0.0005 &&
				changed(coarse.pixels, next.pixels).changed > 0.01
			)
				return next;
			last = next;
		}
		return last;
	};
	let fine = coarse;
	if (clusters) {
		// A band of a tree appends to the patches that already draw, so the page cannot count the
		// bands that arrived. It waits for the picture to stop changing instead: every band that the
		// close camera draws has then arrived and drawn.
		if (near && staged) await message('near');
		if (staged && !far) fine = await settle(SETTLE_WAIT_MS);
		else {
			// A band that the camera would wrongly pick is asked for within a frame or two of the
			// band before it. Wait a few seconds, so the test would see that request. The far and
			// limited pages draw the same picture before and after the bands that arrive.
			await new Promise((resolve) => setTimeout(resolve, 5_000));
			fine = await engine.captureFrame();
		}
	} else {
		if (near && staged) {
			// The first stage arrives at once. The sketch waits out the warm-up that follows it, then
			// moves the camera close and says so.
			while (levels < 1) {
				const next = (await message('levels')) as { levels: number };
				levels = next.levels;
			}
			await message('near');
			const until = performance.now() + NEAR_WAIT_MS;
			while (levels < arriving && performance.now() < until) {
				const next = (await message('levels', 500)) as { levels: number } | undefined;
				if (next) levels = next.levels;
			}
		} else {
			while (staged && levels < arriving) {
				const next = (await message('levels')) as { levels: number };
				levels = next.levels;
			}
		}
		if (far) {
			// A stage that the camera would wrongly pick is asked for within a frame or two of the
			// first stage's arrival. Wait a few seconds, so the test would see that request.
			await new Promise((resolve) => setTimeout(resolve, 3_000));
		}
		// The thread that draws keeps frames queued ahead of a change, so its capture can answer with
		// the frame it drew before the stage's upload landed. The picture after the stages is the
		// first frame that differs from the coarse one: only a frame the renderer drew after the
		// change can differ, and a page on a slow runner waits as long as the drawing takes.
		const waitStart = performance.now();
		fine = await engine.captureFrame();
		// The far camera draws the same level before and after the stage that arrives, so its
		// pictures never differ where the others' must.
		while (staged && !far && changed(coarse.pixels, fine.pixels).changed === 0) {
			if (performance.now() - waitStart > 10_000)
				throw new Error(
					'no frame drawn after the stages arrived differs from the picture before them',
				);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			fine = await engine.captureFrame();
		}
	}
	const picture = changed(coarse.pixels, fine.pixels);
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		loaded: { ...loaded, staged },
		expected,
		levels,
		size: [coarse.width, coarse.height],
		changed: picture.changed,
		drawn: picture.drawn,
		fineDrawn: changed(fine.pixels, coarse.pixels).drawn,
		coarsePixels: toBase64(coarse.pixels),
		finePixels: toBase64(fine.pixels),
		failures,
	};
});
