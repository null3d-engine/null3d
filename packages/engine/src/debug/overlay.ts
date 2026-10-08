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
// overlay-look.ts holds the look.

import type { EngineMode } from '../page/engine';
import { refreshRate, sampleFrames } from '../shared/metrics';
import { targetFps } from './frame-target';
import { addStyles, buildPanel, keepKeys, StatsCard, StatsHeader } from './overlay-look';
import { PageMemorySampler, pageHeapBytes } from './page-meters';
import { type FrameStats, FrameStatsWindow, type StatsSources } from './stats';
import type { StatsOverlayOptions } from './stats-options';
import type { StatsFigures } from './stats-text';

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
	/** The frame rate that `?fps=` holds, or undefined where the display's rate sets it. */
	fpsCap: number | undefined;
	/** The GPU features or WebGL2 extensions that the engine found. */
	gpuFeatures: readonly string[];
	/** The threads that run the sketch and draw, as `engine.mode` gives them. */
	mode: Pick<EngineMode, 'latency' | 'sketchThread' | 'renderThread'>;
}

/** How often the overlay reads new figures and follows the canvas. */
const REFRESH_MS = 250;
/** The attribute that marks the overlay's element. */
export const OVERLAY_ATTRIBUTE = 'data-null3d-stats';

/** The host element's own style: its place on the page, over everything, apart from the pointer. */
const HOST_STYLE: Partial<CSSStyleDeclaration> = {
	position: 'absolute',
	zIndex: '2147483647',
	margin: '0',
	pointerEvents: 'none',
};

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
	private readonly host: HTMLDivElement;
	private readonly header = new StatsHeader();
	private readonly card = new StatsCard();
	/** True where the GPU path can time the GPU's work. */
	private readonly gpuTimer: boolean;
	/**
	 * The thread that runs the sketch and draws, one step after the other, in low latency and in the
	 * single-thread build, or undefined in the pipelined mode.
	 */
	private readonly bothSteps: string | undefined;
	private readonly window: FrameStatsWindow;
	private readonly timer: ReturnType<typeof setInterval>;
	private readonly pageMemory: PageMemorySampler;
	private collapsed: boolean;
	/** The offsets that `follow` last wrote, so an unchanged place writes nothing. */
	private x = Number.NaN;
	private y = Number.NaN;

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
		this.window = new FrameStatsWindow(metrics, setup.threads, sources);
		this.pageMemory = new PageMemorySampler(() => (setup.sharedMemory ? sources.wasmBytes() : 0));
		this.collapsed = options.collapsed === true;
		if (!this.collapsed) this.sample(true);
		const host = document.createElement('div');
		host.setAttribute(OVERLAY_ATTRIBUTE, '');
		Object.assign(host.style, HOST_STYLE);
		const root = host.attachShadow({ mode: 'open' });
		addStyles(root);
		const panel = buildPanel();
		const { button } = this.header;
		// The shadow root holds the only element with this id.
		this.card.element.id = 'card';
		button.setAttribute('aria-controls', 'card');
		button.addEventListener('click', this.toggle);
		button.addEventListener('keydown', keepKeys);
		button.addEventListener('keyup', keepKeys);
		panel.append(button, this.card.element);
		root.append(panel);
		this.host = host;
		this.showCollapsed();
		if (!this.collapsed) this.updateCard();
		document.body.append(host);
		this.follow();
		this.timer = setInterval(() => this.refresh(), REFRESH_MS);
	}

	/** Changes the options that `options` names. */
	configure(options: StatsOverlayOptions): void {
		if (options.collapsed !== undefined) this.setCollapsed(options.collapsed);
	}

	remove(): void {
		clearInterval(this.timer);
		this.host.remove();
		if (!this.collapsed) this.sample(false);
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

	/** A click on the header, or Enter or Space on it, shows or hides the details. */
	private readonly toggle = (event: MouseEvent): void => {
		this.setCollapsed(!this.collapsed);
		// A pointer's click hands the keys back to the page, so a key that the sketch reads, such
		// as Space, does not press the button again. A key's click (detail 0) keeps the focus.
		if (event.detail > 0) this.header.button.blur();
	};

	private setCollapsed(collapsed: boolean): void {
		if (collapsed === this.collapsed) return;
		this.collapsed = collapsed;
		this.sample(!collapsed);
		this.showCollapsed();
		if (!collapsed) this.updateCard();
	}

	private showCollapsed(): void {
		this.header.button.setAttribute('aria-expanded', this.collapsed ? 'false' : 'true');
		this.card.element.hidden = this.collapsed;
	}

	private refresh(): void {
		this.follow();
		if (!this.window.update()) return;
		const { frames, presentedFps } = this.window.stats;
		this.header.update(frames, presentedFps, this.target());
		if (!this.collapsed) this.updateCard();
	}

	/** The engine's target frame rate now, which follows the display's measured rate. */
	private target(): number {
		return targetFps(refreshRate(this.setup.metrics), this.setup.fpsCap);
	}

	private updateCard(): void {
		const figures: StatsFigures = overlayFigures(this.window.stats, {
			jsHeapBytes: pageHeapBytes(),
			page: this.pageMemory.page,
		});
		this.card.update(
			figures,
			this.target(),
			this.gpuTimer,
			this.bothSteps,
			this.setup.mode.latency,
		);
	}

	/**
	 * Puts the overlay on the canvas's top-right corner, and hides it while the canvas is off the
	 * page. The overlay's right offset keeps it to the corner as the card opens and closes.
	 */
	private follow(): void {
		const { canvas } = this.setup;
		const { host } = this;
		host.hidden = !canvas.isConnected;
		const rect = canvas.getBoundingClientRect();
		const x = document.documentElement.clientWidth - rect.right - scrollX;
		const y = rect.top + scrollY;
		if (x !== this.x) {
			this.x = x;
			host.style.right = `${x}px`;
		}
		if (y !== this.y) {
			this.y = y;
			host.style.top = `${y}px`;
		}
	}
}
