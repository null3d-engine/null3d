import { describe, expect, test } from 'bun:test';
import { projectRow, standCamera } from '../../tests/pages/lib/plant-review.ts';
import {
	alignTurn,
	anchorColumn,
	framingQuery,
	iou,
	NORMAL_HEIGHT,
	NORMAL_WIDTH,
	normalise,
	profileError,
	spread,
} from './compare.ts';
import { deltaE2000 } from './image.ts';
import { boxOf, type PlantMask } from './references.ts';

/** A plant mask of a rectangle crown on a one-pixel trunk, with the background fields filled in. */
function rectangle(
	width: number,
	height: number,
	box: { left: number; top: number; right: number; bottom: number },
): PlantMask {
	const mask = new Uint8Array(width * height);
	for (let y = box.top; y <= box.bottom; y++)
		for (let x = box.left; x <= box.right; x++) mask[y * width + x] = 1;
	const flat = {
		coefficients: [
			[0, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
		],
		noise: 1,
		fit: 1,
	};
	return { width, height, mask, background: { horizon: null, sky: flat, plain: true } };
}

describe('the outline overlap', () => {
	test('is the shared pixels over the pixels of either', () => {
		const a = Uint8Array.from([1, 1, 0, 0]);
		const b = Uint8Array.from([0, 1, 1, 0]);
		expect(iou(a, b)).toBeCloseTo(1 / 3);
		expect(iou(a, a)).toBe(1);
		expect(iou(new Uint8Array(4), new Uint8Array(4))).toBe(0);
	});

	test('ignores framing once both outlines are scaled to the same height on their trunks', () => {
		const small = rectangle(100, 100, { left: 40, top: 30, right: 59, bottom: 69 });
		const large = rectangle(300, 200, { left: 50, top: 20, right: 89, bottom: 99 });
		const normalOf = (plant: PlantMask) => {
			const box = boxOf(plant.mask, plant.width, plant.height) as NonNullable<
				ReturnType<typeof boxOf>
			>;
			return normalise(
				plant,
				box,
				anchorColumn(plant.mask, plant.width, plant.height, box),
				box.bottom,
			);
		};
		const a = normalOf(small);
		const b = normalOf(large);
		expect(a.length).toBe(NORMAL_WIDTH * NORMAL_HEIGHT);
		expect(iou(a, b)).toBeGreaterThan(0.97);
	});
});

describe('the turn alignment', () => {
	/** The overlaps of a reference turn with a render turn that starts `start` frames on. */
	function scores(k: number, n: number, start: number, direction: 1 | -1): number[][] {
		return Array.from({ length: k }, (_, i) =>
			Array.from({ length: n }, (_, j) => {
				const truth = (((start + direction * Math.round((i * n) / k)) % n) + n) % n;
				// The true partner overlaps best; its neighbours a little; the rest poorly.
				const d = Math.min(Math.abs(j - truth), n - Math.abs(j - truth));
				return d === 0 ? 0.8 : d === 1 ? 0.6 : 0.3;
			}),
		);
	}

	test('finds the start frame and the direction of the turn', () => {
		expect(alignTurn(scores(8, 8, 3, 1))).toMatchObject({ start: 3, direction: 1 });
		expect(alignTurn(scores(8, 8, 5, -1))).toMatchObject({ start: 5, direction: -1 });
		const result = alignTurn(scores(8, 16, 6, -1));
		expect(result).toMatchObject({ start: 6, direction: -1 });
		expect(result.meanIou).toBeCloseTo(0.8);
		expect(result.pairs.slice(0, 3)).toEqual([6, 4, 2]);
	});
});

describe('the measures', () => {
	test('take the mean width difference and the spread round a turn', () => {
		expect(profileError([0.5, 1, 0.2], [0.4, 1.2, 0.2])).toBeCloseTo(0.1);
		expect(spread([90, 100, 110])).toBeCloseTo(0.2);
		expect(spread([0, 0])).toBe(0);
	});

	test('give a perceptual colour difference that matches the published CIEDE2000 pairs', () => {
		// Pairs from Sharma, Wu and Dalal's table of CIEDE2000 test data.
		expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
		expect(deltaE2000([50, -1.3802, -84.2814], [50, 0, -82.7485])).toBeCloseTo(1.0, 3);
		expect(deltaE2000([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(
			1.2644,
			3,
		);
	});
});

describe('the framing a render takes from a reference', () => {
	test('places the plant between its top and base rows, and keeps the camera at eye height when the base is cut off', () => {
		const shared = {
			horizon: 0.76,
			top: 0.18,
			targetX: 0.49,
			aspect: 16 / 9,
			sky: '#d9dad5',
			frames: 8,
			notes: [],
		};
		expect(framingQuery({ ...shared, base: 0.79 })).toMatchObject({
			fill: 0.79 - 0.18,
			targetY: (0.79 + 0.18) / 2,
			horizon: 0.76,
		});
		expect(framingQuery(shared)).toMatchObject({ top: 0.18, eye: 1.6 });
	});
});

describe("the page's stand camera", () => {
	test('puts the horizon, the top and the base on the rows asked for', () => {
		const fov = 30;
		const camera = standCamera(
			{ fov, aspect: 16 / 9, horizon: 0.7, top: 0.15, base: 0.8, targetX: 0.5 },
			12,
		);
		expect(projectRow(camera, 12, fov)).toBeCloseTo(0.15, 6);
		expect(projectRow(camera, 0, fov)).toBeCloseTo(0.8, 6);
		// The horizon lies at an infinite distance, level with the camera.
		expect(projectRow({ ...camera, distance: 1e9 }, camera.height, fov)).toBeCloseTo(0.7, 6);
		expect(camera.height).toBeGreaterThan(0);
	});

	test('stands at eye height and fits the top when the base is out of frame', () => {
		const fov = 30;
		const camera = standCamera(
			{ fov, aspect: 16 / 9, horizon: 1, top: 0.07, eye: 1.6, targetX: 0.4 },
			17,
		);
		expect(camera.height).toBe(1.6);
		expect(projectRow(camera, 17, fov)).toBeCloseTo(0.07, 6);
		expect(camera.yaw).toBeLessThan(0);
	});

	test('says what it gave up when the base would put the camera under the ground', () => {
		const camera = standCamera(
			{ fov: 30, aspect: 1, horizon: 0.9, top: 0.1, base: 0.5, targetX: 0.5 },
			10,
		);
		expect(camera.warning).toBeDefined();
		expect(camera.height).toBeGreaterThan(0);
	});
});
