// The hero car's console: a touchscreen on the dashboard that repeats the scene's controls, so a
// driver in the seat works them without leaving the cockpit. It shows the same groups as the page's
// controls panel, one tab at a time, with the same buttons lit, and the hour as a bar.
//
// A press on a button or on the hour bar goes to the page as a `hud-press` message, and the page
// sends it on to the sketch as its own panel's button would. The scene's controls then answer it
// once, whichever panel took the press, and both panels show the change. A press on a tab only
// turns the console's own page.
import type { Object3D, QuatLike, SketchContext } from '@null3d/engine';
import { createScreen } from '../../addons/screens';
import type { HudButton, HudGroup } from '../../lib/controls';
import { EFFECT_LAYER } from '../../lib/layers';

/** The console's canvas in texels, and the rectangle of the whole of it. */
const SIZE = { width: 1024, height: 384 };
const WHOLE = { x: 0, y: 0, width: SIZE.width, height: SIZE.height };
/** The tab bar's height, the padding round the page, and a button's height and gap, in texels. */
const TAB = 64;
const PAD = 22;
const BUTTON = { height: 66, gap: 16 };
/** The hour bar's height, in texels, for a group with a slider. */
const BAR = 46;
/** The console's colours: its glass, its lines, its text, and a lit button's fill and text. */
const COLOUR = {
	glass: '#050b12',
	line: '#1d4a63',
	text: '#9fd8ee',
	dim: '#4f8aa3',
	lit: '#37c8e8',
	litText: '#03141c',
};

/** One place on the console that takes a press: its rectangle, and what it posts or picks. */
interface Target {
	x: number;
	y: number;
	width: number;
	height: number;
	/** The tab that it opens, or -1 for a press that posts. */
	tab: number;
	/** The message and value that it posts, or the slider's group for the hour bar. */
	name: string;
	value: string;
	/** The hour bar's range, which a press along it maps to a value. */
	min?: number;
	max?: number;
}

/** The hero car's console. */
export interface Console {
	/** Draws the scene's controls, as the page's panel shows them. Call it whenever they change. */
	show(groups: readonly HudGroup[]): void;
	/** Sends a picture that the refresh rate held back. Call it once per frame. */
	update(): void;
}

/**
 * Builds the console on `body`, at `at` in the body's units, turned by `tilt` toward the seat, and
 * `size` wide and high in the body's units.
 */
