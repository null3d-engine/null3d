import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { envelopeSilhouette, envelopeVolume } from '../../packages/vegetation/src/grow/envelope.ts';
import { oakRecord } from '../../packages/vegetation/src/grow/oak.fixture.ts';
import { scaledBudget } from '../../tests/lib/run-budget.ts';
import { iou } from '../lib/plant-review/compare.ts';
import { probeVideo, readImage, videoFrames } from '../lib/plant-review/image.ts';
import { readReferenceSet, WORK_WIDTH } from '../lib/plant-review/references.ts';
import { REFERENCES } from '../lib/plant-review/store.ts';
import { AZIMUTHS, crownBaseRow, type HullView, hullEnvelope, nearSilhouette } from './envelope.ts';
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

/**
 * A crown heavier on one side: an egg whose plan is a disc of half a plant height set toward +Z of
 * the axis by an eighth of a plant height.
 */
function heavyRadius(t: number, phi: number): number {
	if (t < 0.3 || t > 1) return 0;
	const s = (t - 0.3) / 0.7;
	const profile = Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2));
	const offset = 0.125 * profile;
	const disc = 0.5 * profile;
	return offset * Math.sin(phi) + Math.sqrt(Math.max(0, disc ** 2 - (offset * Math.cos(phi)) ** 2));
}

/**
 * The outline of the heavy crown seen at a turn by a camera at a distance from its axis, in plant
 * heights: each point drawn larger by the distance over the distance less its reach toward the
 * camera.
 */
