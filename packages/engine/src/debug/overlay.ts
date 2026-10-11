// The stats overlay that `debug.stats`, `engine.stats` and the `stats` option show: a panel over
// the top-right corner of the canvas, which the page updates from the metrics buffer a few times a
// second. The page owns the overlay's element, and the engine's threads write the figures it reads
// as they always do. The panel's header is a button with the frame rate, which shows and hides a
// card of the other figures under it. The figures are judged against the engine's target frame
// rate (frame-target.ts). While the card shows, the engine samples the costly figures: GPU time,
// the counts of the draws that the GPU culls, and the memory figures that the engine's threads
// publish. Collapsed to its header, the overlay turns that sampling off and formats none of the
// card's figures. The page adds what only it can measure, where the browser offers it: its
// JavaScript heap and the whole page's memory. Only the header button takes the pointer, so drags
// on the rest of the panel still reach the canvas.
// stats-panel.ts holds the panel on the page, which a three.js page shows too, and overlay-look.ts
// holds its look.

import type { EngineMode } from '../page/engine';
import { refreshRate, sampleFrames } from '../shared/metrics';
import type { FrameMode } from './overlay-look';
import { PageMemorySampler, pageHeapBytes } from './page-meters';
import { type FrameStats, FrameStatsWindow, type StatsSources } from './stats';
import type { StatsOverlayOptions } from './stats-options';
import { StatsPanel } from './stats-panel';
import type { StatsFigures } from './stats-text';

export { OVERLAY_ATTRIBUTE } from './stats-panel';

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
	/** The highest target frame rate, from the page's `targetFps` setting and the `?fps=` cap. */
	maxTargetFps: number;
	/** The GPU features or WebGL2 extensions that the engine found. */
	gpuFeatures: readonly string[];
	/** The threads that run the sketch and draw, as `engine.mode` gives them. */
	mode: Pick<EngineMode, 'latency' | 'sketchThread' | 'renderThread'>;
}

/** How often the overlay reads new figures and follows the canvas. */
const REFRESH_MS = 250;

/** What only the page measures, beside the engine's frame figures. */
export interface PageFigures {
	jsHeapBytes: number | null;
	page: StatsFigures['memory']['page'];
}

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
			gpuTextureBytes: stats.gpuTextureBytes,
			gpuBufferBytes: stats.gpuBufferBytes,
			jsHeapBytes: page.jsHeapBytes,
			page: page.page,
		},
		mainThread: null,
	};
}

export class StatsOverlay {
	private readonly panel: StatsPanel;
	/** True where the GPU path can time the GPU's work. */
	private readonly gpuTimer: boolean;
	/**
	 * The thread that runs the sketch and draws, one step after the other, in low latency and in the
	 * single-thread build, or undefined in the pipelined mode.
	 */
	private readonly bothSteps: string | undefined;
	private readonly frameMode: FrameMode;
	private readonly window: FrameStatsWindow;
	private readonly timer: ReturnType<typeof setInterval>;
	private readonly pageMemory: PageMemorySampler;

	constructor(
		private readonly setup: OverlaySetup,
		options: StatsOverlayOptions,
	) {
		const { metrics, sources } = setup;
		this.gpuTimer = setup.gpuFeatures.includes(
			sources.tier === 'webgl2' ? 'EXT_disjoint_timer_query_webgl2' : 'timestamp-query',
		);
		const { mode } = setup;
		const sketch =
			mode.latency === 'single' || mode.sketchThread === 'main' ? 'main' : 'sketch-worker';
		this.bothSteps = mode.renderThread === sketch ? sketch : undefined;
		this.frameMode = mode.latency;
		this.window = new FrameStatsWindow(metrics, setup.threads, sources);
		this.pageMemory = new PageMemorySampler(() => (setup.sharedMemory ? sources.wasmBytes() : 0));
		const collapsed = options.collapsed === true;
		if (!collapsed) this.sample(true);
		this.panel = new StatsPanel(setup.canvas, {
			collapsed,
			onToggle: (closed) => {
				this.sample(!closed);
				if (!closed) this.updateCard();
			},
		});
		if (!collapsed) this.updateCard();
		this.timer = setInterval(() => this.refresh(), REFRESH_MS);
	}

	/** Changes the options that `options` names. */
	configure(options: StatsOverlayOptions): void {
		if (options.collapsed !== undefined) this.panel.setCollapsed(options.collapsed);
	}

	remove(): void {
		clearInterval(this.timer);
		this.panel.remove();
		if (!this.panel.collapsed) this.sample(false);
	}

	/**
	 * Turns on or off what only the card shows: the engine's costly figures and the page's memory.
	 * The header's frame rate comes from the frame records that the engine writes anyway.
	 */
	private sample(on: boolean): void {
		sampleFrames(this.setup.metrics, on);
		if (on) this.pageMemory.start();
		else this.pageMemory.stop();
	}

	private refresh(): void {
		this.panel.follow();
		if (!this.window.update()) return;
		if (this.panel.collapsed) {
			const { frames, presentedFps } = this.window.stats;
			this.panel.showRate(frames, presentedFps, this.refreshHz(), this.setup.maxTargetFps);
		} else this.updateCard();
	}

	/** The display's refresh rate, as the thread that draws measures it. */
	private refreshHz(): number {
		return refreshRate(this.setup.metrics);
	}

	private updateCard(): void {
		const figures: StatsFigures = overlayFigures(this.window.stats, {
			jsHeapBytes: pageHeapBytes(),
			page: this.pageMemory.page,
		});
		this.panel.update(figures, {
			refreshHz: this.refreshHz(),
			maxTargetFps: this.setup.maxTargetFps,
			gpuTimer: this.gpuTimer,
			mode: this.frameMode,
			bothSteps: this.bothSteps,
		});
	}
}
