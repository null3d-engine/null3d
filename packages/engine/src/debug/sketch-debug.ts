// The `ctx.debug` object of a sketch in a release build: drawing calls that do nothing, with the
// stats overlay and the frame figures, which work in every build. Development builds use DebugDraw
// (draw.ts), which extends it with the drawing. The page draws the overlay. The frame figures' code
// (stats.ts) downloads at the first call of `frameStats`, so a sketch that never asks for figures
// never downloads it.

import type { Vec3Like } from '../math/types';
import type { QualityPreset } from '../quality/presets';
import type { ColorInput } from '../scene/color';
import type { Camera, DirectionalLight, Object3D } from '../scene/scene';
import type { Tier } from '../shared/tier';
import type { Debug, DebugGridOptions, DebugLightOptions, DebugView } from './debug';
import type { FrameStats, FrameStatsWindow, StatsSources } from './stats';

/** What the debug API needs from the thread that runs the sketch. */
export interface DebugHost {
	/** Asks the page to show or hide its stats overlay. */
	showStats(show: boolean): void;
	/** The metrics buffer that the frame figures read. */
	metrics: ArrayBufferLike;
	/** Each engine thread's name and the roles it runs, as `engine.measure` names them. */
	threads: readonly (readonly [string, readonly number[]])[];
	/** The tier, the preset and the render scale, which the figures report too. */
	sources: StatsSources;
}

/** The figures before the first window: every figure 0. */
function noFigures(tier: Tier, preset: QualityPreset): FrameStats {
	return {
		frames: 0,
		seconds: 0,
		presentedFps: 0,
		completedFps: 0,
		cpuMs: 0,
		threads: [],
		drawCalls: 0,
		uploadBytes: 0,
		tier,
		preset,
		renderScale: 0,
	};
}

export class SketchDebug implements Debug {
	/** The overlay as the sketch last asked for it. */
	private showing = false;
	private window: FrameStatsWindow | undefined;
	private empty: FrameStats | undefined;
	private loading = false;

	constructor(private readonly host: DebugHost) {}

	line(_from: Vec3Like, _to: Vec3Like, _color?: ColorInput): void {}
	box(_min: Vec3Like, _max: Vec3Like, _color?: ColorInput): void {}
	sphere(_center: Vec3Like, _radius: number, _color?: ColorInput): void {}
	arrow(_origin: Vec3Like, _direction: Vec3Like, _length?: number, _color?: ColorInput): void {}
	axes(_target: Object3D | Vec3Like, _size?: number): void {}
	grid(_size?: number, _divisions?: number, _options?: DebugGridOptions): void {}
	frustum(_camera: Camera, _color?: ColorInput): void {}
	light(_light: DirectionalLight, _options?: DebugLightOptions): void {}
	skeleton(_object: Object3D, _color?: ColorInput): void {}
	view(_view: DebugView): void {}
	shadowCamera(_camera?: Camera): void {}

	stats(show = true): void {
		if (show === this.showing) return;
		this.showing = show;
		this.host.showStats(show);
	}

	frameStats(): FrameStats {
		const window = this.window;
		if (window) {
			window.update();
			return window.stats;
		}
		if (!this.loading) this.load();
		this.empty ??= noFigures(this.host.sources.tier, this.host.sources.preset());
		return this.empty;
	}

	/** Downloads the frame figures' code, then starts their first window. */
	private load(): void {
		this.loading = true;
		const { metrics, threads, sources } = this.host;
		import('./stats').then(({ FrameStatsWindow }) => {
			this.window = new FrameStatsWindow(metrics, threads, sources);
		}, console.warn);
	}
}
