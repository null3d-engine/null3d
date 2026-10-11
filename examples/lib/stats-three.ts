// The stats meter of a comparison's three.js half. It measures three.js the way the engine's overlay
// measures null3D, and shows the figures in the same panel, from `@null3d/engine/stats`, over the
// canvas's top-right corner. The worker (three-worker.ts) times its frames and reads three.js's
// `renderer.info`. The page adds what only it can measure, with the same calls that null3D's
// overlay makes: its own JavaScript heap, and the whole page's memory from the browser.
//
// The rules are the overlay's: collapsed, the panel shows the frame rate alone and nothing is
// sampled; open, the worker sends its figures four times a second and the page samples its memory.

import {
	PageMemorySampler,
	pageHeapBytes,
	type StatsFigures,
	StatsPanel,
} from '@null3d/engine/stats';
import type { ThreeFigures } from './three-protocol';

/** The name of three.js's one thread in the figures: it prepares and draws each frame. */
const THREAD = 'three-worker';

/** What the meter needs from its worker. */
export interface ThreeMeterSetup {
	canvas: HTMLCanvasElement;
	/** True starts with the card closed. */
	collapsed: boolean;
	/** Tells the worker to sample its costly figures, or to stop. */
	sample(on: boolean): void;
	/** The display's refresh rate, which the panel judges the figures against. */
	refreshHz: number;
}

export class ThreeStatsMeter {
	private readonly panel: StatsPanel;
	/** three.js shares no memory between threads, so the page's figure needs no correction. */
	private readonly pageMemory = new PageMemorySampler(() => 0);
	private heading = 'three.js';
	private gpuTimer = false;

	constructor(private readonly setup: ThreeMeterSetup) {
		this.panel = new StatsPanel(setup.canvas, {
			collapsed: setup.collapsed,
			onToggle: (collapsed) => this.sample(!collapsed),
		});
		if (!setup.collapsed) this.sample(true);
	}

	/** Names the renderer and says whether it times the GPU, once the worker has started. */
	started(renderer: string, version: string, gpuTimer: boolean): void {
		this.heading = `${version}  ${renderer}`;
		this.gpuTimer = gpuTimer;
	}

	/** Shows the frame rate that the worker reports while the card is closed. */
	rate(frames: number, fps: number): void {
		this.panel.follow();
		this.panel.showRate(frames, fps, this.setup.refreshHz);
	}

	/** Shows the worker's figures while the card is open. */
	figures(three: ThreeFigures): void {
		this.panel.follow();
		const figures: StatsFigures = {
			heading: `${this.heading}  geometries ${three.geometries}  textures ${three.textures}`,
			frames: three.frames,
			presentedFps: three.fps,
			completedFps: null,
			cpuMs: three.busyMs,
			threads: [
				{
					name: THREAD,
					busyMs: three.busyMs,
					phases: { update: three.codeMs, replay: three.renderMs },
				},
			],
			gpuMs: three.gpuMs,
			drawCalls: three.drawCalls,
			uploadBytes: null,
			triangles: three.triangles,
			objects: three.objects,
			memory: {
				wasmBytes: null,
				gpuTextureBytes: null,
				gpuBufferBytes: null,
				jsHeapBytes: pageHeapBytes(),
				page: this.pageMemory.page,
			},
			mainThread: null,
		};
		this.panel.update(figures, {
			refreshHz: this.setup.refreshHz,
			gpuTimer: this.gpuTimer,
			mode: 'one-thread',
			bothSteps: THREAD,
		});
	}

	/** Opens or closes the card, as the button does. */
	setCollapsed(collapsed: boolean): void {
		this.panel.setCollapsed(collapsed);
	}

	remove(): void {
		if (!this.panel.collapsed) this.sample(false);
		this.panel.remove();
	}

	private sample(on: boolean): void {
		this.setup.sample(on);
		if (on) this.pageMemory.start();
		else this.pageMemory.stop();
	}
}