function outlineThrough(turn: number, distance: number): Uint8Array {
	const grid = new Uint8Array(CELLS * COLUMNS);
	for (let row = 0; row < CELLS; row++) {
		const t = (row + 0.5) / CELLS;
		let right = 0.02;
		let left = 0.02;
		for (let k = 0; k < 720; k++) {
			const phi = (k / 720) * 2 * Math.PI;
			const r = heavyRadius(t, phi);
			const x = (r * Math.cos(phi + turn) * distance) / (distance - r * Math.sin(phi + turn));
			right = Math.max(right, x);
			left = Math.max(left, -x);
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

	test('places a still at the turn the review draws it at', () => {
		// The still is wider than the video from its side; it is drawn at the review's turn of 90
		// degrees, so its right half-width bounds the envelope's right side at that turn.
		const stillGrid = new Uint8Array(CELLS * COLUMNS);
		for (let row = 0; row < CELLS; row++)
			for (let col = 0; col < COLUMNS; col++)
				if (Math.abs(columnX(col)) <= 0.45) stillGrid[row * COLUMNS + col] = 1;
		const still: HullView = {
			frame: -1,
			// The hull mirrors every turn when the video turns backwards, so the input is the
			// review's turn negated; after mirroring it bounds the side the review draws.
			turn: -Math.PI / 2,
			grid: stillGrid,
			file: '02-whole-profile.png',
			stillTurn: 90,
		};
		const withStill = hullEnvelope([...views(32), still], 'test-turntable.mp4', 2, -1);
		expect(withStill.envelope.source.stills).toEqual([{ file: '02-whole-profile.png', turn: 90 }]);
		const volume = envelopeVolume(withStill.envelope, 1, 0);
		// A camera at turn 90 sees the still's right half-width at azimuth 270 degrees.
		expect(volume.radius(0.65, -Math.PI / 2)).toBeGreaterThan(0.37);
	});

	test('fits a crown heavier on one side, seen by a near camera', () => {
		// Two plant heights out, the camera draws the near side larger, so the crown looks wider when
		// its heavy side faces the camera than when it faces away.
		const distance = 2;
		const near = Array.from({ length: 32 }, (_, k) => {
			const turn = (k / 32) * 2 * Math.PI;
			return { frame: k, turn, grid: outlineThrough(turn, distance) };
		});
		const fit = hullEnvelope(near, 'test-turntable.mp4', distance);
		const fitted = envelopeVolume(fit.envelope, 1, 0);
		let worst = 0;
		for (const t of [0.5, 0.65, 0.8])
			for (let a = 0; a < AZIMUTHS; a++) {
				const phi = (a / AZIMUTHS) * 2 * Math.PI;
				worst = Math.max(worst, Math.abs(fitted.radius(t, phi) - heavyRadius(t, phi)));
			}
		expect(worst).toBeLessThan(0.04);
		// Drawn through the same camera, the fit is wider from its heavy side as the views are.
		const frame = { left: -COLUMNS / 2 / CELLS, cell: 1 / CELLS, cols: COLUMNS, rows: CELLS };
		const span = (grid: Uint8Array) => {
			let most = 0;
			for (let row = 0; row < CELLS; row++) {
				let low = COLUMNS;
				let high = -1;
				for (let col = 0; col < COLUMNS; col++)
					if (grid[row * COLUMNS + col]) {
						low = Math.min(low, col);
						high = Math.max(high, col);
					}
				if (high >= low) most = Math.max(most, high - low + 1);
			}
			return most;
		};
		for (const turn of [0, Math.PI]) {
			const drawn = span(nearSilhouette(fitted, turn, frame, distance));
			expect(Math.abs(drawn / span(outlineThrough(turn, distance)) - 1)).toBeLessThan(0.04);
		}
		expect(
			span(outlineThrough(0, distance)) / span(outlineThrough(Math.PI, distance)),
		).toBeGreaterThan(1.1);
		expect(fit.consistency.lowest).toBeGreaterThan(0.9);
		expect(fit.direction).toBe(1);
		// A video that turns the other way: the hull finds the way from the near side's looming,
		// and draws each view's width again at its turn the other way round.
		const reversed = near.map((view) => ({ ...view, turn: -view.turn }));
		const back = hullEnvelope(reversed, 'test-turntable.mp4', distance);
		expect(back.direction).toBe(-1);
		const backVolume = envelopeVolume(back.envelope, 1, 0);
		for (const view of [reversed[0], reversed[16]] as HullView[])
			expect(
				Math.abs(
					span(nearSilhouette(backVolume, -view.turn, frame, distance)) / span(view.grid) - 1,
				),
			).toBeLessThan(0.04);
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

	test('runs a narrow column down to its own foot', () => {
		// A cypress is under a fifth of its height across at every row, so a fixed crown width
		// would read its whole slackened lower quarter as bare stem.
		const column = extents((row) => (row < 2 ? 0.04 : row < 6 ? 0.12 : 0.16));
		expect(crownBaseRow([column])).toBe(2);
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

/** Milliseconds to measure a turning video, and to check a leaf, on an idle machine. */
const VIDEO_MS = scaledBudget(180_000);
const LEAF_MS = scaledBudget(60_000);

/** The reference corpus, which only a maintainer's copy holds. */
const OAK = join(REFERENCES, 'pedunculate-oak');
const OAK_VIDEO = join(OAK, 'oak-turntable.mp4');

describe.skipIf(!existsSync(OAK_VIDEO))('the pedunculate oak, from the private references', () => {
	test(
		"measures the oak's envelope that the grower's tests hold, from the references it was measured from",
		() => {
			const video = {
				file: 'oak-turntable.mp4',
				path: OAK_VIDEO,
				piece: 'whole',
				arc: 360,
			} as const;
			const frames = videoFrames(video.path, probeVideo(video.path), WORK_WIDTH);
			// The record's hull takes the whole-plant stills too, which bound the crown's broad sides.
			const set = readReferenceSet(OAK);
			const stills = set.stills
				.filter(
					(still) =>
						still.framed &&
						still.number <= 18 &&
						(still.view === 'whole' || still.view === 'silhouette'),
				)
				.map((still) => ({
					file: still.file,
					image: readImage(join(OAK, still.file)),
					turn: still.turn ?? 0,
				}));
			const fit = fitTurn(video, frames, stills);
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
			// The 5 November turntable (SHA-256 43e6ca23) and the whole-plant stills overlap the hull
			// at 0.728 to 0.866, mean 0.795. The floors guard the fit against a regression; they are
			// not a claim about the recording's own symmetry.
			expect(hull.consistency.lowest).toBeGreaterThan(0.7);
			expect(hull.consistency.mean).toBeGreaterThan(0.78);
		},
		VIDEO_MS,
	);

	test(
		'finds the shipped leaf contour still covers slot 24',
		() => {
			const set = readReferenceSet(OAK);
			const leaf = checkLeaf('pedunculate-oak', OAK, set.stills);
			expect(leaf.problems).toEqual([]);
			expect(leaf.contour.iou).toBeGreaterThan(0.95);
			expect(leaf.manifest?.current).toBe(true);
			expect(leaf.manifest?.iou).toBeGreaterThan(0.95);
		},
		LEAF_MS,
	);
});
