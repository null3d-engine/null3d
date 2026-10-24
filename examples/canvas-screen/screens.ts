// The screens of the reactor control room (sketch.ts): three wall panels that a sketch paints on
// OffscreenCanvas objects, and a small console panel close to the camera that shows the panel's own
// structure. Each wall panel refreshes at its own rate, and a panel uploads only the rectangles that
// its numbers, bar and lights changed. A click turns a panel's power down or up, with a boot glitch
// on the way on. The console's texels are large on screen, so its sub-pixels and dead texels show.
import type { CanvasRect, SketchContext } from '@null3d/engine';
import { createScreen, type Screen } from '../addons/screens';

/** The wall panels' canvas size in texels, and the rectangles that their readings repaint. */
const SIZE = 512;
const NUMBER = { x: 24, y: 150, width: 464, height: 150 };
const BAR = { x: 24, y: 330, width: 464, height: 48 };
const LIGHTS = { x: 24, y: 400, width: 464, height: 40 };
const READINGS = { x: 24, y: 150, width: 464, height: 290 };

/** The console panel's canvas size in texels, and the rectangles that its picture repaints. */
const CONSOLE = { width: 160, height: 90 };
const WAVE = { x: 6, y: 20, width: 148, height: 38 };
const CONSOLE_VALUES = { x: 6, y: 62, width: 148, height: 24 };

/** The pieces of one panel that the sketch keeps and moves. */
interface Panel {
	readonly screen: Screen;
	/** The panel's power now, and where a click moves it. */
	power: number;
	target: number;
	/** The sketch time of the panel's next boot. */
	nextBoot: number;
	/** Paints the part of the panel that changed, or nothing when it did not. */
	update(now: number): void;
}

/** Draws the wall panel's frame, which never changes. */
function paintFrame(context: OffscreenCanvasRenderingContext2D, title: string, hz: number): void {
	context.fillStyle = '#060b12';
	context.fillRect(0, 0, SIZE, SIZE);
	context.strokeStyle = '#0e4a5a';
	context.lineWidth = 3;
	for (let at = 0; at <= SIZE; at += 32) {
		context.beginPath();
		context.moveTo(at, 0);
		context.lineTo(at, SIZE);
		context.moveTo(0, at);
		context.lineTo(SIZE, at);
		context.stroke();
	}
	context.fillStyle = '#1b9fb8';
	context.font = 'bold 30px sans-serif';
	context.textBaseline = 'top';
	context.fillText(title, 24, 96);
	context.fillStyle = '#0f5f72';
	context.font = 'bold 18px sans-serif';
	context.fillText(`${hz} HZ`, 24, 456);
}

/** Clears the readings and draws the number, the bar and the row of lights. */
function drawReadings(context: OffscreenCanvasRenderingContext2D, number: number): void {
	context.fillStyle = '#060b12';
	context.fillRect(READINGS.x, READINGS.y, READINGS.width, READINGS.height);
	context.fillStyle = '#bff4ff';
	context.font = 'bold 128px sans-serif';
	context.textBaseline = 'top';
	context.fillText(number.toFixed(1), NUMBER.x, NUMBER.y);
	const filled = Math.round(BAR.width * Math.min(1, number / 100));
	context.fillStyle = '#123040';
	context.fillRect(BAR.x, BAR.y, BAR.width, BAR.height);
	context.fillStyle = '#37c8e8';
	context.fillRect(BAR.x, BAR.y, filled, BAR.height);
	for (let k = 0; k < 8; k++) {
		context.fillStyle = k / 8 < number / 100 ? '#37c8e8' : '#123040';
		context.fillRect(LIGHTS.x + k * 58, LIGHTS.y, 50, LIGHTS.height);
	}
}

/** Makes one wall panel: its canvas, its rate, and the part that its reading repaints. */
function wallPanel(
	ctx: SketchContext,
	x: number,
	title: string,
	hz: number,
	value: (now: number) => number,
): Panel {
	const screen = createScreen(ctx, {
		width: SIZE,
		height: SIZE,
		refreshHz: hz,
		size: [2.5, 2.5],
		// The frame and the first reading upload together in the texture's first picture.
		draw: (context) => {
			paintFrame(context, title, hz);
			drawReadings(context, value(0));
		},
	});
	screen.mesh.setPosition(x, 0.2, -0.95);
	let shown = value(0).toFixed(1);
	const update = (now: number): void => {
		const number = value(now);
		const text = number.toFixed(1);
		if (text !== shown) {
			shown = text;
			drawReadings(screen.context, number);
			screen.mark(READINGS);
		}
		screen.flush();
	};
	return { screen, power: 1, target: 1, nextBoot: 2.5, update };
}

/** Draws the console panel's fixed parts: its frame and its title. */
function paintConsole(context: OffscreenCanvasRenderingContext2D): void {
	context.fillStyle = '#061019';
	context.fillRect(0, 0, CONSOLE.width, CONSOLE.height);
	context.strokeStyle = '#123a4a';
	context.lineWidth = 2;
	context.strokeRect(1, 1, CONSOLE.width - 2, CONSOLE.height - 2);
	context.fillStyle = '#5fd8ef';
	context.font = 'bold 11px monospace';
	context.textBaseline = 'top';
	context.fillText('DECK 7  30 HZ', 6, 5);
	context.strokeStyle = '#0d2a36';
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(WAVE.x, WAVE.y + WAVE.height / 2);
	context.lineTo(WAVE.x + WAVE.width, WAVE.y + WAVE.height / 2);
	context.stroke();
}

