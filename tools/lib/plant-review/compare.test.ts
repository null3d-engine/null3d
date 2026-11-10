import { describe, expect, test } from 'bun:test';
import {
	type CutCamera,
	cutCamera,
	leafFrame,
	projectRow,
	standCamera,
} from '../../../tests/pages/lib/plant-review/framing.ts';
import {
	alignTurn,
	anchorColumn,
	cameraWidthShare,
	crownBoxSpread,
	edgeDifference,
	edgeProfile,
	fittedMaskClause,
	framingQuery,
	iou,
	motionProfile,
	NORMAL_HEIGHT,
	NORMAL_WIDTH,
	normalise,
	patchDifference,
	patchLab,
	profileError,
	rubricBand,
	rubricFrames,
	spread,
} from './compare.ts';
import { blank, deltaE2000, labImage } from './image.ts';
import { boxOf, type PlantMask, type PlantMeasures, pieceCount } from './references.ts';

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

describe('the edge directions', () => {
	/** A picture of equal dark and light bands, running one way. */
	function bands(horizontal: boolean) {
		const width = 64;
		const height = 64;
		const image = blank(width, height, [0, 0, 0]);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const dark = (horizontal ? Math.floor(y / 4) : Math.floor(x / 4)) % 2 === 0;
				const value = dark ? 255 : 0;
				const at = (y * width + x) * 4;
				image.data[at] = value;
				image.data[at + 1] = value;
				image.data[at + 2] = value;
				image.data[at + 3] = 255;
			}
		return image;
	}

	test('separate bands that run one way from bands that run the other', () => {
		const across = edgeProfile(bands(true));
		const down = edgeProfile(bands(false));
		expect(edgeDifference(across, across)).toBe(0);
		expect(edgeDifference(across, down)).toBeGreaterThan(0.9);
	});

	test('share the strength between directions as a picture mixes them', () => {
		const across = edgeProfile(bands(true));
		let total = 0;
		for (const share of across) total += share;
		expect(total).toBeCloseTo(1, 5);
	});
});

