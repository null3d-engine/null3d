// The stats overlay that `debug.stats` shows: a text box over the top-left corner of the canvas,
// which the page updates from the metrics buffer a few times a second. The page owns the overlay's
// element, and the engine's threads write the figures it reads as they always do, so the overlay
// costs them nothing. The box ignores the pointer, so input still reaches the canvas.

import { PHASE_NAMES } from '../shared/metrics';
import { type FrameStats, FrameStatsWindow, type StatsSources } from './stats';

/** What the overlay reads. */
export interface OverlaySetup {
	/** The canvas the overlay sits on. */
	canvas: HTMLCanvasElement;
	/** The metrics buffer that the engine's threads write. */
	metrics: ArrayBufferLike;
	/** Each engine thread's name and the roles it runs, as `engine.measure` names them. */
	threads: Iterable<readonly [string, readonly number[]]>;
	/** The tier, the preset and the render scale. */
	sources: StatsSources;
}

/** How often the overlay reads new figures and follows the canvas. */
const REFRESH_MS = 250;
/** A phase's time per frame below which the overlay leaves the phase out. */
const SHOWN_MS = 0.005;
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

const ms = (value: number) => `${value.toFixed(2)} ms`;

/** The overlay's text for a window of figures. */
export function statsText(stats: FrameStats): string {
	const lines = [`${stats.tier}  ${stats.preset}  scale ${stats.renderScale.toFixed(2)}`];
	if (stats.frames === 0) {
		lines.push('waiting for frames');
		return lines.join('\n');
	}
	lines.push(
		`${stats.presentedFps.toFixed(1)} fps presented, ${stats.completedFps.toFixed(1)} completed`,
		`busiest thread ${ms(stats.cpuMs)} per frame`,
	);
	let jobs = 0;
	let busiestJob = 0;
	for (const thread of stats.threads) {
		if (thread.name.startsWith('job-')) {
			jobs++;
			busiestJob = Math.max(busiestJob, thread.busyMs);
			continue;
		}
		lines.push(`${thread.name}  ${ms(thread.busyMs)}`);
		const phases = PHASE_NAMES.filter((phase) => thread.phases[phase] >= SHOWN_MS).map(
			(phase) => `${phase} ${thread.phases[phase].toFixed(2)}`,
		);
		if (phases.length > 0) lines.push(`  ${phases.join('  ')}`);
	}
	if (jobs > 0) lines.push(`job workers (${jobs})  busiest ${ms(busiestJob)}`);
	lines.push(
		`draw calls ${Math.round(stats.drawCalls)}  upload ${(stats.uploadBytes / 1024).toFixed(1)} KB`,
	);
	return lines.join('\n');
}

export class StatsOverlay {
	private readonly element: HTMLPreElement;
	private readonly window: FrameStatsWindow;
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(private readonly setup: OverlaySetup) {
		this.window = new FrameStatsWindow(setup.metrics, setup.threads, setup.sources);
		const element = document.createElement('pre');
		element.setAttribute(OVERLAY_ATTRIBUTE, '');
		Object.assign(element.style, STYLE);
		element.textContent = statsText(this.window.stats);
		document.body.append(element);
		this.element = element;
		this.follow();
		this.timer = setInterval(() => this.refresh(), REFRESH_MS);
	}

	remove(): void {
		clearInterval(this.timer);
		this.element.remove();
	}

	private refresh(): void {
		this.follow();
		if (this.window.update()) this.element.textContent = statsText(this.window.stats);
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
