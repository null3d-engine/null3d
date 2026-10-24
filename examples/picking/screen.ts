// A display on the gallery wall, beside the plinth, from the screens add-on: a plan painted on an
// OffscreenCanvas, with a square for each click. The screen maps a click back to the canvas's own
// coordinates, so the square lands where the pointer points without the sketch working out where
// the plane lies in space. A click uploads only the rectangles that it changed: the mark it adds
// and the mark that the plan drops. The picture is painted in the setup, so a held frame shows it.
import type { CanvasRect, SketchContext } from '@null3d/engine';
import { createScreen } from '../addons/screens';

/** The canvas's size in texels, at the screen's 2:1 shape. */
const WIDTH = 256;
const HEIGHT = 128;
/** The screen's size in meters. */
const W = 3.2;
const H = 1.6;
/** The side of a click mark, in texels, and how many the plan keeps. */
const MARK = 9;
const KEPT = 8;

/** The plan's colors. */
const BACK = '#222e4e';
const GRID = '#5684b4';
const MARK_COLOR = '#ffd678';
/** The grid's spacing in texels. */
const GRID_STEP = 32;

/** The square that a mark paints, in canvas coordinates. */
function markRect(x: number, y: number): CanvasRect {
	const half = (MARK - 1) / 2;
	return { x: x - half, y: y - half, width: MARK, height: MARK };
}

/** The plan on the wall, and the marks that clicks add to it. */
export function createScreenDisplay(ctx: SketchContext): { update(): void } {
	const { scene, geometry, materials } = ctx;
	/** The marks, oldest first, in canvas coordinates. */
	const marks: { x: number; y: number }[] = [];
	/** Draws the plan's ground and grid, and the marks that reach into the rectangle. */
	const drawRegion = (context: OffscreenCanvasRenderingContext2D, rect: CanvasRect): void => {
		context.fillStyle = BACK;
		context.fillRect(rect.x, rect.y, rect.width, rect.height);
		context.strokeStyle = GRID;
		context.lineWidth = 1;
		context.beginPath();
		for (
			let x = Math.ceil(rect.x / GRID_STEP) * GRID_STEP;
			x <= rect.x + rect.width;
			x += GRID_STEP
		) {
			context.moveTo(x + 0.5, rect.y);
			context.lineTo(x + 0.5, rect.y + rect.height);
		}
		for (
			let y = Math.ceil(rect.y / GRID_STEP) * GRID_STEP;
			y <= rect.y + rect.height;
			y += GRID_STEP
		) {
			context.moveTo(rect.x, y + 0.5);
			context.lineTo(rect.x + rect.width, y + 0.5);
		}
		context.stroke();
		context.fillStyle = MARK_COLOR;
		for (const mark of marks) {
			const square = markRect(mark.x, mark.y);
			if (
				square.x > rect.x + rect.width ||
				square.x + square.width < rect.x ||
				square.y > rect.y + rect.height ||
				square.y + square.height < rect.y
			)
				continue;
			context.fillRect(square.x, square.y, square.width, square.height);
		}
	};
	const screen = createScreen(ctx, {
		width: WIDTH,
		height: HEIGHT,
		refreshHz: 12,
		size: [W, H],
		draw: (context) => drawRegion(context, { x: 0, y: 0, width: WIDTH, height: HEIGHT }),
	});
	screen.mesh.setPosition(0, 1.1, -4.2);
	scene.createMesh({
		mesh: geometry.box({ width: W + 0.16, height: H + 0.16, depth: 0.1 }),
		material: materials.standard({ color: '#0e1014', roughness: 0.5 }),
		position: [0, 1.1, -4.27],
	});

	// A click marks the plan where it landed, and uploads the two rectangles that changed.
	screen.onClick((point) => {
		const square = markRect(point.x, point.y);
		const dropped = marks.length >= KEPT ? marks.shift() : undefined;
		marks.push({ x: point.x, y: point.y });
		const changed = dropped ? [square, markRect(dropped.x, dropped.y)] : [square];
		for (const rect of changed) drawRegion(screen.context, rect);
		for (const rect of changed) screen.mark(rect);
		screen.flush();
	});
	// A mark that the screen's rate holds back goes in the next frame.
	return { update: () => void screen.flush() };
}