describe('the trunk column', () => {
	/** A trunk with a crown, and a low limb that sweeps out and touches the trunk near the foot. */
	function limbNearTheFoot(): PlantMask {
		const width = 200;
		const height = 200;
		const mask = new Uint8Array(width * height);
		const set = (x: number, y: number) => {
			mask[y * width + x] = 1;
		};
		for (let y = 120; y < 196; y++) for (let x = 95; x <= 105; x++) set(x, y);
		for (let y = 20; y < 120; y++) for (let x = 20; x <= 180; x++) set(x, y);
		for (let y = 190; y < 196; y++) for (let x = 20; x < 95; x++) set(x, y);
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

	test('is the trunk even where a low limb touches it near the foot', () => {
		const plant = limbNearTheFoot();
		const box = boxOf(plant.mask, plant.width, plant.height);
		expect(box).toBeDefined();
		const anchor = anchorColumn(
			plant.mask,
			plant.width,
			plant.height,
			box as NonNullable<typeof box>,
		);
		expect(anchor).toBeGreaterThan(94);
		expect(anchor).toBeLessThan(106);
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
		expect(result.coarseIou).toBeCloseTo(0.8);
		expect(result.pairs.slice(0, 3)).toEqual([6, 4, 2]);
	});

	test('pairs a half turn with the renders at its own angles', () => {
		// Twelve frames over 180 degrees, against renders every 7.5 degrees round a full circle: each
		// frame turns two render steps, and the video starts at the render of 90 degrees.
		const k = 12;
		const n = 48;
		const truth = (i: number) => (12 - 2 * i + n) % n;
		const table = Array.from({ length: k }, (_, i) =>
			Array.from({ length: n }, (_, j) => (j === truth(i) ? 0.9 : 0.2)),
		);
		const result = alignTurn(table, 2);
		expect(result).toMatchObject({ start: 12, direction: -1 });
		expect(result.pairs).toEqual(Array.from({ length: k }, (_, i) => truth(i)));
	});
});

describe('the wind', () => {
	/** A plant mask of a block that a frame's offset moves sideways in its top half only. */
	function swaying(offset: number): PlantMask {
		const plant = rectangle(40, 40, { left: 18, top: 20, right: 21, bottom: 39 });
		for (let y = 0; y < 20; y++)
			for (let x = 10 + offset; x < 30 + offset; x++) plant.mask[y * 40 + x] = 1;
		return plant;
	}

	test('measures motion where the outline moves, and none where it holds', () => {
		const profile = motionProfile([swaying(0), swaying(2), swaying(0)]);
		expect(profile).toHaveLength(6);
		expect(profile[0]).toBe(0);
		expect(profile[5] as number).toBeGreaterThan(0.1);
		expect(motionProfile([swaying(0), swaying(0)]).every((v) => v === 0)).toBe(true);
	});
});

describe('the measures', () => {
	test('take the mean width difference and the spread round a turn', () => {
		expect(profileError([0.5, 1, 0.2], [0.4, 1.2, 0.2])).toBeCloseTo(0.1);
		expect(spread([90, 100, 110])).toBeCloseTo(0.2);
		expect(spread([0, 0])).toBe(0);
	});

	test("take the rubric's angles that a turn reaches, with the frame nearest each", () => {
		expect(rubricFrames(360, 193)).toEqual({
			angles: [0, 45, 90, 135, 180, 225, 270, 315],
			frames: [0, 24, 48, 72, 97, 121, 145, 169],
		});
		expect(rubricFrames(180, 97).angles).toEqual([0, 45, 90, 135]);
	});

	test("spread the crown box's width and height over the frames that show a plant", () => {
		const box = { left: 0, top: 0, right: 1, bottom: 1 };
		const at = (width: number, height: number) =>
			({ box, crownBox: { width, height } }) as unknown as PlantMeasures;
		expect(crownBoxSpread([at(90, 50), at(110, 50), { box: null } as PlantMeasures])).toEqual({
			width: 0.2,
			height: 0,
		});
	});

	test('take the band of a conifer or of any other form', () => {
		expect(rubricBand('norway-spruce', 'norway-spruce')).toBe(0.15);
		expect(rubricBand('pedunculate-oak', 'pedunculate-oak')).toBe(0.25);
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
			widthShare: 0.9,
			aspect: 16 / 9,
			sky: '#d9dad5',
			frames: 8,
			notes: [],
		};
		expect(framingQuery({ ...shared, base: 0.79 })).toMatchObject({
			fill: 0.79 - 0.18,
			targetY: (0.79 + 0.18) / 2,
			horizon: 0.76,
			widthShare: 0.9,
		});
		expect(framingQuery(shared)).toMatchObject({ top: 0.18, eye: 1.6 });
	});

	test("reads a clipped plant's width from the camera stand, so it responds and may exceed the frame", () => {
		const stand = { distance: 1.862, fov: 38 };
		const share = cameraWidthShare(2.416, stand, 768 / 516) as number;
		expect(share).toBeCloseTo(1.2658, 3);
		expect(cameraWidthShare(2.416, { ...stand, distance: 3.724 }, 768 / 516) as number).toBeCloseTo(
			share / 2,
			3,
		);
		expect(cameraWidthShare(0, stand, 1.5)).toBeNull();
		expect(cameraWidthShare(2, { distance: 0, fov: 38 }, 1.5)).toBeNull();
		expect(cameraWidthShare(2, { distance: 1, fov: 0 }, 1.5)).toBeNull();
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

	test('stands a low camera for a short plant photographed from near the ground', () => {
		const fov = 38;
		const camera = standCamera(
			{ fov, aspect: 1024 / 688, horizon: 0.8116, top: 0.193, base: 0.8814, targetX: 0.48 },
			1.52,
		);
		expect(camera.warning).toBeUndefined();
		expect(camera.height).toBeGreaterThan(0);
		expect(projectRow(camera, 1.52, fov)).toBeCloseTo(0.193, 3);
		expect(projectRow(camera, 0, fov)).toBeCloseTo(0.8814, 3);
	});

	test("solves a hand-high plant's base row rather than standing back to eye height", () => {
		const fov = 38;
		const camera = standCamera(
			{ fov, aspect: 1.5, horizon: 0.62, top: 0.5, base: 0.914, targetX: 0.5 },
			0.56,
		);
		// The camera clears the ground by the floor and the foot lands on the row the framing asks
		// for, so the plant does not run off the frame's foot.
		expect(camera.height).toBeGreaterThan(0);
		expect(camera.warning).toBeUndefined();
		expect(projectRow(camera, 0, fov)).toBeCloseTo(0.914, 5);
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

describe("the page's camera for a cut piece", () => {
	// A stalk from its cut up into a spray that reaches nearer the camera on one side than the other,
	// seen level from +Z, so the frame's up is +Y and its right is +X.
	const piece = [
		0, 0, 0, 0, 0.3, 0, -0.2, 0.5, 0.15, 0.25, 0.6, -0.2, 0.05, 0.8, 0.05, -0.1, 0.7, -0.3,
	];
	const centre = [0.025, 0.4, -0.075];
	const fov = 40;
	const aspect = 1.8;
	const half = Math.tan((fov * Math.PI) / 360);
	/** The highest and lowest rows the points land on, and the column share nearest a side. */
	const framed = (points: readonly number[], camera: CutCamera) => {
		let top = Number.POSITIVE_INFINITY;
		let base = Number.NEGATIVE_INFINITY;
		let side = Number.POSITIVE_INFINITY;
		for (let i = 0; i < points.length; i += 3) {
			const depth = (centre[2] as number) + camera.distance - (points[i + 2] as number);
			const v = ((points[i + 1] as number) - (centre[1] as number) - camera.lift) / (depth * half);
			const u = ((points[i] as number) - (centre[0] as number)) / (depth * half * aspect);
			top = Math.min(top, (1 - v) / 2);
			base = Math.max(base, (1 - v) / 2);
			side = Math.min(side, (1 - Math.abs(u)) / 2);
		}
		return { top, base, side };
	};
	const look = [
		[0, 0, -1],
		[1, 0, 0],
		[0, 1, 0],
	] as const;

	test('puts the highest point on the top row and the lowest on the base row', () => {
		const rows = { top: 0.03, base: 1 };
		const camera = cutCamera(piece, centre, ...look, fov, aspect, rows, 0.08);
		const seen = framed(piece, camera);
		expect(seen.top).toBeCloseTo(0.03, 6);
		expect(seen.base).toBeCloseTo(1, 6);
		expect(seen.side).toBeGreaterThan(0.08);
		const inside = cutCamera(piece, centre, ...look, fov, aspect, { top: 0.05, base: 0.95 }, 0.08);
		expect(framed(piece, inside).top).toBeCloseTo(0.05, 6);
		expect(framed(piece, inside).base).toBeCloseTo(0.95, 6);
	});

	test('steps back for a piece too wide for its rows, its foot still on the base row', () => {
		const wide = [...piece, 1.5, 0.4, 0];
		const camera = cutCamera(wide, centre, ...look, fov, aspect, { top: 0.03, base: 1 }, 0.08);
		const seen = framed(wide, camera);
		expect(seen.base).toBeCloseTo(1, 6);
		expect(seen.top).toBeGreaterThan(0.03);
		expect(seen.side).toBeCloseTo(0.08, 6);
	});
});

describe('the patch colour of a texture source', () => {
	/** A square of vertical bars: `light` pixels of 200, then `dark` of 50, every `period`. */
	function bars(size: number, period: number, light: number, phase: number) {
		const data = new Uint8Array(size * size * 4);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const value = (x + phase) % period < light ? 200 : 50;
				const at = (y * size + x) * 4;
				data[at] = value;
				data[at + 1] = value;
				data[at + 2] = value;
				data[at + 3] = 255;
			}
		return { width: size, height: size, data };
	}

	/** The old single window: the middle third of the picture each way. */
	function middleThird(image: ReturnType<typeof bars>): number {
		const lab = labImage(image);
		let sum = 0;
		let n = 0;
		for (let y = Math.floor(image.height / 3); y < Math.floor((image.height * 2) / 3); y++)
			for (let x = Math.floor(image.width / 3); x < Math.floor((image.width * 2) / 3); x++) {
				sum += lab[(y * image.width + x) * 3] as number;
				n++;
			}
		return sum / Math.max(1, n);
	}

	test('moves little when a tiled picture shifts phase, where one window moves much', () => {
		// Each patch spans exactly one period, so the patches sample three phases and their mean
		// does not move, while one middle-third window does.
		const first = bars(400, 80, 48, 0);
		const shifted = bars(400, 80, 48, 20);
		const a = patchLab(first)[0] as number;
		const b = patchLab(shifted)[0] as number;
		expect(Math.abs(a - b)).toBeLessThan(0.1);
		expect(Math.abs(middleThird(first) - middleThird(shifted))).toBeGreaterThan(5);
	});

	test('leaves the outer tenth of the picture out of the sample', () => {
		const image = bars(400, 1000, 1000, 0);
		for (let y = 0; y < image.height; y++)
			for (let x = 0; x < image.width; x++) {
				if (x >= 40 && x < 360 && y >= 40 && y < 360) continue;
				const at = (y * image.width + x) * 4;
				for (let c = 0; c < 3; c++) image.data[at + c] = 50;
			}
		expect(patchLab(image)[0] as number).toBeCloseTo(80.6, 0);
	});

	test('drops the backdrop from the sample when a slot asks for the plant alone', () => {
		// A pale stem down the picture's middle on a dark backdrop, so the plain average sits
		// between the two and the masked one reads the stem.
		const size = 1000;
		const data = new Uint8Array(size * size * 4);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const stem = x >= 300 && x < 700;
				const value = stem ? 200 : 50;
				const at = (y * size + x) * 4;
				data[at] = value;
				data[at + 1] = value;
				data[at + 2] = value;
				data[at + 3] = 255;
			}
		const image = { width: size, height: size, data };
		const plain = patchLab(image)[0] as number;
		const onPlant = patchLab(image, true)[0] as number;
		// The stem's own lightness is about 80 in CIELAB and the backdrop's about 20, so a plain
		// average of nine patches lands near 40 and a masked one on the stem's own figure.
		expect(plain).toBeLessThan(50);
		expect(onPlant).toBeGreaterThan(75);
	});

	test('compares a texture source on its material when the mask is asked for', () => {
		// One bark down the middle of two pictures cut out on opposite colours: the plain means move
		// apart with the backdrops while the masked ones read the same bark and agree.
		const barkOn = (backdrop: number) => {
			const size = 1000;
			const data = new Uint8Array(size * size * 4);
			for (let y = 0; y < size; y++)
				for (let x = 0; x < size; x++) {
					const value = x >= 300 && x < 700 ? 100 : backdrop;
					const at = (y * size + x) * 4;
					data[at] = value;
					data[at + 1] = value;
					data[at + 2] = value;
					data[at + 3] = 255;
				}
			return { width: size, height: size, data };
		};
		const reference = barkOn(255);
		const render = barkOn(0);
		expect(patchDifference(reference, render, true)).toBeLessThan(0.5);
		expect(patchDifference(reference, render, false)).toBeGreaterThan(10);
	});
});

describe('the pieces a plant is drawn as', () => {
	/** A mask with the given squares filled in. */
	function maskOf(width: number, height: number, squares: readonly number[][]): Uint8Array {
		const mask = new Uint8Array(width * height);
		for (const [x0, y0, x1, y1] of squares as readonly [number, number, number, number][])
			for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = 1;
		return mask;
	}

	test('counts a plant that hangs together as one piece', () => {
		expect(pieceCount(maskOf(20, 20, [[2, 2, 18, 18]]), 20, 20, 24)).toBe(1);
	});

	test('counts a part that meets nothing as its own piece', () => {
		expect(
			pieceCount(
				maskOf(20, 20, [
					[8, 8, 18, 18],
					[0, 0, 5, 5],
				]),
				20,
				20,
				24,
			),
		).toBe(2);
	});

	test('counts two runs one background pixel apart as one piece', () => {
		// The hairline case: a leaf group whose supporting twig is thinner than a pixel, so the one
		// pixel that would join it fell to the outline's cutoff.
		expect(
			pieceCount(
				maskOf(20, 20, [
					[0, 0, 8, 8],
					[9, 0, 18, 8],
				]),
				20,
				20,
				24,
			),
		).toBe(1);
	});

	test('counts two runs two background pixels apart as two pieces', () => {
		// A genuine separation: the same two runs with an empty column between them.
		expect(
			pieceCount(
				maskOf(20, 20, [
					[0, 0, 8, 8],
					[10, 0, 18, 8],
				]),
				20,
				20,
				24,
			),
		).toBe(2);
	});

	test('ignores a speck too small to be a part of the plant', () => {
		expect(
			pieceCount(
				maskOf(20, 20, [
					[2, 2, 18, 18],
					[0, 0, 1, 1],
				]),
				20,
				20,
				24,
			),
		).toBe(1);
	});
});

describe('a cut piece framed in leaf lengths', () => {
	test('gives two photographs of different leaf sizes two different frames', () => {
		const young = leafFrame(7.4, 0.1, 0, 1, 20);
		const mature = leafFrame(7.4, 1.0, 0, 1, 20);
		expect(young.tall).toBeCloseTo(0.74, 6);
		expect(mature.tall).toBeCloseTo(7.4, 6);
		expect(young.distance).not.toBeCloseTo(mature.distance, 2);
	});

	test('frames as many leaves of the named length as the photograph counts', () => {
		expect(leafFrame(4.5, 0.1, 0, 1, 20).tall).toBeCloseTo(0.45, 6);
		expect(leafFrame(7.4, 0.1, 0, 1, 20).distance).not.toBeCloseTo(
			leafFrame(4.5, 0.1, 0, 1, 20).distance,
			2,
		);
	});

	test('lengthens the run only when the roll lays the piece across the frame', () => {
		expect(leafFrame(2, 0.5, 0, 2, 20).run).toBeCloseTo(1, 6);
		expect(leafFrame(2, 0.5, 90, 2, 20).run).toBeCloseTo(2, 6);
	});
});

describe('a fitted-background outline', () => {
	test('reports the sky fit and residual beside the figure', () => {
		expect(
			fittedMaskClause({
				fittedMask: { kind: 'sky', skyFit: 0.9999, skyNoise: 17.1 },
			}),
		).toContain('fit 0.9999, residual 17.1');
		expect(fittedMaskClause({})).toBe('');
	});

	test('reports the ground fit, residual and horizon share for a soil', () => {
		const clause = fittedMaskClause({
			fittedMask: {
				kind: 'ground',
				skyFit: 1,
				skyNoise: 24.19,
				groundFit: 1,
				groundNoise: 18.55,
				horizonShare: 0.291,
				plantToGround: 14.22,
			},
		});
		expect(clause).toContain('fitted ground at horizon share 0.291, ground region 0.709');
		expect(clause).toContain("the plant's median colour sits 14.2 CIEDE2000 steps from the ground");
		expect(clause).toContain('ground fit 1.0000, residual 18.6');
		expect(clause).toContain('sky fit 1.0000, residual 24.2');
		expect(clause).toContain('the ground region holds 0.709 of the frame');
		const meadow = fittedMaskClause({
			fittedMask: {
				kind: 'ground',
				skyFit: 1,
				skyNoise: 26.41,
				groundFit: 1,
				groundNoise: 19.9,
				horizonShare: 0.931,
			},
		});
		expect(meadow).toContain('ground region 0.069');
		expect(meadow).toContain('the ground region holds 0.069 of the frame');
		const band = fittedMaskClause({
			fittedMask: {
				kind: 'ground',
				skyFit: 1,
				skyNoise: 12,
				groundFit: 1,
				groundNoise: 10,
				horizonShare: 0.7,
			},
		});
		expect(band).not.toContain('outside a soil band');
	});
});