/** Clears the wave and draws the trace at the sketch time. */
function drawWave(context: OffscreenCanvasRenderingContext2D, now: number): void {
	const mid = WAVE.y + WAVE.height / 2;
	context.fillStyle = '#061019';
	context.fillRect(WAVE.x, WAVE.y, WAVE.width, WAVE.height);
	context.strokeStyle = '#39d0e8';
	context.lineWidth = 1;
	context.beginPath();
	for (let k = 0; k <= WAVE.width; k++) {
		const phase = k * 0.18 - now * 2.2;
		const y = mid + Math.sin(phase) * 12 * Math.sin(now * 0.7 + k * 0.02);
		if (k === 0) context.moveTo(WAVE.x + k + 0.5, y);
		else context.lineTo(WAVE.x + k + 0.5, y);
	}
	context.stroke();
}

/** Clears the console's values and writes them. */
function drawConsoleValues(context: OffscreenCanvasRenderingContext2D, now: number): void {
	context.fillStyle = '#061019';
	context.fillRect(CONSOLE_VALUES.x, CONSOLE_VALUES.y, CONSOLE_VALUES.width, CONSOLE_VALUES.height);
	context.fillStyle = '#9fe8ff';
	context.font = 'bold 9px monospace';
	context.textBaseline = 'top';
	context.fillText(`FLOW ${(42 + 8 * Math.sin(now * 1.3)).toFixed(1)}`, 6, 63);
	context.fillText(`TEMP ${(28 + 3 * Math.cos(now * 0.9)).toFixed(1)}`, 86, 63);
	context.fillText(`O2 ${(97 + 2 * Math.sin(now * 0.4)).toFixed(1)}`, 6, 74);
	context.fillStyle = now % 1 < 0.5 ? '#39d0e8' : '#0d2a36';
	context.fillRect(146, 74, 6, 7);
}

/** Makes the console panel, which sits close to the camera below the wall panels. */
function consolePanel(ctx: SketchContext): Panel {
	const screen = createScreen(ctx, {
		width: CONSOLE.width,
		height: CONSOLE.height,
		refreshHz: 30,
		size: [1.6, 0.9],
		draw: (context) => {
			paintConsole(context);
			drawWave(context, 0);
			drawConsoleValues(context, 0);
		},
	});
	// The panel leans back toward the camera, on a dark body with a stand below it. It stands far
	// enough back that its top edge stays below the wall panels' readings.
	screen.mesh.setPosition(0, -1.25, 2.6);
	screen.mesh.setRotationEuler(-0.3, 0, 0);
	const body = ctx.materials.standard({ color: '#141c24', roughness: 0.45, metalness: 0.5 });
	const shell = ctx.scene.createMesh({
		mesh: ctx.geometry.box({ width: 1.74, height: 1.02, depth: 0.08 }),
		material: body,
		position: [0, -1.25, 2.56],
	});
	shell.setRotationEuler(-0.3, 0, 0);
	ctx.scene.createMesh({
		mesh: ctx.geometry.cylinder({ radiusTop: 0.1, radiusBottom: 0.14, height: 0.8 }),
		material: body,
		position: [0, -2.05, 2.65],
	});
	const update = (now: number): void => {
		const rects: CanvasRect[] = [WAVE, CONSOLE_VALUES];
		drawWave(screen.context, now);
		drawConsoleValues(screen.context, now);
		for (const rect of rects) screen.mark(rect);
		// A mark that the panel's rate holds back stays for the next call.
		screen.flush();
	};
	return { screen, power: 1, target: 1, nextBoot: 2.5, update };
}

/**
 * Builds the room's screens. Returns the call that moves them each frame: it paints the readings at
 * each panel's own rate, moves a panel's power toward where a click sent it, and replays a boot
 * glitch on a schedule and on each power-on.
 */
export function createPanels(ctx: SketchContext): { update(now: number): void } {
	const panels = [
		wallPanel(ctx, -2.8, 'REACTOR', 20, (now) => 62 + 24 * Math.sin(now * 0.8)),
		wallPanel(ctx, 0, 'SHIELD', 12, (now) => 50 + 40 * Math.sin(now * 1.7 + 1)),
		wallPanel(ctx, 2.8, 'COOLANT', 8, (now) => 35 + 30 * Math.cos(now * 1.1)),
		consolePanel(ctx),
	];
	for (const panel of panels)
		panel.screen.onClick(() => {
			panel.target = panel.target > 0 ? 0 : 1;
			if (panel.target > 0) panel.screen.boot(ctx.time.now);
		});
	/** The sketch time of the last update, for the step of a power change. */
	let last = -1;
	return {
		update(now: number): void {
			const step = last < 0 ? 1 : Math.min(1, Math.max(0, now - last) / 0.35);
			last = now;
			for (const panel of panels) {
				if (now >= panel.nextBoot) {
					panel.screen.boot(now);
					panel.nextBoot = now + 8;
				}
				const towards = panel.target - panel.power;
				if (towards !== 0) {
					// A power change runs over a moment, so the panel fades rather than cuts.
					panel.power += Math.sign(towards) * Math.min(Math.abs(towards), step);
					panel.screen.set({ power: panel.power });
				}
				panel.update(now);
			}
		},
	};
}