export function createConsole(
	ctx: SketchContext,
	body: Object3D,
	tilt: QuatLike,
	at: readonly [number, number, number],
	size: readonly [number, number],
): Console {
	const { page } = ctx;
	const screen = createScreen(ctx, {
		width: SIZE.width,
		height: SIZE.height,
		refreshHz: 30,
		size: [size[0], size[1]],
		lcd: { subpixels: 0.35, scan: 0.25, deadPixels: 0.0008, glow: 1.2 },
		draw: (context) => {
			context.fillStyle = COLOUR.glass;
			context.fillRect(0, 0, SIZE.width, SIZE.height);
		},
	});
	screen.mesh.setParent(body);
	screen.mesh.setPosition(at[0], at[1], at[2]);
	screen.mesh.setRotation(tilt[0] ?? 0, tilt[1] ?? 0, tilt[2] ?? 0, tilt[3] ?? 1);
	screen.mesh.setLayers(EFFECT_LAYER);

	let shown: readonly HudGroup[] = [];
	let tab = 0;
	/** What the console shows now, as text: it draws again only when this changes. */
	let drawn = '';

	/**
	 * What the console would show for `groups`: the tabs, the open tab, its hour to the minute and
	 * which of its buttons are lit. The model comes several times a second while Auto runs, and
	 * most of those change nothing that the console shows.
	 */
	const sightOf = (groups: readonly HudGroup[]): string => {
		const open = groups[tab];
		const hour = open?.slider ? Math.floor(open.slider.value * 60) : -1;
		const lit = (buttons: readonly HudButton[] | undefined) =>
			(buttons ?? []).map((button) => `${button.label}${button.active ? '+' : '-'}`).join();
		return `${tab}|${groups.map((group) => group.title).join()}|${hour}|${lit(open?.buttons)}|${lit(open?.extras)}`;
	};
	const targets: Target[] = [];

	/** Draws a rounded box, filled or outlined. */
	const box = (
		c: OffscreenCanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		fill: boolean,
	): void => {
		c.beginPath();
		c.roundRect(x, y, w, h, 12);
		if (fill) c.fill();
		else c.stroke();
	};

	/** Draws a row of buttons from `y`, lit where they are active, and adds them to the targets. */
	const row = (
		c: OffscreenCanvasRenderingContext2D,
		group: HudGroup,
		buttons: readonly HudButton[],
		y: number,
	): void => {
		const width = (SIZE.width - PAD * 2 - BUTTON.gap * (buttons.length - 1)) / buttons.length;
		buttons.forEach((button, k) => {
			const x = PAD + k * (width + BUTTON.gap);
			c.fillStyle = button.active ? COLOUR.lit : COLOUR.glass;
			c.strokeStyle = button.active ? COLOUR.lit : COLOUR.line;
			c.lineWidth = 3;
			box(c, x, y, width, BUTTON.height, button.active);
			if (!button.active) box(c, x, y, width, BUTTON.height, false);
			c.fillStyle = button.active ? COLOUR.litText : COLOUR.text;
			c.font = 'bold 28px sans-serif';
			c.textAlign = 'center';
			c.textBaseline = 'middle';
			c.fillText(button.label, x + width / 2, y + BUTTON.height / 2, width - 16);
			targets.push({
				x,
				y,
				width,
				height: BUTTON.height,
				tab: -1,
				name: button.name ?? group.name,
				value: button.id,
			});
		});
	};

	/** Draws the whole console: the tabs, then the open group's hour bar and buttons. */
	const draw = (): void => {
		const c = screen.context;
		targets.length = 0;
		c.fillStyle = COLOUR.glass;
		c.fillRect(0, 0, SIZE.width, SIZE.height);
		// The tabs, one for each group, across the top.
		const across = SIZE.width / Math.max(1, shown.length);
		shown.forEach((group, k) => {
			const x = k * across;
			const open = k === tab;
			c.fillStyle = open ? '#0d2633' : COLOUR.glass;
			c.fillRect(x, 0, across, TAB);
			c.fillStyle = open ? COLOUR.lit : COLOUR.dim;
			c.font = 'bold 22px sans-serif';
			c.textAlign = 'center';
			c.textBaseline = 'middle';
			c.fillText(group.title, x + across / 2, TAB / 2, across - 10);
			targets.push({ x, y: 0, width: across, height: TAB, tab: k, name: '', value: '' });
		});
		c.strokeStyle = COLOUR.line;
		c.lineWidth = 3;
		c.beginPath();
		c.moveTo(0, TAB);
		c.lineTo(SIZE.width, TAB);
		c.stroke();
		const group = shown[tab];
		if (group) {
			let y = TAB + PAD;
			const { slider } = group;
			if (slider) {
				// The hour bar: a track with the value's share lit, and a press sets the value there.
				const width = SIZE.width - PAD * 2;
				const share = (slider.value - slider.min) / (slider.max - slider.min);
				c.fillStyle = '#0d2633';
				box(c, PAD, y, width, BAR, true);
				c.fillStyle = COLOUR.lit;
				box(c, PAD, y, Math.max(BAR, width * share), BAR, true);
				c.fillStyle = COLOUR.litText;
				c.font = 'bold 24px sans-serif';
				c.textAlign = 'left';
				c.textBaseline = 'middle';
				const hours = Math.floor(slider.value);
				const minutes = Math.floor((slider.value - hours) * 60);
				c.fillText(
					`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
					PAD + 14,
					y + BAR / 2,
				);
				targets.push({
					x: PAD,
					y,
					width,
					height: BAR,
					tab: -1,
					name: group.name,
					value: '',
					min: slider.min,
					max: slider.max,
				});
				y += BAR + PAD;
			}
			if (group.buttons.length) {
				row(c, group, group.buttons, y);
				y += BUTTON.height + BUTTON.gap;
			}
			if (group.extras?.length) row(c, group, group.extras, y);
		}
		screen.mark(WHOLE);
		screen.flush();
	};

	// A press on the console: a tab opens its page here, and a button or the hour bar posts.
	screen.mesh.on('click', (event) => {
		const point = screen.pointOf(event);
		if (!point) return;
		for (const target of targets) {
			if (
				point.x < target.x ||
				point.x > target.x + target.width ||
				point.y < target.y ||
				point.y > target.y + target.height
			)
				continue;
			if (target.tab >= 0) {
				tab = target.tab;
				drawn = sightOf(shown);
				draw();
			} else if (target.min !== undefined && target.max !== undefined) {
				const share = Math.min(1, Math.max(0, (point.x - target.x) / target.width));
				const value = target.min + share * (target.max - target.min);
				page.post('hud-press', { name: target.name, value: String(value) });
			} else page.post('hud-press', { name: target.name, value: target.value });
			return;
		}
	});

	return {
		show(groups) {
			shown = groups;
			tab = Math.min(tab, Math.max(0, groups.length - 1));
			const sight = sightOf(groups);
			if (sight === drawn) return;
			drawn = sight;
			draw();
		},
		update() {
			screen.flush();
		},
	};
}
