// Times a page that loads a staged model from navigation to its first draw, and reports the bytes
// that arrived before it (bench/staged-load.ts). The sketch is the staged-levels one, or the
// cluster-bands one, so the page draws the model the way the image tests do. `?max=` passes the
// loader's level limit, and `?clusters` loads the model whose tree of patches streams its bands.
// After the first draw the page asks the load server what it sent, then keeps asking until the
// downloads stop: the difference is what arrived after the first picture, which is the stage files.
import { createEngine } from '@null3d/engine';
import { type Downloads, downloadsPath, parseLoadPath } from '../lib/load-routes';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
/** True for the model whose tree of cluster patches streams its bands. */
const CLUSTERS = params.has('clusters');

/** How long the page waits for the last download before it answers. */
const SETTLE_MS = 60_000;

/** How long a stretch with no download means that the stages have all arrived. */
const QUIET_MS = 2_000;

/** How often the page asks the server what it sent. */
const POLL_MS = 250;

run('staged-start', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// Each address is a literal, so a production build emits both sketches.
	const sketch = CLUSTERS
		? new URL('./sketches/cluster-staged-sketch.ts', import.meta.url)
		: new URL('./sketches/staged-levels-sketch.ts', import.meta.url);
	const max = Number(params.get('max') ?? 0);
	if (max > 0) sketch.search = `?max=${max}`;
	const load = parseLoadPath(location.pathname);
	/** What the load server sent since the last ask, added to `total`. */
	const take = async (): Promise<Downloads> => {
		if (!load) return { requests: 0, bytes: 0, files: [] };
		const response = await fetch(downloadsPath(load));
		if (!response.ok) throw new Error(`the server did not tell the downloads: ${response.status}`);
		const { requests, bytes, files } = (await response.json()) as Downloads;
		return { requests, bytes, files };
	};
	const engine = await createEngine({ canvas, sketch });
	await engine.firstFrame;
	const firstFrameMs = performance.now();
	// Everything that the page had downloaded when its first picture was drawn.
	const before = await take();
	const total: Downloads = { requests: before.requests, bytes: before.bytes, files: [] };
	let quietSince = performance.now();
	const until = performance.now() + SETTLE_MS;
	while (performance.now() < until) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		const next = await take();
		if (next.requests > 0) quietSince = performance.now();
		total.requests += next.requests;
		total.bytes += next.bytes;
		total.files.push(...next.files);
		if (performance.now() - quietSince > QUIET_MS) break;
	}
	return {
		tier: engine.capabilities.tier,
		firstFrameMs,
		before,
		total,
		max,
	};
});
