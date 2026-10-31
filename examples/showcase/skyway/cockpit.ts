// The hero car's own displays, from the screens add-on (M3-B3): the two panels that show the speed
// and the altitude, and the navigation panel between them. Each panel is a canvas that refreshes at
// its own rate, and only the rectangles that its reading changed upload. The panels use the LCD
// look, so their sub-pixels and dead texels show when the camera comes close. They stand on the
// dashboard in front of the driver's seat, inside the cockpit, on the body, which carries the car's
// scale.
import type { Object3D, QuatLike, SketchContext } from '@null3d/engine';
import { createScreen, type Screen } from '../../addons/screens';
import { EFFECT_LAYER } from '../../lib/layers';

/** The reading panel's canvas in texels, and the rectangles that its reading repaints. */
const DECK = { width: 512, height: 256 };
const READING = { x: 20, y: 46, width: 466, height: 146 };
const BAR = { x: 26, y: 208, width: 460, height: 20 };

/** The navigation panel's canvas in texels, and the rectangles that its picture repaints. */
const NAV = { width: 256, height: 128 };
const MAP = { x: 8, y: 26, width: 240, height: 82 };
const NAV_VALUES = { x: 8, y: 108, width: 240, height: 14 };

/** The reading panel's fixed frame, drawn before the first upload. */
function paintDeckFrame(context: OffscreenCanvasRenderingContext2D, title: string): void {
	context.fillStyle = '#050b12';
	context.fillRect(0, 0, DECK.width, DECK.height);
	context.strokeStyle = '#1d4a63';
	context.lineWidth = 4;
	context.strokeRect(8, 8, DECK.width - 16, DECK.height - 16);
	context.fillStyle = '#3fa8c8';
	context.font = 'bold 26px sans-serif';
	context.textAlign = 'left';
	context.textBaseline = 'top';
	context.fillText(title, 26, 18);
	context.fillStyle = '#1b3a4a';
	context.fillRect(BAR.x, BAR.y, BAR.width, BAR.height);
}

/** Clears the reading and draws the whole number, its unit and the bar. */
function paintReading(
	context: OffscreenCanvasRenderingContext2D,
	whole: number,
	unit: string,
): void {
	context.fillStyle = '#050b12';
	context.fillRect(READING.x, READING.y, READING.width, READING.height);
	context.fillStyle = '#c9f2ff';
	context.font = 'bold 112px sans-serif';
	context.textAlign = 'right';
	context.textBaseline = 'top';
	context.fillText(String(whole), 398, 54);
	context.fillStyle = '#5fc8e8';
	context.font = 'bold 30px sans-serif';
	context.textAlign = 'left';
	context.fillText(unit, 412, 118);
	context.fillStyle = '#1b3a4a';
	context.fillRect(BAR.x, BAR.y, BAR.width, BAR.height);
	context.fillStyle = '#37c8e8';
	context.fillRect(BAR.x, BAR.y, Math.round(BAR.width * Math.min(1, whole / 400)), BAR.height);
}

/** Draws the navigation panel's fixed frame, before the first upload. */
function paintNavFrame(context: OffscreenCanvasRenderingContext2D): void {
	context.fillStyle = '#050b12';
	context.fillRect(0, 0, NAV.width, NAV.height);
	context.strokeStyle = '#1d4a63';
	context.lineWidth = 2;
	context.strokeRect(3, 3, NAV.width - 6, NAV.height - 6);
	context.fillStyle = '#3fa8c8';
	context.font = 'bold 12px sans-serif';
	context.textAlign = 'left';
	context.textBaseline = 'top';
	context.fillText('NAV  SECTOR 07', 8, 8);
}

/** Clears the map and draws the streets, the ring and the car's place on it. */
function paintMap(context: OffscreenCanvasRenderingContext2D, t: number): void {
	const cx = MAP.x + MAP.width / 2;
	const cy = MAP.y + MAP.height / 2;
	context.fillStyle = '#061019';
	context.fillRect(MAP.x, MAP.y, MAP.width, MAP.height);
	context.strokeStyle = '#133342';
	context.lineWidth = 1;
	context.beginPath();
	for (let x = MAP.x + 12; x < MAP.x + MAP.width; x += 24) {
		context.moveTo(x + 0.5, MAP.y);
		context.lineTo(x + 0.5, MAP.y + MAP.height);
	}
	for (let y = MAP.y + 10; y < MAP.y + MAP.height; y += 20) {
		context.moveTo(MAP.x, y + 0.5);
		context.lineTo(MAP.x + MAP.width, y + 0.5);
	}
	context.stroke();
	// The lanes' ring around the district, and the car's place on it.
	context.strokeStyle = '#1d4a63';
	context.beginPath();
	context.ellipse(cx, cy, 92, 32, 0, 0, Math.PI * 2);
	context.stroke();
	const angle = t * 0.6;
	const px = cx + Math.cos(angle) * 92;
	const py = cy + Math.sin(angle) * 32;
	context.fillStyle = '#9fe8ff';
	context.beginPath();
	context.arc(px, py, 3, 0, Math.PI * 2);
	context.fill();
	context.strokeStyle = '#39d0e8';
	context.beginPath();
	context.moveTo(px, py);
	context.lineTo(cx + Math.cos(angle) * 104, cy + Math.sin(angle) * 36);
	context.stroke();
}

