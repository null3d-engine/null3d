import { describe, expect, test } from 'bun:test';
import { blank, type Rgba } from './image.ts';
import { type Box, boxOf, followStem, plantMask } from './references.ts';

const WIDTH = 400;
const HEIGHT = 400;

/** A box of a mask's plant pixels, which the scenes here always hold. */
function box(mask: Uint8Array): Box {
	return boxOf(mask, WIDTH, HEIGHT) as Box;
}

/**
 * A picture's colours and its outline as the horizon leaves it: pale sky above the horizon,
 * mottled ground below, a round crown and a dark stem. The outline holds the stem above the
 * horizon only; the colours hold it down to `stemBottom`, a set width wider at each row below
 * `flareFrom`.
 */
function scene(
	stemBottom: number,
	flareFrom = HEIGHT,
): { readonly lab: Float32Array; readonly mask: Uint8Array } {
	const lab = new Float32Array(WIDTH * HEIGHT * 3);
	const mask = new Uint8Array(WIDTH * HEIGHT);
	for (let y = 0; y < HEIGHT; y++) {
		const wider = Math.max(0, y - flareFrom);
		for (let x = 0; x < WIDTH; x++) {
			const at = (y * WIDTH + x) * 3;
			const stem = x >= 195 - wider && x <= 204 + wider && y >= 100 && y <= stemBottom;
			// The ground's lightness steps from pixel to pixel, as a meadow's does.
			lab[at] = stem ? 35 : y < 300 ? 80 : 55 + (((x * 7 + y * 13) % 5) - 2);
			lab[at + 1] = stem ? 6 : y < 300 ? -2 : -8;
			lab[at + 2] = stem ? 14 : y < 300 ? -12 : 24;
			if (stem && y < 300) mask[y * WIDTH + x] = 1;
			if ((x - 200) ** 2 + (y - 90) ** 2 <= 60 ** 2) mask[y * WIDTH + x] = 1;
		}
	}
	return { lab, mask };
}

describe('a stem cut at the horizon', () => {
	test('is followed down to the row where it ends', () => {
		const { lab, mask } = scene(340);
		expect(box(mask).bottom).toBe(299);
		const stem = followStem(lab, WIDTH, HEIGHT, mask, box(mask), 200);
		if (stem.kind !== 'stem') throw new Error(stem.kind);
		expect(stem.foot).toBe(340);
		expect(stem.runs).toHaveLength(41);
		// A pixel is read with its neighbours, so a run's ends stand within a pixel of the stem's.
		for (const [from, to] of stem.runs) {
			expect(Math.abs(from - 195)).toBeLessThanOrEqual(1);
			expect(Math.abs(to - 204)).toBeLessThanOrEqual(1);
		}
	});

	test('is followed through a root flare, and its runs widen with it', () => {
		const { lab, mask } = scene(345, 335);
		const stem = followStem(lab, WIDTH, HEIGHT, mask, box(mask), 200);
		if (stem.kind !== 'stem') throw new Error(stem.kind);
		expect(Math.abs(stem.foot - 345)).toBeLessThanOrEqual(1);
		const last = stem.runs.at(-1) as readonly [number, number];
		expect(last[1] - last[0] + 1).toBeGreaterThan(16);
	});

	test('does not run on into the ground where the stem ends', () => {
		// The stem ends 12 rows below the horizon, and 60 rows of ground lie below it.
		const { lab, mask } = scene(311);
		const stem = followStem(lab, WIDTH, HEIGHT, mask, box(mask), 200);
		if (stem.kind !== 'stem') throw new Error(stem.kind);
		expect(stem.foot).toBe(311);
	});

	test('gives no stem where the plant stands on the horizon', () => {
		const { lab, mask } = scene(299);
		expect(followStem(lab, WIDTH, HEIGHT, mask, box(mask), 200)).toEqual({ kind: 'none' });
	});

	test('calls a wide last row a mass', () => {
		const { lab } = scene(299);
		const mask = new Uint8Array(WIDTH * HEIGHT);
		for (let y = 200; y <= 299; y++) mask.fill(1, y * WIDTH + 100, y * WIDTH + 300);
		expect(followStem(lab, WIDTH, HEIGHT, mask, box(mask), 200)).toEqual({ kind: 'mass' });
	});
});

describe("a photograph's outline", () => {
	/** A tree on a mottled ground whose trunk stands on the ground below the horizon line. */
	function photograph(footRow: number): Rgba {
		const image = blank(640, 430, [150, 190, 235]);
		const put = (x: number, y: number, colour: readonly number[]): void => {
			for (let c = 0; c < 3; c++) image.data[(y * 640 + x) * 4 + c] = colour[c] as number;
		};
		for (let y = 320; y < 430; y++)
			for (let x = 0; x < 640; x++) {
				const tuft = (Math.floor(x / 3) * 7 + Math.floor(y / 3) * 13) % 3;
				put(x, y, tuft === 0 ? [120, 105, 70] : tuft === 1 ? [95, 100, 60] : [140, 120, 85]);
			}
		for (let y = 50; y <= footRow; y++) for (let x = 314; x < 326; x++) put(x, y, [70, 62, 58]);
		for (let y = 30; y <= 210; y++)
			for (let x = 200; x < 440; x++)
				if (((x - 320) / 120) ** 2 + ((y - 120) / 90) ** 2 <= 1) put(x, y, [40, 110, 45]);
		return image;
	}

	test('runs to the foot, and says where it ended at the horizon', () => {
		const plant = plantMask(photograph(350));
		const found = boxOf(plant.mask, plant.width, plant.height) as Box;
		expect(Math.abs(found.bottom - 350)).toBeLessThanOrEqual(2);
		expect(Math.abs((plant.footFollowedFrom as number) - 319)).toBeLessThanOrEqual(2);
	});

	test('names no followed row where the plant stands on the horizon', () => {
		const plant = plantMask(photograph(319));
		const found = boxOf(plant.mask, plant.width, plant.height) as Box;
		expect(Math.abs(found.bottom - 319)).toBeLessThanOrEqual(2);
		expect(plant.footFollowedFrom).toBeUndefined();
	});
});
