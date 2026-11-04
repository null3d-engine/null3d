// The tablet beside the plinth of the clear coat and sheen demo (sketch.ts), from the screens
// add-on. It shows the car's fit on a display drawn on an OffscreenCanvas: the paint, the wheels
// and the trim, each on a page of its own. A tap cycles the pages and repaints the canvas, which
// uploads as one change. The panel uses the LCD look, so its sub-pixels and dead texels show when
// the camera comes close, and a boot glitch runs as the demo starts.
import type { SketchContext } from '@null3d/engine';
import { createScreen } from '../addons/screens';

/** The canvas's size in texels, and the tablet's size in meters. */
const WIDTH = 256;
const HEIGHT = 160;
const [ACROSS, DOWN] = [0.34, 0.2125];

/** The pages of the car's fit, in the order that a tap cycles them. */
const PAGES = [
	{ title: 'PAINT', value: 'CANDY RED', detail: 'FLAKE 0.25  COAT 1.00' },
	{ title: 'WHEELS', value: 'FIVE-SPOKE', detail: 'RIM 20 in  TYRE 265' },
	{ title: 'TRIM', value: 'CARBON', detail: 'TWILL 2x2  SHINE 0.85' },
] as const;

/** Draws one page of the tablet's canvas. */
function paintPage(context: OffscreenCanvasRenderingContext2D, page: number): void {
	const { title, value, detail } = PAGES[page % PAGES.length];
	context.fillStyle = '#080d12';
	context.fillRect(0, 0, WIDTH, HEIGHT);
	context.fillStyle = '#1b2733';
	context.fillRect(10, 10, WIDTH - 20, 28);
	context.fillStyle = '#8fe8ff';
	context.font = 'bold 16px sans-serif';
	context.textBaseline = 'top';
	context.fillText('SABLE GT', 18, 16);
	context.fillStyle = '#3d4f5f';
	context.font = 'bold 10px sans-serif';
	context.fillText(`PAGE ${(page % PAGES.length) + 1}/${PAGES.length}`, 176, 20);
	context.fillStyle = '#57c8e0';
	context.font = 'bold 12px sans-serif';
	context.fillText(title, 18, 52);
	context.fillStyle = '#eaf6ff';
	context.font = 'bold 22px sans-serif';
	context.fillText(value, 18, 68);
	context.fillStyle = '#7f96a8';
	context.font = '11px monospace';
	context.fillText(detail, 18, 100);
	// The page buttons, with the current one lit.
	for (let k = 0; k < PAGES.length; k++) {
		context.fillStyle = k === page % PAGES.length ? '#39d0e8' : '#1b2733';
		context.fillRect(18 + k * 28, 126, 22, 16);
	}
	context.fillStyle = '#3d4f5f';
	context.font = '10px sans-serif';
	context.fillText('TAP TO CYCLE', 160, 130);
}

/** Adds the tablet beside the plinth, and returns the call that sends a held-back change. */
export function createTablet(ctx: SketchContext): { update(): void } {
	const { scene, materials, geometry } = ctx;
	const screen = createScreen(ctx, {
		width: WIDTH,
		height: HEIGHT,
		refreshHz: 8,
		size: [ACROSS, DOWN],
		lcd: { subpixels: 0.7, scan: 0.5, deadPixels: 0.002, glow: 1.2 },
		draw: (context) => paintPage(context, 0),
	});
	screen.mesh.setPosition(2.55, 0.62, 2.3);
	screen.mesh.setRotationEuler(-0.3, 0.22, 0);

	// A dark bezel that holds the panel, and a stand under it.
	const shell = materials.standard({ color: '#15181d', roughness: 0.35, metalness: 0.6 });
	const body = scene.createMesh({
		mesh: geometry.box({ width: ACROSS + 0.03, height: DOWN + 0.03, depth: 0.02 }),
		material: shell,
		position: [2.55, 0.62, 2.285],
	});
	body.setRotationEuler(-0.3, 0.22, 0);
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.022, radiusBottom: 0.05, height: 0.53 }),
		material: shell,
		position: [2.55, 0.265, 2.33],
	});

	let page = 0;
	screen.onClick(() => {
		page = (page + 1) % PAGES.length;
		paintPage(screen.context, page);
		screen.paint(() => {});
	});
	return { update: () => void screen.flush() };
}
