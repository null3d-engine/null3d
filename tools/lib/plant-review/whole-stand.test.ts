// The stand of a whole view: whatever the plant's habit and whatever its photograph asks, every
// point the plant draws lands inside the frame, and the foot lands on the row asked for it.
import { describe, expect, test } from 'bun:test';
import {
	frameExtent,
	liftedToGround,
	type WholeFraming,
	wholeStand,
} from '../../../tests/pages/lib/plant-review/whole-stand.ts';

/** Points on a shape, a few hundred of them, as a flat list. */
function cloud(at: (u: number, v: number) => readonly [number, number, number]): Float32Array {
	const out: number[] = [];
	for (let i = 0; i <= 24; i++)
		for (let j = 0; j < 36; j++) out.push(...at(i / 24, (j / 36) * 2 * Math.PI));
	return new Float32Array(out);
}

/** A stem of a radius from the ground up to a height. */
const stem = (radius: number, top: number) =>
	cloud((u, v) => [radius * Math.cos(v), u * top, radius * Math.sin(v)]);
/** A crown as half an ellipsoid over a base height, with a stem under it. */
const crown = (wide: number, tall: number, base: number, trunk: number) =>
	new Float32Array([
		...stem(trunk, base),
		...cloud((u, v) => {
			const lift = (u * Math.PI) / 2;
			return [
				wide * Math.cos(lift) * Math.cos(v),
				base + tall * Math.sin(lift),
				wide * Math.cos(lift) * Math.sin(v),
			];
		}),
	]);

/** One plant of each habit: its drawn points, its height, and a word for it. */
const HABITS: readonly {
	readonly name: string;
	readonly points: Float32Array;
	readonly height: number;
}[] = [
	{ name: 'a broad dome on a short bole', points: crown(15, 15, 4, 1.3), height: 19 },
	{ name: 'a tall column', points: stem(0.4, 12), height: 12 },
	{
		name: 'a spire',
		points: cloud((u, v) => [(1 - u) * 2 * Math.cos(v), u * 18, (1 - u) * 2 * Math.sin(v)]),
		height: 18,
	},
	{ name: 'an umbrella on a long bole', points: crown(5, 3, 14, 0.3), height: 17 },
	{
		name: 'a weeping crown that sweeps the ground',
		points: new Float32Array([
			...crown(5, 4, 4, 0.3),
			...cloud((u, v) => [5 * Math.cos(v), u * 4, 5 * Math.sin(v)]),
		]),
		height: 8,
	},
	{ name: 'a low mound', points: crown(0.45, 0.5, 0, 0.02), height: 0.5 },
	{
		name: 'a clump of stems',
		points: new Float32Array([
			...cloud((u, v) => [
				0.2 * Math.cos(v) + u * 2 * Math.cos(v),
				u * 7,
				0.2 * Math.sin(v) + u * 2 * Math.sin(v),
			]),
		]),
		height: 7,
	},
];

/** Framings read from photographs: two rows asked, an eye height asked, a narrow frame and a redraw's scale. */
const FRAMINGS: readonly { readonly name: string; readonly framing: WholeFraming }[] = [
	{
		name: 'a daylight whole view with its foot row',
		framing: {
			fov: 30,
			aspect: 1.5,
			horizon: 0.8419,
			top: 0.1744,
			base: 0.8791,
			targetX: 0.482,
			widthShare: 0.7734,
		},
	},
	{
		name: 'a profile with its top row and an eye height',
		framing: {
			fov: 30,
			aspect: 1.5,
			horizon: 0.9186,
			top: 0.0558,
			eye: 0.3,
			targetX: 0.4898,
			widthShare: 0.95,
		},
	},
	{
		name: 'a tall narrow frame',
		framing: {
			fov: 40,
			aspect: 0.75,
			horizon: 0.8,
			top: 0.08,
			base: 0.9,
			targetX: 0.5,
			widthShare: 0.5,
		},
	},
	{
		name: 'a redraw that asks to move the camera in',
		framing: {
			fov: 30,
			aspect: 1.5,
			horizon: 0.8419,
			top: 0.1744,
			base: 0.8791,
			targetX: 0.482,
			widthShare: 0.7734,
			scale: 0.7,
		},
	},
	{
		name: 'a redraw that moves the camera out',
		framing: {
			fov: 30,
			aspect: 1.5,
			horizon: 0.9419,
			top: 0.17,
			eye: 0.3,
			targetX: 0.4945,
			widthShare: 0.89,
			scale: 1.4,
		},
	},
];

