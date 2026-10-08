// The stats overlay that `debug.stats`, `engine.stats` and the `stats` option show: a text box over
// the top-left corner of the canvas, which the page updates from the metrics buffer a few times a
// second. The page owns the overlay's element, and the engine's threads write the figures it reads
// as they always do. While it shows, the engine samples the costly figures: GPU time, the counts of
// the draws that the GPU culls, and the memory figures that the sketch thread publishes. The page
// adds what only it can measure: its JavaScript heap, the whole page's memory and its own thread's
// long tasks and input delay. The box ignores the pointer, so input still reaches the canvas.

import { MainThreadWatch } from '../page/main-thread';
import { PageMemorySampler, pageHeapBytes } from '../page/page-memory';
import { sampleFrames } from '../shared/metrics';
import { type FrameStats, FrameStatsWindow, type StatsSources } from './stats';
import { type StatsFigures, type StatsMainThread, statsText } from './stats-text';

/** What the overlay reads. */
export interface OverlaySetup {
	/** The canvas the overlay sits on. */
	canvas: HTMLCanvasElement;
	/** The metrics buffer that the engine's threads write. */
	metrics: ArrayBufferLike;
	/** Each engine thread's name and the roles it runs, as `engine.measure` names them. */
	threads: Iterable<readonly [string, readonly number[]]>;
	/** The tier, the preset, the render scale and the WebAssembly memory's size. */
	sources: StatsSources;
	/** True when the engine's threads share its WebAssembly memory: the threaded build. */
	sharedMemory: boolean;
}

/** How often the overlay reads new figures and follows the canvas. */
const REFRESH_MS = 250;
/** Windows of frame figures that the main thread's figures cover: about 5 seconds. */
const MAIN_THREAD_WINDOWS = 10;
/** The attribute that marks the overlay's element. */
export const OVERLAY_ATTRIBUTE = 'data-null3d-stats';

const STYLE: Partial<CSSStyleDeclaration> = {
	position: 'absolute',
	zIndex: '2147483647',
	margin: '0',
	padding: '4px 6px',
	font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
	color: '#f2f2f2',
	background: 'rgba(0, 0, 0, 0.72)',
	pointerEvents: 'none',
	whiteSpace: 'pre',
};

/** What only the page measures, beside the engine's frame figures. */
export type PageFigures = Pick<StatsFigures, 'mainThread'> & {
	jsHeapBytes: number | null;
	page: StatsFigures['memory']['page'];
};

/** The overlay's figures: the engine's frame figures, with the page's own. */
export function overlayFigures(stats: FrameStats, page: PageFigures): StatsFigures {
	return {
		heading: `${stats.tier}  ${stats.preset}  scale ${stats.renderScale.toFixed(2)}`,
		frames: stats.frames,
		presentedFps: stats.presentedFps,
		completedFps: stats.completedFps,
		cpuMs: stats.cpuMs,
		threads: stats.threads,
		gpuMs: stats.gpuMs,
		drawCalls: stats.drawCalls,
		uploadBytes: stats.uploadBytes,
		triangles: stats.triangles,
		objects: stats.objects,
		memory: {
			wasmBytes: stats.wasmBytes,
			textureBytes: stats.textureBytes,
			meshBytes: stats.meshBytes,
			jsHeapBytes: page.jsHeapBytes,
			page: page.page,
		},
		mainThread: page.mainThread,
	};
}

/** The main thread's figures over the last few windows, from one window's figures after another. */
export class RecentMainThread {
	private readonly windows: StatsMainThread[] = [];

	/** Takes in a window's figures, and returns those of the last few windows together. */
	add(window: StatsMainThread | null): StatsMainThread | null {
		if (!window) return null;
		this.windows.push(window);
		if (this.windows.length > MAIN_THREAD_WINDOWS) this.windows.shift();
		let seconds = 0;
		let longTasks = 0;
		let longestTaskMs = 0;
		let inputDelayMs: number | null = null;
		for (const each of this.windows) {
			seconds += each.seconds;
			longTasks += each.longTasks;
			longestTaskMs = Math.max(longestTaskMs, each.longestTaskMs);
			if (each.inputDelayMs !== null) inputDelayMs = Math.max(inputDelayMs ?? 0, each.inputDelayMs);
		}
		return { seconds, longTasks, longestTaskMs, inputDelayMs };
	}
}

export class StatsOverlay {
	private readonly element: HTMLPreElement;
	private readonly window: FrameStatsWindow;
	private readonly timer: ReturnType<typeof setInterval>;
	private readonly mainThread = new MainThreadWatch(false);
	private readonly recent = new RecentMainThread();
	private readonly pageMemory: PageMemorySampler;

	constructor(private readonly setup: OverlaySetup) {
		const { metrics, sources } = setup;
		sampleFrames(metrics, true);
		this.window = new FrameStatsWindow(metrics, setup.threads, sources);
		this.pageMemory = new PageMemorySampler(() => (setup.sharedMemory ? sources.wasmBytes() : 0));
		this.pageMemory.start();
		const element = document.createElement('pre');
		element.setAttribute(OVERLAY_ATTRIBUTE, '');
		Object.assign(element.style, STYLE);
		element.textContent = this.text(null);
		document.body.append(element);
		this.element = element;
		this.follow();
		this.timer = setInterval(() => this.refresh(), REFRESH_MS);
	}

	remove(): void {
		clearInterval(this.timer);
		this.element.remove();
		this.mainThread.stop();
		this.pageMemory.stop();
		sampleFrames(this.setup.metrics, false);
	}

	private refresh(): void {
		this.follow();
		if (!this.window.update()) return;
		const main = this.recent.add(this.mainThread.takeWindow());
		this.element.textContent = this.text(main);
	}

	private text(mainThread: StatsMainThread | null): string {
		return statsText(
			overlayFigures(this.window.stats, {
				jsHeapBytes: pageHeapBytes(),
				page: this.pageMemory.page,
				mainThread,
			}),
		);
	}

	/** Puts the overlay on the canvas's top-left corner, and hides it while the canvas is off the page. */
	private follow(): void {
		const { canvas } = this.setup;
		const { element } = this;
		element.hidden = !canvas.isConnected;
		const rect = canvas.getBoundingClientRect();
		element.style.left = `${rect.left + scrollX}px`;
		element.style.top = `${rect.top + scrollY}px`;
	}
}
