// The stats overlay's figures and its text layout, apart from where the figures come from, so a
// page that draws with another engine, such as three.js, can print its own figures in the same
// layout. `@null3d/engine/stats` exports them.

import type { PageMemory } from './page-meters';

/**
 * One thread's CPU time per frame, in `StatsFigures.threads`.
 *
 * @category api/debug
 */
export interface StatsThread {
	/**
	 * The thread's name. Threads named `job-0`, `job-1` and so on show as one line, with the busiest
	 * of them.
	 */
	readonly name: string;
	/** Mean CPU time per frame on this thread, in milliseconds. */
	readonly busyMs: number;
	/** Mean CPU time per frame of each step of the frame on this thread, in milliseconds. */
	readonly phases?: Readonly<Record<string, number>>;
}

/**
 * The page's own thread over the last few seconds, in `StatsFigures.mainThread`.
 *
 * @category api/debug
 */
export interface StatsMainThread {
	/** The seconds that the figures cover. */
	readonly seconds: number;
	/** Tasks of 50 ms or more on the page's thread. */
	readonly longTasks: number;
	/** The longest of them in milliseconds, or 0 when there were none. */
	readonly longestTaskMs: number;
	/**
	 * The longest time from an input event to the page starting to handle it, in milliseconds, or
	 * null when no input came.
	 */
	readonly inputDelayMs: number | null;
}

/**
 * Memory figures in bytes, in `StatsFigures.memory`. Each is null where the page cannot know it,
 * and the overlay then shows `n/a`.
 *
 * @category api/debug
 */
export interface StatsMemory {
	/** The size of the engine's WebAssembly memory, which every engine thread shares. */
	readonly wasmBytes: number | null;
	/** The GPU bytes of every texture and render target. */
	readonly gpuTextureBytes: number | null;
	/** The GPU bytes of every buffer: vertices, indices, instances, uniforms and the like. */
	readonly gpuBufferBytes: number | null;
	/** The JavaScript heap of the page's own thread, where the browser has `performance.memory`. */
	readonly jsHeapBytes: number | null;
	/**
	 * The memory of the whole page and its workers, from the browser's own measurement, where the
	 * browser has `performance.measureUserAgentSpecificMemory`, on a cross-origin isolated page.
	 */
	readonly page: PageMemory | null;
}

/**
 * The figures that the stats overlay shows, in the form that `statsText` lays out. Means per frame
 * are over the last window of frames, about half a second.
 *
 * @category api/debug
 */
export interface StatsFigures {
	/** The first line, such as the GPU path, the quality preset and the render scale. */
	readonly heading: string;
	/** Frames in the window, or 0 before the first window ended. */
	readonly frames: number;
	/** Frames per second that reached the screen. */
	readonly presentedFps: number;
	/** Frames per second that the GPU finished, or null where the page does not know it. */
	readonly completedFps: number | null;
	/** Mean CPU time per frame of the busiest thread, in milliseconds. */
	readonly cpuMs: number;
	/** CPU time per frame of each thread. */
	readonly threads: readonly StatsThread[];
	/** Mean GPU time per frame, in milliseconds, or null where the GPU path cannot time frames. */
	readonly gpuMs: number | null;
	/** Mean draw calls per frame. */
	readonly drawCalls: number;
	/** Mean bytes uploaded to the GPU per frame, or null where the page does not know it. */
	readonly uploadBytes: number | null;
	/** Mean triangles drawn per frame, over every pass, or null where the page does not know it. */
	readonly triangles: number | null;
	/** Mean objects drawn per frame, over every pass, or null where the page does not know it. */
	readonly objects: number | null;
	/** The memory figures. */
	readonly memory: StatsMemory;
	/** The page's own thread, or null where the browser does not report long tasks. */
	readonly mainThread: StatsMainThread | null;
}

/** A phase's time per frame below which the overlay leaves the phase out. */
const SHOWN_MS = 0.005;
const MIB = 1024 * 1024;
const NONE = 'n/a';

