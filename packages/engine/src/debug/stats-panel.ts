// The stats overlay's panel: the header button with the frame rate and the tabbed card of figures,
// over the top-right or bottom-right corner of a canvas. At the top the card opens under the button,
// and at the bottom above it, so the button never moves. The engine's overlay (overlay.ts) fills it
// from the engine's metrics, and a page that draws with another engine, such as three.js, fills it
// with figures of its own. So both pages show the same figures in the same look. overlay-look.ts
// holds the look; this file holds the place on the page, the shadow root and the button's toggle.
//
// The card's height stops at the room on screen beside the button, and the figures under its tabs
// scroll when they need more. A button at the bottom sits at the bottom of the part of the canvas
// that is on screen, so a canvas taller than the screen, or one under a phone browser's toolbar,
// still shows it. There it keeps clear of a phone's home bar.

import { CHECK_MAX_FPS, checkTargetFps } from '../quality/check';
import {
	addStyles,
	buildPanel,
	keepKeys,
	PANEL_EDGE,
	PANEL_GAP,
	StatsCard,
	StatsHeader,
} from './overlay-look';
import type { StatsCorner } from './stats-options';
import type { StatsFigures } from './stats-text';

/** The attribute that marks the overlay's element. */
export const OVERLAY_ATTRIBUTE = 'data-null3d-stats';

/**
 * The least height of the card, in CSS pixels: its header, its tabs and a row of figures. A card
 * with less room than this runs past the screen's edge.
 */
const MIN_CARD_HEIGHT = 96;

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
	 * The corner of the canvas that the header button sits in. The default is `'top-right'`. At
	 * `'bottom-right'` the button sits at the bottom of the part of the canvas on screen, clear of
	 * a phone's home bar, and the card opens above it.
	 */
	corner?: StatsCorner;
	/**
	 * Called when the panel opens or closes, with true for closed. A page samples its costly figures
	 * only while the panel is open.
	 */
	onToggle?: (collapsed: boolean) => void;
}

/**
 * How the threads of a renderer share each frame's work, which a symbol before the target explains:
 * `'pipelined'` and `'low'` are null3D's latency modes, `'single'` is null3D's single-thread build,
 * and `'one-thread'` is a renderer that prepares and draws each frame on one thread.
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
 * The stats overlay's header and card over the top-right or bottom-right corner of a canvas, in the
 * overlay's own look. The engine's overlay is one; a page that draws with another engine makes its own and fills
 * it with its figures, so both show the same figures in the same place and look. The header's
 * button opens and closes the card. Collapsed, the panel formats nothing but the frame rate.
 *
 * @category api/debug
 */
export class StatsPanel {
	private readonly host: HTMLDivElement;
	private readonly panel: HTMLDivElement;
	private readonly header = new StatsHeader();
	private readonly card = new StatsCard();
	private isCollapsed: boolean;
	private atBottom: boolean;
	/** What `follow` last wrote, so an unchanged place writes nothing. */
	private x = Number.NaN;
	private y = Number.NaN;
	private room = Number.NaN;
	private clearOfHomeBar = false;
	private scrolls = false;

	/** Puts a panel on the canvas's corner that `options.corner` names, the top right by default. */
	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly options: StatsPanelOptions = {},
	) {
		this.isCollapsed = options.collapsed === true;
		this.atBottom = options.corner === 'bottom-right';
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
		this.panel = panel;
		this.showCollapsed();
		this.showCorner();
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

	/** Moves the panel to another corner of the canvas. */
	setCorner(corner: StatsCorner): void {
		const atBottom = corner === 'bottom-right';
		if (atBottom === this.atBottom) return;
		this.atBottom = atBottom;
		this.showCorner();
		this.follow();
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
	 * Keeps the panel on its corner of the canvas and the card's height within the screen, and hides
	 * the panel while the canvas is off the page. Call it a few times a second, as the figures come.
	 */
	follow(): void {
		const { canvas, host } = this;
		host.hidden = !canvas.isConnected;
		const rect = canvas.getBoundingClientRect();
		const view = visualViewport;
		const viewTop = view ? view.offsetTop : 0;
		const viewBottom = view ? viewTop + view.height : innerHeight;
		const button = this.header.button.offsetHeight;
		const x = document.documentElement.clientWidth - rect.right - scrollX;
		let edge = rect.top;
		let room = viewBottom - PANEL_EDGE - (rect.top + PANEL_EDGE + button + PANEL_GAP);
		let clearOfHomeBar = false;
		if (this.atBottom) {
			// The bottom of the canvas, or of the screen where the canvas runs past it, but never
			// above the room that the button needs at the canvas's top.
			const block = button + 2 * PANEL_EDGE;
			edge = Math.min(rect.bottom, Math.max(viewBottom, rect.top + block));
			clearOfHomeBar = edge >= viewBottom - 1;
			room = edge - PANEL_EDGE - button - PANEL_GAP - (viewTop + PANEL_EDGE);
		}
		const y = edge + scrollY;
		room = Math.max(MIN_CARD_HEIGHT, Math.floor(room));
		if (x !== this.x) {
			this.x = x;
			host.style.right = `${x}px`;
		}
		if (y !== this.y) {
			this.y = y;
			host.style.top = `${y}px`;
		}
		if (room !== this.room) {
			this.room = room;
			host.style.setProperty('--room', `${room}px`);
		}
		if (clearOfHomeBar !== this.clearOfHomeBar) {
			this.clearOfHomeBar = clearOfHomeBar;
			this.panel.toggleAttribute('data-home-bar', clearOfHomeBar);
		}
		// The figures take the pointer only while they scroll, so drags on a card that fits still
		// reach the canvas.
		const { scroller } = this.card;
		const scrolls = !this.isCollapsed && scroller.scrollHeight > scroller.clientHeight;
		if (scrolls !== this.scrolls) {
			this.scrolls = scrolls;
			scroller.toggleAttribute('data-scrolls', scrolls);
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

	private showCorner(): void {
		const { atBottom } = this;
		this.panel.dataset.corner = atBottom ? 'bottom-right' : 'top-right';
		// At the bottom, the host's top is the corner's edge, and the panel hangs above it.
		this.host.style.transform = atBottom ? 'translateY(-100%)' : '';
		this.y = Number.NaN;
	}

	private showCollapsed(): void {
		this.header.button.setAttribute('aria-expanded', this.isCollapsed ? 'false' : 'true');
		this.card.element.hidden = this.isCollapsed;
	}
}
