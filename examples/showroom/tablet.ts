// The configurator tablet beside the car, drawn on an OffscreenCanvas through the screens add-on.
// Four tabs switch the part on show, and a tap on the value, a swatch or an arrow moves that part's
// choice on and repaints the panel. The sketch answers each change at once, so the car takes the new
// paint, wheels, trim or lights while the picture is still uploading.
import type { SketchContext } from '@null3d/engine';
import { createScreen } from '../addons/screens';
import {
	type Config,
	type ConfigPage,
	choice,
	cycle,
	NEXT,
	PAGES,
	PREV,
	START_CONFIG,
	TABLET,
	TABS,
	tabletAction,
	VALUE,
} from './config';

/** The canvas's size in texels, and the tablet's size in meters. */
const WIDTH = TABLET.width;
const HEIGHT = TABLET.height;
const SIZE = [1.24, 0.775] as const;

/** Where the tablet stands and which way its face turns, so the studio's camera sees it square on. */
const AT = [3.6, 1.18, 10.2] as const;
const FACING = 2.78;

/** Draws the whole panel for a page and a configuration. */
function paint(context: OffscreenCanvasRenderingContext2D, config: Config, page: ConfigPage): void {
	context.fillStyle = '#05080b';
	context.fillRect(0, 0, WIDTH, HEIGHT);
	context.fillStyle = '#0b1219';
	context.fillRect(0, 0, WIDTH, 46);
	context.fillStyle = '#eaf6ff';
	context.font = 'bold 21px sans-serif';
	context.textBaseline = 'middle';
	context.fillText('NOVA GT', 18, 24);
	context.textAlign = 'right';
	context.fillStyle = '#57c8e0';
	context.font = 'bold 12px sans-serif';
	context.fillText('CONFIGURATOR', WIDTH - 18, 24);
	context.textAlign = 'left';

	const shown =
		PAGES.find((candidate) => candidate.id === page) ?? (PAGES[0] as (typeof PAGES)[number]);
	const current = choice(config, page);
	context.fillStyle = '#57c8e0';
	context.font = 'bold 13px sans-serif';
	context.fillText(shown.title.toUpperCase(), 18, 66);
	context.fillStyle = '#f4f8ff';
	context.font = 'bold 30px sans-serif';
	context.fillText(current.label, 16, 98);
	context.fillStyle = '#7f96a8';
	context.font = '13px sans-serif';
	context.fillText(current.detail, 18, 124);

	// The swatches of the page's options, with a ring around the chosen one.
	context.fillStyle = '#3d4f5f';
	context.font = '10px sans-serif';
	context.fillText('TAP A SWATCH OR AN ARROW TO CHANGE', 18, 224);
	const count = shown.options.length;
	const across = Math.min(74, 350 / count);
	for (const [index, option] of shown.options.entries()) {
		const x = 72 + index * across;
		context.fillStyle = option.swatch;
		context.fillRect(x, 152, 38, 38);
		context.strokeStyle = index === config[page] ? '#eaf6ff' : '#1b2733';
		context.lineWidth = index === config[page] ? 3 : 2;
		context.strokeRect(x + 1, 153, 36, 36);
	}
	// The arrows.
	context.fillStyle = '#57c8e0';
	for (const [rect, direction] of [
		[PREV, -1],
		[NEXT, 1],
	] as const) {
		const middle = rect.y + rect.height / 2;
		const x = direction < 0 ? rect.x + 6 : rect.x + rect.width - 6;
		context.beginPath();
		context.moveTo(x, middle);
		context.lineTo(x + direction * 22, middle - 13);
		context.lineTo(x + direction * 22, middle + 13);
		context.closePath();
		context.fill();
	}

	// The tabs, with the page on show lit.
	for (const tab of TABS) {
		const active = tab.page === page;
		context.fillStyle = active ? '#39d0e8' : '#0e151e';
		context.fillRect(tab.x, tab.y, tab.width, tab.height);
		context.strokeStyle = active ? '#39d0e8' : '#1b2733';
		context.lineWidth = 2;
		context.strokeRect(tab.x + 1, tab.y + 1, tab.width - 2, tab.height - 2);
		const title = PAGES.find((candidate) => candidate.id === tab.page)?.title ?? '';
		context.fillStyle = active ? '#031018' : '#7f96a8';
		context.font = 'bold 13px sans-serif';
		context.textAlign = 'center';
		context.fillText(title.toUpperCase(), tab.x + tab.width / 2, tab.y + tab.height / 2 + 1);
		context.textAlign = 'left';
	}
}

/** What `createTablet` gives the scene. */
export interface Tablet {
	/** The configuration now on the car. */
	readonly config: Config;
	/** The page on show. */
	readonly page: ConfigPage;
	/** Sends a change that the refresh rate held back. Call once per frame. */
	update(): void;
}

/**
 * Builds the tablet, its stand and its shell, and answers a tap on it. `onChange` runs with the new
 * configuration each time a tap changes it.
 */
export function createTablet(
	ctx: SketchContext,
	onChange: (config: Config) => void,
	start: Config = START_CONFIG,
): Tablet {
	const { scene, geometry, materials } = ctx;
	const state = { config: start, page: PAGES[0]?.id ?? 'paint' };
	const screen = createScreen(ctx, {
		width: WIDTH,
		height: HEIGHT,
		refreshHz: 12,
		size: SIZE,
		lcd: { subpixels: 0.7, scan: 0.45, deadPixels: 0.0015, glow: 1.25 },
		draw: (context) => paint(context, state.config, state.page),
	});
	const quaternion = [0, Math.sin(FACING / 2), 0, Math.cos(FACING / 2)] as const;
	screen.mesh.setPosition(AT[0], AT[1], AT[2]);
	screen.mesh.setRotationEuler(0, FACING, 0);
	// The shell behind the panel and the stand under it, both turned with the face.
	const normal = [Math.sin(FACING), 0, Math.cos(FACING)] as const;
	const shell = materials.standard({ color: '#101419', roughness: 0.3, metalness: 0.6 });
	scene.createMesh({
		mesh: geometry.box({ width: 1.3, height: 0.82, depth: 0.035 }),
		material: shell,
		position: [AT[0] - normal[0] * 0.035, AT[1], AT[2] - normal[2] * 0.035],
		rotation: [...quaternion],
	});
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.05, radiusBottom: 0.07, height: 0.78 }),
		material: shell,
		position: [AT[0] - normal[0] * 0.05, AT[1] - 0.79, AT[2] - normal[2] * 0.05],
	});
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.3, radiusBottom: 0.34, height: 0.05 }),
		material: shell,
		position: [AT[0] - normal[0] * 0.05, 0.025, AT[2] - normal[2] * 0.05],
	});

	screen.onClick((point) => {
		const action = tabletAction(point);
		if (!action) return;
		if (action.kind === 'page') {
			state.page = action.page;
			screen.paint((context) => paint(context, state.config, state.page));
			return;
		}
		state.config = cycle(state.config, state.page, action.step);
		screen.paint((context) => paint(context, state.config, state.page));
		onChange(state.config);
	});
	return {
		get config() {
			return state.config;
		},
		get page() {
			return state.page;
		},
		update: () => void screen.flush(),
	};
}