const ms = (value: number) => `${value.toFixed(2)} ms`;

/** Bytes as MiB with one decimal, or `n/a`. */
function mib(bytes: number | null): string {
	return bytes === null ? NONE : `${(bytes / MIB).toFixed(1)} MiB`;
}

/** A count rounded to a whole number, in thousands (k) or millions (M) from 10,000 up. */
export function count(value: number | null): string {
	if (value === null) return NONE;
	if (value < 10_000) return `${Math.round(value)}`;
	if (value < 10_000_000) return `${(value / 1000).toFixed(1)} k`;
	return `${(value / 1_000_000).toFixed(2)} M`;
}

/** The page memory line: the measured figure, with the browser's own where the two differ. */
function pageLine(page: PageMemory | null): string {
	if (!page) return `page memory ${NONE}`;
	if (page.bytes === null) return 'page memory measuring';
	const browser = page.browserBytes !== page.bytes ? ` (browser ${mib(page.browserBytes)})` : '';
	return `page memory ${mib(page.bytes)}${browser}`;
}

/**
 * The stats overlay's text for a set of figures: one figure group per line, in a fixed order. A
 * figure that the page cannot know shows as `n/a`.
 *
 * @category api/debug
 */
export function statsText(figures: StatsFigures): string {
	const lines = [figures.heading];
	if (figures.frames === 0) {
		lines.push('waiting for frames');
		return lines.join('\n');
	}
	const completed =
		figures.completedFps === null ? '' : `, ${figures.completedFps.toFixed(1)} completed`;
	lines.push(
		`${figures.presentedFps.toFixed(1)} fps presented${completed}`,
		`busiest thread ${ms(figures.cpuMs)} per frame`,
	);
	let jobs = 0;
	let busiestJob = 0;
	for (const thread of figures.threads) {
		if (thread.name.startsWith('job-')) {
			jobs++;
			busiestJob = Math.max(busiestJob, thread.busyMs);
			continue;
		}
		lines.push(`${thread.name}  ${ms(thread.busyMs)}`);
		const phases = Object.entries(thread.phases ?? {})
			.filter(([, time]) => time >= SHOWN_MS)
			.map(([phase, time]) => `${phase} ${time.toFixed(2)}`);
		if (phases.length > 0) lines.push(`  ${phases.join('  ')}`);
	}
	if (jobs > 0) lines.push(`job workers (${jobs})  busiest ${ms(busiestJob)}`);
	const { memory, mainThread } = figures;
	const upload =
		figures.uploadBytes === null ? '' : `  upload ${(figures.uploadBytes / 1024).toFixed(1)} KB`;
	lines.push(
		`gpu ${figures.gpuMs === null ? NONE : `${ms(figures.gpuMs)} per frame`}`,
		`draw calls ${Math.round(figures.drawCalls)}${upload}`,
		`triangles ${count(figures.triangles)}  objects ${count(figures.objects)}`,
		`memory  wasm ${mib(memory.wasmBytes)}  js heap ${mib(memory.jsHeapBytes)}`,
		`gpu memory  textures ${mib(memory.gpuTextureBytes)}  buffers ${mib(memory.gpuBufferBytes)}`,
		pageLine(memory.page),
		mainThreadLine(mainThread),
	);
	return lines.join('\n');
}

/** The main thread line: its long tasks and its longest input delay over the last few seconds. */
function mainThreadLine(figures: StatsMainThread | null): string {
	if (!figures) return `main thread ${NONE}`;
	const longest = figures.longTasks > 0 ? ` (${Math.round(figures.longestTaskMs)} ms)` : '';
	const delay = figures.inputDelayMs === null ? NONE : `${Math.round(figures.inputDelayMs)} ms`;
	return `main thread ${Math.round(figures.seconds)} s  long tasks ${figures.longTasks}${longest}  input delay ${delay}`;
}