describe('the stand of a whole view', () => {
	for (const habit of HABITS)
		for (const { name, framing } of FRAMINGS)
			test(`holds ${habit.name} inside ${name}, from every side`, () => {
				for (const turn of [0, 1, 2.5, 4]) {
					const stand = wholeStand(habit.points, [0, 0, 0], turn, framing, habit.height);
					const { top, base, left, right } = stand.extent;
					// Every drawn point is inside the frame, clear of its edges.
					expect(top).toBeGreaterThanOrEqual(0.005);
					expect(base).toBeLessThanOrEqual(0.995);
					expect(left).toBeGreaterThanOrEqual(0.005);
					expect(right).toBeLessThanOrEqual(0.995);
					// A stand held back by the frame stands no farther back than holds the plant.
					if (stand.held === 'frame')
						expect(Math.min(top, 1 - base, left, 1 - right)).toBeLessThan(0.0125);
					// The camera stands above the ground and looks at the plant.
					expect(stand.position[1]).toBeGreaterThanOrEqual(
						Math.min(0.1, 0.02 * habit.height) - 1e-9,
					);
					expect(stand.distance).toBeGreaterThan(0);
				}
			});

	test('puts the top and the foot on their rows where the plant is no wider than its photograph', () => {
		const framing = FRAMINGS[0]?.framing as WholeFraming;
		const stand = wholeStand(stem(0.4, 12), [0, 0, 0], 0, framing, 12);
		expect(stand.held).toBe('rows');
		expect(stand.extent.top).toBeCloseTo(0.1744, 2);
		expect(stand.extent.base).toBeCloseTo(0.8791, 2);
	});

	test('stands back from a plant wider than its photograph, and keeps the foot on its row', () => {
		const framing = FRAMINGS[0]?.framing as WholeFraming;
		const wide = crown(15, 6, 3, 1);
		const stand = wholeStand(wide, [0, 0, 0], 0, framing, 9);
		expect(stand.held).toBe('width');
		expect(stand.extent.right - stand.extent.left).toBeLessThanOrEqual(0.7734 + 0.004);
		expect(stand.extent.base).toBeCloseTo(0.8791, 2);
		// The top then stands lower than asked: the plant is held whole, not cropped to its rows.
		expect(stand.extent.top).toBeGreaterThan(0.1744);
	});

	test("keeps a plant narrower than its photograph on its rows through a redraw's scale below one", () => {
		const framing = FRAMINGS[0]?.framing as WholeFraming;
		const tree = crown(6, 8, 4, 0.5);
		const first = wholeStand(tree, [0, 0, 0], 0, framing, 12);
		expect(first.held).toBe('rows');
		for (const scale of [0.85, 0.59, 0.4]) {
			const redrawn = wholeStand(tree, [0, 0, 0], 0, { ...framing, scale }, 12);
			expect(redrawn.distance).toBeCloseTo(first.distance, 6);
			expect(redrawn.extent.top).toBeCloseTo(0.1744, 2);
			expect(redrawn.extent.base).toBeCloseTo(0.8791, 2);
		}
	});

	test("brings a plant that stood back for its width in by a redraw's scale, no nearer than its rows", () => {
		const framing = FRAMINGS[0]?.framing as WholeFraming;
		// Wider than its photograph's share, though the frame holds it whole on its rows.
		const wide = crown(8, 6, 3, 1);
		const first = wholeStand(wide, [0, 0, 0], 0, framing, 9);
		expect(first.held).toBe('width');
		// Asked to come in far, it stops on its rows: the top on the asked top row.
		const furthest = wholeStand(wide, [0, 0, 0], 0, { ...framing, scale: 0.3 }, 9);
		expect(furthest.extent.top).toBeCloseTo(0.1744, 2);
		expect(furthest.extent.base).toBeCloseTo(0.8791, 2);
		// Asked to come in a little, it comes in by the scale from the stand that drew it.
		const nearer = wholeStand(wide, [0, 0, 0], 0, { ...framing, scale: 0.97 }, 9);
		expect(nearer.distance).toBeLessThan(first.distance);
		expect(nearer.distance).toBeGreaterThanOrEqual(furthest.distance);
		expect(nearer.extent.base).toBeCloseTo(0.8791, 2);
	});

	test("moves the camera out for a redraw's scale above one, and keeps the foot on its row", () => {
		const framing = FRAMINGS[0]?.framing as WholeFraming;
		const tree = crown(6, 8, 4, 0.5);
		const first = wholeStand(tree, [0, 0, 0], 0, framing, 12);
		const farther = wholeStand(tree, [0, 0, 0], 0, { ...framing, scale: 1.3 }, 12);
		expect(farther.distance).toBeGreaterThan(first.distance);
		expect(farther.extent.base).toBeCloseTo(0.8791, 2);
		expect(farther.extent.right - farther.extent.left).toBeLessThan(
			first.extent.right - first.extent.left,
		);
	});

	test('stands back from a crop only as far as holds every drawn point', () => {
		// A broad crown on a long bole, as a pine's is, set so far to one side of the frame that its
		// rows' stand runs it off the left edge.
		const pine = crown(11, 10, 9, 0.7);
		const framing: WholeFraming = {
			fov: 30,
			aspect: 768 / 516,
			horizon: 0.8256,
			top: 0.0163,
			base: 0.8512,
			targetX: 0.2,
			widthShare: 0.8094,
		};
		for (const turn of [0, 1, 2.5, 4]) {
			const stand = wholeStand(pine, [0, 0, 0], turn, framing, 19);
			expect(stand.held).toBe('frame');
			const { top, base, left, right } = stand.extent;
			// One edge of the drawn plant sits on the frame's margin: the camera is no farther back.
			const tightest = Math.min(top, 1 - base, left, 1 - right);
			expect(tightest).toBeGreaterThanOrEqual(0.005);
			expect(tightest).toBeLessThan(0.0125);
			expect(base).toBeCloseTo(0.8512, 2);
		}
	});

	test('stands a plant whose photograph lost its foot by its top row and its share of the width', () => {
		const mound = crown(5, 6, 0, 0.5);
		const framing: WholeFraming = {
			fov: 30,
			aspect: 1.5,
			horizon: 0.52,
			top: 0.05,
			targetX: 0.5,
			widthShare: 0.6,
		};
		for (const turn of [0, 1.3]) {
			const stand = wholeStand(mound, [0, 0, 0], turn, framing, 6);
			expect(stand.extent.top).toBeCloseTo(0.05, 2);
			expect(stand.extent.right - stand.extent.left).toBeCloseTo(0.6, 2);
			expect(stand.extent.base).toBeLessThanOrEqual(0.99);
		}
	});

	test('reads a blade that dips through the ground in front of a low camera where it meets the ground', () => {
		// A tuft whose front blade runs toward the camera and dips under the ground near its tip.
		const tuft = crown(0.5, 0.6, 0, 0.05);
		const blade = new Float32Array([0, 0.3, 0.2, 0, 0.12, 0.8, 0, 0.02, 1.2, 0, -0.04, 1.35]);
		const leaves = new Float32Array([...tuft, ...blade]);
		const lifted = liftedToGround(leaves, 0);
		// Only the point under the ground moves, and only onto the ground.
		expect(lifted[lifted.length - 2]).toBe(0);
		expect(lifted[lifted.length - 5]).toBeCloseTo(0.02, 6);
		expect(lifted.length).toBe(leaves.length);
		expect(liftedToGround(tuft, -1)).toBe(tuft);
		// A camera 0.1 m up and 2.7 m off, looking level: the blade meets the ground between its
		// last two points, about 1.3 m out, and the lifted points reach at least that low in the
		// frame where the dropped ones stop at the last point above the ground.
		const eye: [number, number, number] = [0, 0.1, 2.7];
		const level: [number, number, number] = [0, 0, -1];
		const meeting = frameExtent(new Float32Array([0, 0, 1.3]), eye, level, 38, 1.5).base;
		const kept = frameExtent(lifted, eye, level, 38, 1.5, -1e-3).base;
		const dropped = frameExtent(leaves, eye, level, 38, 1.5, -1e-3).base;
		expect(kept).toBeGreaterThanOrEqual(meeting);
		expect(dropped).toBeLessThan(meeting);
	});

	test('leaves out what grows under the ground, which the ground hides', () => {
		const rooted = new Float32Array([...stem(0.3, 6), 0, -3, 0, 2, -1, 0]);
		const stand = wholeStand(rooted, [0, 0, 0], 0, FRAMINGS[0]?.framing as WholeFraming, 6);
		expect(stand.extent.base).toBeCloseTo(0.8791, 2);
		// The frame's extent of the same points with no ground named reaches below the foot's row.
		const forward: [number, number, number] = [
			stand.target[0] - stand.position[0],
			stand.target[1] - stand.position[1],
			stand.target[2] - stand.position[2],
		];
		const length = Math.hypot(...forward);
		const all = frameExtent(
			rooted,
			stand.position,
			forward.map((v) => v / length) as never,
			30,
			1.5,
		);
		expect(all.base).toBeGreaterThan(stand.extent.base);
	});
});
