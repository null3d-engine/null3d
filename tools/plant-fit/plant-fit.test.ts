import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { envelopeSilhouette, envelopeVolume } from '../../packages/vegetation/src/grow/envelope.ts';
import { oakRecord } from '../../packages/vegetation/src/grow/oak.fixture.ts';
import { REPO_ROOT } from '../../tests/lib/server.ts';
import { iou } from '../lib/plant-review/compare.ts';
import { readReferenceSet } from '../lib/plant-review/references.ts';
import { AZIMUTHS, crownBaseRow, type HullView, hullEnvelope } from './envelope.ts';
import { roundBandOf } from './fit-file.ts';
import { checkLeaf } from './leaf.ts';
import { CELLS, COLUMNS, closingOverlap, columnX, dropThinLowRuns } from './silhouettes.ts';
import { fitTurn, type TurnFit } from './turn.ts';

/** A crown's radius in plant heights at a height share and an azimuth: an egg on a bare stem. */
function crownRadius(t: number, phi: number): number {
	if (t < 0.3 || t > 1) return 0;
	const s = (t - 0.3) / 0.7;
	const profile = Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2));
	// Wider along X than along Z.
	const plan = 1 / Math.sqrt((Math.cos(phi) / 0.5) ** 2 + (Math.sin(phi) / 0.35) ** 2);
	return profile * plan;
}

/** The outline of the test plant seen at a turn: the crown's slab at each row, and the stem. */
function outlineAt(turn: number): Uint8Array {
	const grid = new Uint8Array(CELLS * COLUMNS);
	for (let row = 0; row < CELLS; row++) {
		const t = (row + 0.5) / CELLS;
		let right = 0.02;
		let left = 0.02;
		for (let k = 0; k < 720; k++) {
			const phi = (k / 720) * 2 * Math.PI;
			const along = crownRadius(t, phi) * Math.cos(phi + turn);
			right = Math.max(right, along);
			left = Math.max(left, -along);
		}
		for (let col = 0; col < COLUMNS; col++) {
			const x = columnX(col);
			if (x <= right && x >= -left) grid[row * COLUMNS + col] = 1;
		}
	}
	return grid;
}

/** Views of the test plant at even turns over a full circle. */
function views(count: number): HullView[] {
	return Array.from({ length: count }, (_, k) => {
		const turn = (k / count) * 2 * Math.PI;
		return { frame: k, turn, grid: outlineAt(turn) };
	});
}

describe('the envelope', () => {
	const fit = hullEnvelope(views(32), 'test-turntable.mp4');

	test("finds the crown's base above a bare stem", () => {
		expect(fit.crownBase).toBeGreaterThan(0.29);
		expect(fit.crownBase).toBeLessThan(0.33);
	});

	test("measures the crown's radius by azimuth", () => {
		const volume = envelopeVolume(fit.envelope, 1, 0);
		for (const t of [0.5, 0.65, 0.8])
			for (let a = 0; a < AZIMUTHS; a++) {
				const phi = (a / AZIMUTHS) * 2 * Math.PI;
				expect(Math.abs(volume.radius(t, phi) - crownRadius(t, phi))).toBeLessThan(0.03);
			}
	});

	test('draws outlines that match the views it came from', () => {
		expect(fit.consistency.lowest).toBeGreaterThan(0.93);
		expect(fit.envelope.source).toEqual({
			method: 'turntable-hull',
			from: 'test-turntable.mp4',
			views: 32,
		});
		// The crown is 1 wide along X and 0.7 along Z, so its width over the turn lies between.
		expect(fit.aspect).toBeGreaterThan(0.7);
		expect(fit.aspect).toBeLessThanOrEqual(1.02);
	});

	test('passes over a few views where the plant drifts', () => {
		const drifting = views(32).map((view, k) =>
			k % 16 === 3
				? { ...view, grid: outlineAt(view.turn).map((v, i) => (i % COLUMNS < 120 ? 0 : v)) }
				: view,
		);
		const drift = hullEnvelope(drifting, 'test-turntable.mp4');
		const a = envelopeVolume(drift.envelope, 1, 0);
		const b = envelopeVolume(fit.envelope, 1, 0);
		const frame = { left: -COLUMNS / 2 / CELLS, cell: 1 / CELLS, cols: COLUMNS, rows: CELLS };
		for (let k = 0; k < 8; k++) {
			const turn = (k / 8) * 2 * Math.PI;
			expect(
				iou(envelopeSilhouette(a, turn, frame), envelopeSilhouette(b, turn, frame)),
			).toBeGreaterThan(0.96);
		}
	});
});

