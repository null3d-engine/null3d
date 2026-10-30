// Keeps one line in a page's trail that says where its start went: the time that the sketch's setup
// spent growing the scene, the pipelines that the first draw built and how long they took, and the
// time that the first frame took. The engine publishes its frame figures as the start makes them,
// so the line follows a start that never finishes: a page that times out quotes the trail's last
// steps, and the line among them names the phase that held it.
//
// The line is replaced in place, so it takes one step of the trail: three steps could leave the
// quoted ones, and a line per poll would push the page's own steps out of the quote.

import { MetricsReader } from '../../../packages/engine/src/shared/metrics';

/** How often the line follows the engine's figures, in milliseconds. */
const POLL_MS = 1000;

/** What the trail says about `reader`'s start, at the current time. */
function timingsLine(reader: MetricsReader, now: number): string {
	// Each time the page held a phase is an epoch millisecond, so a figure that a worker wrote
	// compares with the page's clock.
	const setupStart = reader.setupStart;
	const setupMs = reader.setupMs;
	const grew =
		setupMs !== null
			? `grew ${Math.round(setupMs)} ms`
			: setupStart > 0
				? `growing for ${Math.round(now - setupStart)} ms`
				: 'grew nothing yet';
	const pipelines = reader.firstFramePipelines;
	const warmUpStart = reader.warmUpStart;
	const warmUpMs = reader.warmUpMs;
	const built =
		pipelines !== null
			? `built ${pipelines} pipelines in ${Math.round(warmUpMs ?? 0)} ms`
			: warmUpStart > 0
				? `building pipelines for ${Math.round(now - warmUpStart)} ms`
				: 'built no pipelines yet';
	const drawMs = reader.firstDrawMs;
	const first = drawMs !== null ? `first frame ${Math.round(drawMs)} ms` : 'first frame not drawn';
	return `${grew}, ${built}, ${first}`;
}

/**
 * Follows the start that the page makes, and keeps its line in `trail`. The engine publishes its
 * frame figures on the page as it makes them; a page that starts no engine notes nothing.
 */
export function watchStartTimings(trail: string[]): void {
	let reader: MetricsReader | undefined;
	let buffer: ArrayBufferLike | undefined;
	/** The place of this line in the trail, or -1 before the page noted one. */
	let at = -1;
	let line = '';
	const show = (text: string) => {
		if (text === line) return;
		line = text;
		if (at >= 0) trail.splice(at, 1);
		at = trail.length;
		trail.push(`${Math.round(performance.now())} ms ${text}`);
	};
	setInterval(() => {
		const next = (globalThis as { __null3dMetrics?: ArrayBufferLike }).__null3dMetrics;
		if (next === undefined) return;
		if (next !== buffer) {
			buffer = next;
			reader = new MetricsReader(next);
		}
		if (reader !== undefined) show(timingsLine(reader, performance.timeOrigin + performance.now()));
	}, POLL_MS);
}
