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
	blankFrame,
	cameraWidthShare,
	colourRuleGap,
	cropFault,
	crownBoxSpread,
	edgeDifference,
	edgeProfile,
	emptySubject,
	engineLevelAt,
	fittedMaskClause,
	frameFiguresHold,
	frameScale,
	frameTilt,
	framingFault,
	framingQuery,
	hasSeparableOutline,
	horizonTilt,
	iou,
	levelName,
	MASK_GATE_NATURAL,
	MASK_GATE_PLAIN,
	maskCheckOf,
	motionProfile,
	NORMAL_HEIGHT,
	NORMAL_WIDTH,
	normalise,
	patchDifference,
	patchLab,
	patchWoodLab,
	plainTurnOf,
	plantRows,
	profileError,
	rubricBand,
	rubricFrames,
	sameDrawing,
	sheathDifference,
	spread,
} from './compare.ts';
import { blank, deltaE2000, labImage } from './image.ts';
import { boxOf, matteMask, type PlantMask, type PlantMeasures, pieceCount } from './references.ts';
import { PART } from './subject-check.ts';

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

describe('whether a picture carries a plant outline', () => {
	test('is false for a bark view, which photographs bark against bark', () => {
		for (const view of ['bark-base', 'bark-mid', 'bark-limb'])
			expect(hasSeparableOutline(view, 'still')).toBe(false);
	});

	test('is false for a bark texture, which is the material alone', () => {
		expect(hasSeparableOutline('bark-mid', 'texture')).toBe(false);
	});

	test('is true for a leaf texture, which is a cut-out on a plain ground', () => {
		expect(hasSeparableOutline('leaf-upper', 'texture')).toBe(true);
	});

	test('is true for a whole plant against a plain background', () => {
		expect(hasSeparableOutline('whole', 'still')).toBe(true);
	});

	test('is false for a picture whose own background is the subject, which a slot names', () => {
		expect(hasSeparableOutline('whole', 'still', true)).toBe(false);
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

	test('reads a bark view on its own wood, not the corners the backdrop misses', () => {
		// A young limb across the middle of the frame touches both side corners, so the corner rule
		// keeps the sky above and the ground below. The parts picture names the limb's wood and its
		// radius, and the wood read is the limb's own dark brown.
		const size = 1000;
		const data = new Uint8Array(size * size * 4);
		const kind = new Uint8Array(size * size);
		const radius = new Float32Array(size * size);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const at = (y * size + x) * 4;
				const limb = y >= 350 && y < 650;
				const trunk = y >= 800;
				if (limb) {
					kind[y * size + x] = PART.wood;
					radius[y * size + x] = 0.02;
					data.set([90, 70, 60, 255], at);
				} else if (trunk) {
					kind[y * size + x] = PART.wood;
					radius[y * size + x] = 0.3;
					data.set([70, 60, 55, 255], at);
				} else {
					data.set(y < 350 ? [200, 220, 240, 255] : [110, 120, 80, 255], at);
				}
			}
		const image = { width: size, height: size, data };
		const parts = { kind, radius, width: size, height: size };
		const wood = patchWoodLab(image, parts, 0.015, 0.03) as number[];
		expect(wood[0] as number).toBeLessThan(40);
		expect(patchLab(image, true)[0] as number).toBeGreaterThan(45);
		// The trunk's radius is outside the limb's window, and no wood of that thickness gives none.
		expect(patchWoodLab(image, parts, 0.9, 1.2)).toBeUndefined();
		expect(patchWoodLab(image, undefined, 0, 1)).toBeUndefined();
	});

	test('reads the bark alone across a limb picture that carries leaves', () => {
		// A brown limb across the middle of a pale backdrop, with a band of leaves over it. The
		// plant-filtered mean takes the leaves' green; the bark-only mean keeps the limb's own a*.
		const size = 1000;
		const data = new Uint8Array(size * size * 4);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const leaf = y >= 420 && y < 580;
				const limb = y >= 300 && y < 700;
				const [r, g, b] = leaf ? [60, 140, 60] : limb ? [110, 100, 90] : [200, 220, 240];
				const at = (y * size + x) * 4;
				data[at] = r as number;
				data[at + 1] = g as number;
				data[at + 2] = b as number;
				data[at + 3] = 255;
			}
		const image = { width: size, height: size, data };
		const blended = patchLab(image, true)[1] as number;
		const bark = patchLab(image, true, true)[1] as number;
		expect(blended).toBeLessThan(-5);
		expect(Math.abs(bark)).toBeLessThan(5);
	});

	test('falls back to the plant mean where the whole frame is leaf', () => {
		// A picture with no bark surface has no bark mean to read. The bark-only request returns the
		// plant-filtered mean rather than an empty average.
		const size = 400;
		const data = new Uint8Array(size * size * 4);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const band = x >= 160 && x < 240;
				const [r, g, b] = band ? [30, 100, 30] : [60, 140, 60];
				const at = (y * size + x) * 4;
				data[at] = r as number;
				data[at + 1] = g as number;
				data[at + 2] = b as number;
				data[at + 3] = 255;
			}
		const image = { width: size, height: size, data };
		expect(patchLab(image, true, true)).toEqual(patchLab(image, true));
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

describe('the sheath surface figure', () => {
	const target = {
		foot: [0.15, 0.08, 0.03] as const,
		collar: [0.4, 0.4, 0.32] as const,
		reach: 0.5,
	};
	// The record's linear colours as the sRGB bytes a copy stand shows.
	const footSrgb = [108, 80, 48];
	const collarSrgb = [170, 170, 153];

	/** A square picture: the collar band above, the foot band below, leaf green between. */
	function picture(size: number, foot: readonly number[], collar: readonly number[]) {
		const image = blank(size, size, [70, 110, 40]);
		const paint = (from: number, to: number, colour: readonly number[]) => {
			for (let y = from; y <= to; y++)
				for (let x = 0; x < size; x++) {
					const at = (y * size + x) * 4;
					for (let k = 0; k < 3; k++) image.data[at + k] = colour[k] as number;
				}
		};
		const band = Math.round(size * 0.2) - 1;
		paint(0, band, collar);
		paint(size - 1 - band, size - 1, foot);
		return image;
	}

	const whole = rectangle(100, 100, { left: 0, top: 0, right: 99, bottom: 99 });
	const box = { left: 0, top: 0, right: 99, bottom: 99 };
	const side = (image: ReturnType<typeof picture>, plant: PlantMask = whole) => ({
		image,
		box,
		plant,
	});

	test('reads both ends against the photograph and the record', () => {
		const pictureAt = picture(100, footSrgb, collarSrgb);
		const figure = sheathDifference(side(pictureAt), side(pictureAt), target);
		expect(figure?.photograph?.foot ?? 99).toBeLessThan(0.5);
		expect(figure?.photograph?.collar ?? 99).toBeLessThan(0.5);
		expect(figure?.record.foot ?? 99).toBeLessThan(0.5);
	});

	test('separates a shaded sheath from the record', () => {
		// A shade moves both pictures alike, so the photograph figure passes where the record cannot.
		const shaded = [60, 45, 30];
		const shadedCollar = [110, 110, 105];
		const pictureAt = picture(100, shaded, shadedCollar);
		const figure = sheathDifference(side(pictureAt), side(pictureAt), target);
		expect(figure?.photograph?.foot ?? 99).toBeLessThan(0.5);
		expect(figure?.record.foot ?? 0).toBeGreaterThan(5);
	});

	test('reports a moved patch against both sides', () => {
		const figure = sheathDifference(
			side(picture(100, footSrgb, collarSrgb)),
			side(picture(100, [255, 255, 255], collarSrgb)),
			target,
		);
		expect(figure?.photograph?.foot ?? 0).toBeGreaterThan(20);
		expect(figure?.record.foot ?? 0).toBeGreaterThan(20);
		expect(figure?.photograph?.collar ?? 99).toBeLessThan(0.5);
	});

	test('gives no photograph figure when its box cannot be isolated', () => {
		const pictureAt = picture(100, footSrgb, collarSrgb);
		const figure = sheathDifference(
			{ image: pictureAt, box: null, plant: whole },
			side(pictureAt),
			target,
		);
		expect(figure?.photograph).toBeNull();
		expect(figure?.record.foot ?? 99).toBeLessThan(0.5);
	});

	test('finds the surface below the blades', () => {
		const image = blank(100, 100, [70, 110, 40]);
		const paint = (from: number, to: number, colour: readonly number[]) => {
			for (let y = from; y <= to; y++)
				for (let x = 0; x < 100; x++) {
					const at = (y * 100 + x) * 4;
					for (let k = 0; k < 3; k++) image.data[at + k] = colour[k] as number;
				}
		};
		paint(50, 69, collarSrgb);
		paint(70, 99, footSrgb);
		const figure = sheathDifference(side(image), side(image), target);
		expect(figure?.record.foot ?? 99).toBeLessThan(0.5);
		expect(figure?.record.collar ?? 99).toBeLessThan(0.5);
	});

	test('maps a larger picture onto the mask it was measured on', () => {
		const pictureAt = picture(200, footSrgb, collarSrgb);
		const figure = sheathDifference(side(pictureAt), side(pictureAt), target);
		expect(figure?.record.foot ?? 99).toBeLessThan(0.5);
		expect(figure?.record.collar ?? 99).toBeLessThan(0.5);
	});

	test('gives no figure when the render holds no plant', () => {
		const bare: PlantMask = { ...whole, mask: new Uint8Array(100 * 100) };
		const pictureAt = picture(100, footSrgb, collarSrgb);
		expect(sheathDifference(side(pictureAt), side(pictureAt, bare), target)).toBeNull();
	});
});

describe('the mask check gate', () => {
	const frame = (iou: number, subject = 0.2) => ({ iou, subject });
	test('reads a turn on a natural background against its own gate', () => {
		const sound = maskCheckOf([frame(0.75), frame(0.82), frame(0.71)], false);
		expect(sound.value).toBeCloseTo(0.76, 2);
		expect(sound.threshold).toBe(MASK_GATE_NATURAL);
		expect(sound.failed).toBe(false);
		const broken = maskCheckOf([frame(0.21), frame(0.34)], false);
		expect(broken.threshold).toBe(MASK_GATE_NATURAL);
		expect(broken.failed).toBe(true);
	});

	test('reads a plain-background cut piece against the higher gate', () => {
		expect(maskCheckOf([frame(0.94), frame(0.96)], true).failed).toBe(false);
		const below = maskCheckOf([frame(0.88), frame(0.9)], true);
		expect(below.threshold).toBe(MASK_GATE_PLAIN);
		expect(below.failed).toBe(true);
	});

	test('reports a plain-background subject that is too small to judge', () => {
		// The holm oak's subbranch turn: 0.846 with the subject filling 3 per cent of the frame.
		const small = maskCheckOf([frame(0.848, 0.03), frame(0.83, 0.02), frame(0.827, 0.02)], true);
		expect(small.threshold).toBe(MASK_GATE_PLAIN);
		expect(small.small).toBe(true);
		expect(small.failed).toBe(false);
		expect(small.subject).toBeCloseTo(0.023, 3);
		// The same figure on a natural background is judged, since its gate is lower.
		expect(maskCheckOf([frame(0.848, 0.03)], false).small).toBe(false);
	});

	test('reports a turn whose frames cannot be read as unmeasurable, not as a pass or a fail', () => {
		const unreadable = maskCheckOf([null, null, null], false);
		expect(unreadable.value).toBeNull();
		expect(unreadable.frames).toBe(0);
		expect(unreadable.unreadable).toBe(3);
		expect(unreadable.failed).toBe(false);
		expect(unreadable.small).toBe(false);
		// A partly read turn keeps the readable frames and counts the rest.
		const mixed = maskCheckOf([frame(0.95), null], true);
		expect(mixed.value).toBeCloseTo(0.95, 2);
		expect(mixed.frames).toBe(1);
		expect(mixed.unreadable).toBe(1);
	});

	test('takes a plain background only where the frame names one', () => {
		expect(plainTurnOf('studio-grey')).toBe(true);
		expect(plainTurnOf('white')).toBe(true);
		expect(plainTurnOf('sky-meadow')).toBe(false);
		// The page's default background is the natural one.
		expect(plainTurnOf(undefined)).toBe(false);
	});
});

describe("a whole view's frame against its photograph's", () => {
	/** A plant's box in a frame 640 by 480, from shares of the frame. */
	const framed = (left: number, top: number, right: number, bottom: number) => ({
		box: {
			left: Math.round(left * 640),
			top: Math.round(top * 480),
			right: Math.round(right * 640) - 1,
			bottom: Math.round(bottom * 480) - 1,
		},
		width: 640,
		height: 480,
	});
	const photograph = framed(0.1, 0.2, 0.9, 0.9);

	test('holds when the plant stands at the same size, whatever its own shape and place', () => {
		expect(framingFault(photograph, framed(0.1, 0.2, 0.9, 0.9))).toBe(undefined);
		// A plant a third narrower at the photograph's height is the plant's shape, not the frame's.
		expect(framingFault(photograph, framed(0.25, 0.2, 0.75, 0.9))).toBe(undefined);
		// A sixth smaller both ways is inside the band, and so is the same plant higher in the frame.
		expect(framingFault(photograph, framed(0.17, 0.32, 0.83, 0.9))).toBe(undefined);
		expect(framingFault(photograph, framed(0.1, 0.05, 0.9, 0.75))).toBe(undefined);
	});

	test("reads the drawn plant's scale against the photograph's, and holds frame figures within a twentieth", () => {
		expect(frameScale(photograph, framed(0.1, 0.2, 0.9, 0.9))).toBe(1);
		// A plant that stands back to 0.91 of the photograph's height: the frame's figures go.
		const smaller = frameScale(photograph, framed(0.14, 0.263, 0.86, 0.9));
		expect(smaller).toBeCloseTo(0.91, 2);
		expect(frameFiguresHold(smaller)).toBe(false);
		expect(frameFiguresHold(frameScale(photograph, framed(0.1, 0.23, 0.9, 0.9)))).toBe(true);
		expect(frameFiguresHold(null)).toBe(false);
	});

	test('fails a plant drawn at a third of the size, and says both sizes', () => {
		expect(framingFault(photograph, framed(0.37, 0.67, 0.63, 0.9))).toBe(
			"the render's plant takes 0.23 of the frame's height and 0.26 of its width, against the photograph's 0.70 and 0.80, so it is drawn too small",
		);
		expect(framingFault(framed(0.3, 0.5, 0.7, 0.9), framed(0.05, 0.1, 0.95, 0.9))).toContain(
			'so it is drawn too large',
		);
	});

	test('fails a plant the frame crops where the photograph holds it whole', () => {
		const clear = { left: false, top: false, right: false, bottom: false };
		expect(cropFault(clear, clear)).toBe(undefined);
		expect(cropFault(clear, { ...clear, bottom: true, right: true })).toBe(
			"the render's plant runs off the frame's right and bottom edges, where the photograph holds it whole",
		);
		// A photograph that crops its own plant allows the same crop, and no other.
		const cropped = { ...clear, bottom: true };
		expect(cropFault(cropped, cropped)).toBe(undefined);
		expect(cropFault(cropped, { ...clear, bottom: true, top: true })).toContain(
			"frame's top edge,",
		);
	});
});

describe('a picture that answers nothing', () => {
	test('is one whose subject takes none of the frame', () => {
		const facts = (subject: number) => ({
			subject: { kind: 'an arm seen from outside', clutter: { subject, front: 0, behind: 0 } },
		});
		expect(emptySubject(facts(0))).toBe(
			'the subject, an arm seen from outside, takes 0.00 of the frame',
		);
		expect(emptySubject(facts(0.3))).toBe(undefined);
		// A view that measured no share says nothing here.
		expect(emptySubject({ subject: { kind: 'the whole plant' } })).toBe(undefined);
	});

	test('is one the page drew for another photograph that was asked for differently', () => {
		const seen = new Map<string, { file: string; query: string }>();
		const frame = (sunRise: number, sha256 = 'abc') =>
			({ sha256, query: { view: 'leaf-upper', sunRise } }) as never;
		expect(sameDrawing(seen, '11-leaf.png', frame(40))).toBe(undefined);
		// The same picture for the same request is one drawing asked for twice.
		expect(sameDrawing(seen, '11-leaf-copy.png', frame(40))).toBe(undefined);
		expect(sameDrawing(seen, '12-leaf.png', frame(55))).toBe(
			'the page drew the same picture as for 11-leaf.png, though the two were asked for differently',
		);
		expect(sameDrawing(seen, '13-leaf.png', frame(55, 'def'))).toBe(undefined);
	});

	test('is a whole view whose frame is all plant, or holds none', () => {
		const frame = (covered: number) => ({
			mask: new Uint8Array(100).fill(1, 0, covered),
			width: 10,
			height: 10,
		});
		expect(blankFrame(frame(100))).toBe(
			'the plant covers 1.00 of the frame, so the frame holds no outline',
		);
		expect(blankFrame(frame(0))).toBe('the frame holds no plant');
		expect(blankFrame(frame(40))).toBe(undefined);
	});

	test('names the level of detail its page posted', () => {
		expect(levelName({ level: { name: 'first card level', forced: false } })).toBe(
			'first card level',
		);
		expect(levelName({ level: { name: 'leaf form', forced: true } })).toBe('leaf form, forced');
		expect(levelName({})).toBe(undefined);
	});

	test("reads the level the engine draws at a cell's distance, not the level the query forced", () => {
		const starts = [0, 3.7, 156.6, 1e9];
		const cell = (distance: number, forced?: number) => ({
			level: {
				distance,
				starts,
				forced: forced !== undefined,
				...(forced !== undefined && { level: forced }),
			},
		});
		expect(engineLevelAt(cell(86))).toBe(1);
		expect(engineLevelAt(cell(2))).toBe(0);
		expect(engineLevelAt(cell(200))).toBe(2);
		// A forced leaf form at a whole view's distance is a diagnosis: the engine draws the card level.
		expect(engineLevelAt(cell(86, 0))).toBe(1);
		// A band with no start draws at no distance: the shaped plant's empty levels post nulls.
		expect(engineLevelAt({ level: { distance: 86, starts: [0, null, null, 1e9] } })).toBe(0);
		expect(engineLevelAt({})).toBe(undefined);
		expect(engineLevelAt({ level: { distance: 86 } })).toBe(undefined);
	});
});

describe("a picture's rows against its plant's own height", () => {
	// A plant 10 m tall, 15 m from a camera 2 m up that tilts 12 degrees up, through a 45 degree lens.
	const fov = 45;
	const tilt = { pitch: (12 * Math.PI) / 180, fov };
	const rowOf = (height: number) =>
		0.5 - Math.tan(Math.atan2(height - 2, 15) - tilt.pitch) / (2 * Math.tan((fov * Math.PI) / 360));

	test("reads the plant's share of its height from a tilted camera's rows", () => {
		const rows = plantRows(rowOf(10), rowOf(0), tilt);
		expect(rows?.share(rowOf(5)) as number).toBeCloseTo(0.5, 6);
		expect(rows?.eye as number).toBeCloseTo(0.2, 6);
		// The picture's share of the plant's rows down to its middle is not the plant's half.
		const picture = (rowOf(5) - rowOf(10)) / (rowOf(0) - rowOf(10));
		expect(Math.abs(picture - 0.5)).toBeGreaterThan(0.03);
	});

	test("takes a level camera's rows as the plant's shares", () => {
		const rows = plantRows(0.2, 0.8, { pitch: 0, fov });
		expect(rows?.share(0.35) as number).toBeCloseTo(0.25, 6);
		expect(rows?.eye as number).toBeCloseTo(0.5, 6);
	});

	test("finds a photograph's tilt from its horizon's row, and a drawing's from its camera", () => {
		expect(horizonTilt(rowOf(2), fov).pitch).toBeCloseTo(tilt.pitch, 6);
		const frame = {
			cell: {
				camera: { position: [0, 2, 15], target: [0, 2 + 15 * Math.tan(tilt.pitch), 0], fov },
			},
		} as unknown as Parameters<typeof frameTilt>[0];
		expect(frameTilt(frame)?.pitch as number).toBeCloseTo(tilt.pitch, 6);
	});
});

describe("a whole view's sky gap, read like with like", () => {
	const W = 160;
	const H = 120;
	const SKY = [196, 214, 236] as const;
	const LEAF = [40, 80, 30] as const;
	const linear = (b: number) => {
		const c = b / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const encode = (c: number) =>
		Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
	/** Whether a pixel is the crown's: an ellipse, with a grid of holes through it. */
	const crown = (x: number, y: number) =>
		((x - 80) / 50) ** 2 + ((y - 55) / 35) ** 2 <= 1 && !(x % 8 < 2 && y % 8 < 2);
	const trunk = (x: number, y: number) => x >= 77 && x <= 83 && y > 85 && y < 112;

	test('reads a still of half-covered plant pixels as a photograph of the same pixels', () => {
		// Each crown pixel half leaf and half sky, mixed in linear light as a camera or the engine
		// draws a texel half covered.
		const half = LEAF.map((c, k) => encode((linear(c) + linear(SKY[k] as number)) / 2));
		const still = blank(W, H, SKY);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const colour = trunk(x, y) ? LEAF : crown(x, y) ? half : undefined;
				if (colour) still.data.set(colour, (y * W + x) * 4);
			}
		const photograph = { ...still, data: new Uint8Array(still.data) };
		const byColour = colourRuleGap(still);
		expect(byColour).toBe(colourRuleGap(photograph));
		expect(byColour).toBeGreaterThan(0);
		// The engine's matte of the same half cover is stored display-encoded, 188 on white: the
		// half-dark rule reads it as sky, so a matte against a photograph's colour mask is unlike.
		const matte = blank(W, H, [255, 255, 255]);
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				if (trunk(x, y)) matte.data.set([0, 0, 0], (y * W + x) * 4);
				else if (crown(x, y)) matte.data.set([188, 188, 188], (y * W + x) * 4);
			}
		const read = matteMask(matte);
		let crownPlant = 0;
		for (let y = 0; y < read.height; y++)
			for (let x = 0; x < read.width; x++)
				if (crown(x, y) && !trunk(x, y) && read.mask[y * read.width + x]) crownPlant++;
		expect(crownPlant).toBe(0);
	});
});
