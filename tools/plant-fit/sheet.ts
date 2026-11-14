// A contact sheet of a turning video's fit, for a reviewer to judge the reference: each view's frame
// with its mask (the background dimmed), and below it the view's crown outline against the
// envelope's outline from the same turn. A view the envelope left out shows its reason instead.
import { join } from 'node:path';
import { writePng } from '../../packages/cli/src/png.js';
import { envelopeSilhouette, envelopeVolume } from '../../packages/vegetation/src/grow/envelope.ts';
import { overlay } from '../lib/plant-review/compare.ts';
import { blank, drawText, pasteFitted, type Rgba } from '../lib/plant-review/image.ts';
import { maskPreview } from '../lib/plant-review/references.ts';
import { CELLS, COLUMNS } from './silhouettes.ts';
import type { TurnFit } from './turn.ts';

const WIDTH = 1600;
const COLUMNS_PER_ROW = 8;
const GAP = 6;
const INK = [235, 235, 235];
const DIM = [150, 150, 150];
const PAPER = [18, 18, 18];

/** A grid with rows from the ground up, turned so its first row is the top, as pictures run. */
function topDown(grid: Uint8Array): Uint8Array {
	const out = new Uint8Array(grid.length);
	for (let row = 0; row < CELLS; row++)
		out.set(grid.subarray(row * COLUMNS, (row + 1) * COLUMNS), (CELLS - 1 - row) * COLUMNS);
	return out;
}

/**
 * Writes the sheet of a turning video's fit and returns its path.
 *
 * @param fit The fit.
 * @param frames The video's frames, as the fit read them.
 * @param dir The folder to write into.
 * @param name The file's name, less its extension.
 */
export function writeTurnSheet(
	fit: TurnFit,
	frames: readonly Rgba[],
	dir: string,
	name: string,
): string {
	const tileW = Math.floor((WIDTH - GAP * (COLUMNS_PER_ROW + 1)) / COLUMNS_PER_ROW);
	const first = frames[0] as Rgba;
	const imageH = Math.round((tileW * first.height) / first.width);
	const outlineH = Math.round(tileW * 0.5);
	const tileH = imageH + outlineH + 30;
	const header = 70;
	const rows = Math.ceil(fit.outlines.length / COLUMNS_PER_ROW);
	const page = blank(WIDTH, header + rows * (tileH + GAP) + GAP, PAPER);
	const hull = fit.hull;
	drawText(page, `${name}  ${fit.video}  ${fit.arc} DEG`, GAP, 10, 3, INK);
	drawText(
		page,
		hull
			? `CROWN BASE ${hull.crownBase}  ASPECT ${hull.aspect}  ENVELOPE AGAINST VIEWS ${hull.consistency.lowest} TO ${hull.consistency.highest}, MEAN ${hull.consistency.mean}`
			: (fit.problems[0] ?? 'NO ENVELOPE'),
		GAP,
		40,
		2,
		DIM,
	);
	const volume = hull ? envelopeVolume(hull.envelope, 1, 0) : null;
	const grid = { left: -COLUMNS / 2 / CELLS, cell: 1 / CELLS, cols: COLUMNS, rows: CELLS };
	const span = fit.frames - 1;
	fit.outlines.forEach((outline, t) => {
		const x = GAP + (t % COLUMNS_PER_ROW) * (tileW + GAP);
		const y = header + Math.floor(t / COLUMNS_PER_ROW) * (tileH + GAP);
		const image = frames[outline.frame] as Rgba;
		pasteFitted(page, maskPreview(image, outline.mask), x, y, tileW, imageH);
		const turn = (((fit.arc * outline.frame) / span) * Math.PI) / 180;
		if (outline.grid && volume) {
			const own = envelopeSilhouette(volume, turn, grid);
			pasteFitted(
				page,
				overlay(topDown(outline.grid), topDown(own), tileW, outlineH, COLUMNS, CELLS),
				x,
				y + imageH,
				tileW,
				outlineH,
			);
		}
		const score = hull?.consistency.views.find((v) => v.frame === outline.frame)?.iou;
		drawText(
			page,
			`F${outline.frame} ${((turn * 180) / Math.PI).toFixed(0)} DEG ${score === undefined ? '' : `IOU ${score.toFixed(2)}`}`,
			x + 2,
			y + imageH + outlineH + 4,
			1,
			INK,
		);
		if (outline.problem)
			drawText(page, outline.problem.toUpperCase(), x + 2, y + imageH + outlineH + 16, 1, DIM);
	});
	const path = join(dir, `${name}.png`);
	writePng(path, page);
	return path;
}