/** Writes the navigation panel's values under the map. */
function paintNavValues(
	context: OffscreenCanvasRenderingContext2D,
	kmh: number,
	altitude: number,
): void {
	context.fillStyle = '#061019';
	context.fillRect(NAV_VALUES.x, NAV_VALUES.y, NAV_VALUES.width, NAV_VALUES.height);
	context.fillStyle = '#9fe8ff';
	context.font = 'bold 10px monospace';
	context.textAlign = 'left';
	context.textBaseline = 'top';
	context.fillText(`${Math.round(kmh)} KM/H`, 8, 109);
	context.fillText(`${Math.round(altitude)} M`, 110, 109);
	context.fillStyle = '#39d0e8';
	context.fillRect(224, 109, 16, 5);
}

/** One reading panel, with the call that draws its reading. */
interface DeckPanel {
	readonly screen: Screen;
	/** Draws the whole number when it changes, and sends a mark that a rate held back. */
	paint(whole: number): void;
}

/** Makes a reading panel: its frame and first reading, its rate, and its reading's rectangles. */
function deckPanel(
	ctx: SketchContext,
	body: Object3D,
	tilt: QuatLike,
	x: number,
	title: string,
	unit: string,
): DeckPanel {
	const screen = createScreen(ctx, {
		width: DECK.width,
		height: DECK.height,
		refreshHz: 12,
		size: [0.46, 0.23],
		lcd: { subpixels: 0.5, scan: 0.35, deadPixels: 0.0012, glow: 1.2 },
		// The first picture carries the frame and a reading, so a held frame shows both.
		draw: (context) => {
			paintDeckFrame(context, title);
			paintReading(context, 0, unit);
		},
	});
	screen.mesh.setParent(body);
	screen.mesh.setPosition(x * DASH.step, DASH.y, DASH.z);
	screen.mesh.setScale(DASH.scale, DASH.scale, DASH.scale);
	screen.mesh.setRotation(tilt[0] ?? 0, tilt[1] ?? 0, tilt[2] ?? 0, tilt[3] ?? 1);
	screen.mesh.setLayers(EFFECT_LAYER);
	let shown = 0;
	return {
		screen,
		paint(whole: number): void {
			if (whole !== shown) {
				shown = whole;
				paintReading(screen.context, whole, unit);
				screen.mark(READING);
				screen.mark(BAR);
			}
			screen.flush();
		},
	};
}

/** Makes the cockpit's navigation panel, between the two reading panels. */
function navPanel(ctx: SketchContext, body: Object3D, tilt: QuatLike): Screen {
	const screen = createScreen(ctx, {
		width: NAV.width,
		height: NAV.height,
		refreshHz: 8,
		size: [0.46, 0.23],
		lcd: { subpixels: 0.45, scan: 0.3, deadPixels: 0.0015, glow: 1.1 },
		draw: (context) => {
			paintNavFrame(context);
			paintMap(context, 0);
			paintNavValues(context, 0, 0);
		},
	});
	screen.mesh.setParent(body);
	screen.mesh.setPosition(0, DASH.y, DASH.z);
	screen.mesh.setScale(DASH.scale, DASH.scale, DASH.scale);
	screen.mesh.setRotation(tilt[0] ?? 0, tilt[1] ?? 0, tilt[2] ?? 0, tilt[3] ?? 1);
	screen.mesh.setLayers(EFFECT_LAYER);
	return screen;
}

/** The hero car's displays. */
export interface Cockpit {
	/** Draws the flight on each panel at its own rate. Call once per frame with the flight's values. */
	update(t: number, kmh: number, altitude: number): void;
}

/**
 * Where the panels stand on the dashboard, in the body's own units: the middle panel's place, the
 * step between two panels and the panels' scale. The dashboard sits below the driver's eye and
 * ahead of it, so the three panels fill the lower middle of the view from the seat.
 */
const DASH = { y: 0.94, z: 0.7, step: 0.2, scale: 0.42 };

/**
 * Builds the car's three panels and returns the calls that draw and place them. The body carries
 * the car's scale, and `tilt` turns the panels up toward the eye that reads them.
 */
export function createCockpit(ctx: SketchContext, body: Object3D, tilt: QuatLike): Cockpit {
	const speed = deckPanel(ctx, body, tilt, -1, 'VELOCITY', 'km/h');
	const flight = deckPanel(ctx, body, tilt, 1, 'FLIGHT 07', 'ALT');
	const nav = navPanel(ctx, body, tilt);
	let mapAt = Number.NEGATIVE_INFINITY;
	return {
		update(t: number, kmh: number, altitude: number): void {
			// The navigation panel's map moves at its own rate, and the reading panels at theirs.
			if (t - mapAt >= 1 / 8) {
				mapAt = t;
				paintMap(nav.context, t);
				paintNavValues(nav.context, kmh, altitude);
				nav.mark(MAP);
				nav.mark(NAV_VALUES);
				nav.flush();
			}
			speed.paint(Math.round(kmh));
			flight.paint(Math.round(altitude));
		},
	};
}