describe('the crown base', () => {
	/** Extents of a plant with the given width in plant heights at each row. */
	const extents = (width: (row: number) => number) => {
		const right = new Float64Array(CELLS);
		const left = new Float64Array(CELLS);
		for (let row = 0; row < CELLS; row++) {
			right[row] = width(row) / 2;
			left[row] = width(row) / 2;
		}
		return { right, left };
	};

	test("leaves a trunk's flared foot below a bare stem out of the crown", () => {
		const flared = extents((row) => (row < 4 ? 0.3 : row < 20 ? 0.05 : row < 90 ? 0.8 : 0.1));
		expect(crownBaseRow([flared])).toBe(20);
	});

	test('runs a tuft that is wide from the ground into its crown', () => {
		const tuft = extents((row) => (row < 2 ? 0.25 : row === 2 ? 0.1 : 0.6));
		expect(crownBaseRow([tuft])).toBe(0);
	});
});

describe('the outline of a frame', () => {
	test("drops a thin strip along the plant's foot and keeps its trunk", () => {
		const width = 100;
		const height = 120;
		const mask = new Uint8Array(width * height);
		const set = (x: number, y: number) => {
			mask[y * width + x] = 1;
		};
		for (let y = 10; y < 70; y++) for (let x = 30; x < 70; x++) set(x, y);
		for (let y = 70; y <= 110; y++) for (let x = 48; x < 52; x++) set(x, y);
		// A strip of grass along the foot, reaching out to the left.
		for (let x = 0; x < 52; x++) set(x, 109);
		const flat = { coefficients: [[0], [0], [0]], noise: 1, fit: 1 };
		const plant = { width, height, mask, background: { horizon: 108, sky: flat, plain: true } };
		const kept = dropThinLowRuns(plant, { left: 0, top: 10, right: 69, bottom: 110 });
		expect(kept.mask[109 * width + 10]).toBe(0);
		expect(kept.mask[109 * width + 50]).toBe(1);
		expect(kept.mask[110 * width + 49]).toBe(1);
	});

	test("compares a full turn's last frame with its first, and not a half turn's", () => {
		const grid = outlineAt(0);
		expect(closingOverlap(grid, grid, 360)).toBe(1);
		expect(closingOverlap(grid, grid, 180)).toBeNull();
		expect(closingOverlap(null, grid, 360)).toBeNull();
	});
});

describe('the band of the all-round test', () => {
	const fit = (width: number, height: number) =>
		({ crownBox: { angles: [], boxes: [], spread: { width, height } } }) as unknown as TurnFit;

	test("is the form's band unless the reference's own spread is wider", () => {
		expect(roundBandOf(fit(0.1, 0.05), 0.25)).toBe(0.25);
		expect(roundBandOf(fit(0.381, 0.05), 0.25)).toBe(0.39);
	});
});

/** The reference corpus, which only a maintainer's copy holds. */
const CORPUS =
	process.env.NULL3D_PLANT_REFERENCES ??
	join(REPO_ROOT, '.internal/coordination/tree-corpus/generated');
const OAK = join(CORPUS, 'pedunculate-oak');
const OAK_VIDEO = join(OAK, 'oak-turntable.mp4');

describe.skipIf(!existsSync(OAK_VIDEO))('the pedunculate oak, from the private references', () => {
	test("measures the oak's envelope that the grower's tests hold, from the video it was measured from", () => {
		const fit = fitTurn({ file: 'oak-turntable.mp4', path: OAK_VIDEO, piece: 'whole', arc: 360 });
		const hull = fit.hull;
		expect(hull).not.toBeNull();
		if (!hull || !oakRecord.envelope) return;
		expect(Math.abs(hull.crownBase - 0.115)).toBeLessThanOrEqual(0.011);
		const ours = envelopeVolume(hull.envelope, 1, 0);
		const theirs = envelopeVolume(oakRecord.envelope, 1, 0);
		const frame = { left: -COLUMNS / 2 / CELLS, cell: 1 / CELLS, cols: COLUMNS, rows: CELLS + 4 };
		for (let k = 0; k < 32; k++) {
			const turn = (k / 32) * 2 * Math.PI;
			expect(
				iou(envelopeSilhouette(ours, turn, frame), envelopeSilhouette(theirs, turn, frame)),
			).toBeGreaterThanOrEqual(0.95);
		}
		// The grower's record found its envelope's outlines 0.72 to 0.89 against the views.
		expect(hull.consistency.lowest).toBeGreaterThan(0.7);
		expect(hull.consistency.mean).toBeGreaterThan(0.83);
	}, 180_000);

	test('finds the shipped leaf contour still covers slot 24', () => {
		const set = readReferenceSet(OAK);
		const leaf = checkLeaf('pedunculate-oak', OAK, set.stills);
		expect(leaf.problems).toEqual([]);
		expect(leaf.contour.iou).toBeGreaterThan(0.95);
		expect(leaf.manifest?.current).toBe(true);
		expect(leaf.manifest?.iou).toBeGreaterThan(0.95);
	}, 60_000);
});
