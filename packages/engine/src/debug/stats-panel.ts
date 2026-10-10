// The stats overlay's panel: the header button with the frame rate and the card of figures under
// it, over the top-right corner of a canvas. The engine's overlay (overlay.ts) fills it from the
// engine's metrics, and a page that draws with another engine, such as three.js, fills it with
// figures of its own. So both pages show the same figures in the same look. overlay-look.ts holds
// the look; this file holds the place on the page, the shadow root and the button's toggle.

import { CHECK_MAX_FPS, checkTargetFps } from '../quality/check';
import { addStyles, buildPanel, keepKeys, StatsCard, StatsHeader } from './overlay-look';
import type { StatsFigures } from './stats-text';

/** The attribute that marks the overlay's element. */
export const OVERLAY_ATTRIBUTE = 'data-null3d-stats';

/** The host element's own style: its place on the page, over everything, apart from the pointer. */
const HOST_STYLE: Partial<CSSStyleDeclaration> = {
	position: 'absolute',
	zIndex: '2147483647',
	margin: '0',
	pointerEvents: 'none',
};

/**
 * Options of a `StatsPanel`.
 *
 * @category api/debug
 */
export interface StatsPanelOptions {
	/** True starts the panel with only its header, a button with the frame rate. The default is false. */
	collapsed?: boolean;
	/**
	 * Called when the panel opens or closes, with true for closed. A page samples its costly figures
	 * only while the panel is open.
	 */
	onToggle?: (collapsed: boolean) => void;
}

/**
 * How the threads of a renderer share each frame's work, which a symbol before the target explains:
 * `'pipelined'` and `'low'` are null3D's latency modes, `'single'` is null3D's single-thread build,
 * and `'one-thread'` is a renderer that prepares and draws each frame on one thread, as three.js does.
 *
 * @category api/debug
 */
export type StatsFrameMode = 'pipelined' | 'low' | 'single' | 'one-thread';

/**
 * How a panel judges and lays out one set of figures, in `StatsPanel.update`.
 *
 * @category api/debug
 */
export interface StatsPanelFrame {
	/**
	 * The display's refresh rate in hertz, or 0 before it is measured. The panel judges the figures
	 * against null3D's target: this rate, at most `maxTargetFps`.
	 */
	readonly refreshHz: number;
	/**
	 * The highest target frame rate, as null3D's `targetFps` setting and a frame rate cap allow.
	 * The default is null3D's own highest target without a setting.
	 */
	readonly maxTargetFps?: number;
	/** True where the GPU path can time the GPU's work. The GPU bar otherwise says "not measured". */
	readonly gpuTimer: boolean;
	/** How the threads share each frame's work. */
	readonly mode: StatsFrameMode;
	/**
	 * The thread, by its name in `StatsFigures.threads`, that prepares and then draws each frame,
	 * where one thread does both. Its bar holds your code, the renderer's work and the drawing.
	 */
	readonly bothSteps?: string;
}

/**
 * The stats overlay's header and card over the top-right corner of a canvas, in the overlay's own
 * look. The engine's overlay is one; a page that draws with another engine makes its own and fills
 * it with its figures, so both show the same figures in the same place and look. The header's
 * button opens and closes the card. Collapsed, the panel formats nothing but the frame rate.
 *
 * @category api/debug
 */
export class StatsPanel {
	private readonly host: HTMLDivElement;
	private readonly header = new StatsHeader();
	private readonly card = new StatsCard();
	private isCollapsed: boolean;
	/** The offsets that `follow` last wrote, so an unchanged place writes nothing. */
	private x = Number.NaN;
	private y = Number.NaN;

	/** Puts a panel on the canvas's top-right corner. */
	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly options: StatsPanelOptions = {},
	) {
		this.isCollapsed = options.collapsed === true;
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
		document.body.append(host);
		this.follow();
	}

	/** True while only the header shows. */
	get collapsed(): boolean {
		return this.isCollapsed;
	}

	/** Opens or closes the card, and tells `onToggle` when that changes. */
	setCollapsed(collapsed: boolean): void {
		if (collapsed === this.isCollapsed) return;
		this.isCollapsed = collapsed;
		this.showCollapsed();
		this.options.onToggle?.(collapsed);
	}

	/**
	 * Shows the frame rate in the header: `frames` is 0 before the first window of frames ended.
	 * The rate is judged against null3D's target for the display's refresh rate, at most
	 * `maxTargetFps`.
	 */
	showRate(frames: number, fps: number, refreshHz: number, maxTargetFps = CHECK_MAX_FPS): void {
		this.header.update(frames, fps, checkTargetFps(refreshHz, maxTargetFps));
	}

	/** Shows a set of figures in the card. It does nothing while the panel is collapsed. */
	update(figures: StatsFigures, frame: StatsPanelFrame): void {
		const { refreshHz, maxTargetFps = CHECK_MAX_FPS } = frame;
		this.showRate(figures.frames, figures.presentedFps, refreshHz, maxTargetFps);
		if (this.isCollapsed) return;
		this.card.update(
			figures,
			checkTargetFps(refreshHz, maxTargetFps),
			refreshHz,
			frame.gpuTimer,
			frame.bothSteps,
			frame.mode,
		);
	}

	/**
	 * Keeps the panel on the canvas's top-right corner, and hides it while the canvas is off the
	 * page. Call it a few times a second, as the figures come.
	 */
	follow(): void {
		const { canvas, host } = this;
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

	/** Takes the panel off the page. */
	remove(): void {
		this.host.remove();
	}

	/** A click on the header, or Enter or Space on it, shows or hides the card. */
	private readonly toggle = (event: MouseEvent): void => {
		this.setCollapsed(!this.isCollapsed);
		// A pointer's click hands the keys back to the page, so a key that the sketch reads, such
		// as Space, does not press the button again. A key's click (detail 0) keeps the focus.
		if (event.detail > 0) this.header.button.blur();
	};

	private showCollapsed(): void {
		this.header.button.setAttribute('aria-expanded', this.isCollapsed ? 'false' : 'true');
		this.card.element.hidden = this.isCollapsed;
	}
}
